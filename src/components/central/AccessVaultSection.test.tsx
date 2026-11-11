import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessVaultSection } from "./AccessVaultSection";

const navigation = vi.hoisted(() => ({
  panes: [] as any[], listeners: new Set<() => void>(), setActive: vi.fn(), updatePane: vi.fn(),
  openWorkspace: vi.fn(), setActiveMission: vi.fn(), navigate: vi.fn(),
}));
vi.mock("../../stores/panes-store", () => ({ usePanesStore: {
  getState: () => ({ panes: navigation.panes, setActive: navigation.setActive, updatePane: navigation.updatePane }),
  subscribe: (listener: () => void) => { navigation.listeners.add(listener); return () => navigation.listeners.delete(listener); },
} }));
vi.mock("../../stores/nav-store", () => ({ useNavStore: { getState: () => ({ openWorkspace: navigation.openWorkspace }) } }));
vi.mock("../../stores/missions-store", () => ({ useMissionsStore: { getState: () => ({ setActiveMission: navigation.setActiveMission }) } }));
vi.mock("../../lib/router", () => ({ navigate: navigation.navigate }));

const credential = { id: "cred-fixture", label: "API fixture", kind: "api-key", allowAgentAccess: false, hasSecret: true, createdAt: "2026-11-09", updatedAt: "2026-11-09" };
const host = { id: "host-fixture", label: "Fixture machine", hostname: "fixture.example.invalid", username: "tester", port: 2222, credentialId: null, allowAgentAccess: false, createdAt: "2026-11-09", updatedAt: "2026-11-09" };

describe("AccessVaultSection", () => {
  let bridge: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.panes = [{ id: "ssh-fixture", workspacePath: "D:/test-workspace", missionId: "mission-fixture" }];
    navigation.listeners.clear();
    bridge = {
      status: vi.fn().mockResolvedValue({ ok: true, status: { available: true, backend: "dpapi" } }),
      list: vi.fn().mockResolvedValue({ ok: true, hosts: [host], credentials: [credential] }),
      saveCredential: vi.fn().mockResolvedValue({ ok: true, credential }),
      saveHost: vi.fn().mockResolvedValue({ ok: true, host }),
      deleteHost: vi.fn().mockResolvedValue({ ok: true }), deleteCredential: vi.fn().mockResolvedValue({ ok: true }),
      openSsh: vi.fn().mockResolvedValue({ ok: true, paneId: "ssh-fixture", interactive: false }),
      loginSso: vi.fn().mockResolvedValue({ ok: true }),
    };
    vi.stubGlobal("codeBrainApp", { accessVault: bridge });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("renders only persisted metadata and keeps saved secret fields empty on edit", async () => {
    bridge.list.mockResolvedValue({ ok: true, hosts: [host], credentials: [{ ...credential, secret: "NEVER-DISPLAY-STORED-SECRET" }] });
    render(<AccessVaultSection />);
    expect(await screen.findByRole("heading", { name: "Fixture machine" })).toBeTruthy();
    expect(screen.getByText("tester@fixture.example.invalid · porta 2222")).toBeTruthy();
    expect(document.body.textContent).not.toContain("NEVER-DISPLAY-STORED-SECRET");
    fireEvent.click(screen.getByRole("button", { name: "Editar credencial API fixture" }));
    const input = screen.getByLabelText("Valor secreto") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
    expect(screen.queryByRole("button", { name: /revelar|mostrar segredo/i })).toBeNull();
  });

  it("submits credentials as write-only values, clears the input immediately and uses no browser storage", async () => {
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova credencial" }));
    fireEvent.change(screen.getByLabelText("Nome da credencial"), { target: { value: "New API" } });
    const input = screen.getByLabelText("Valor secreto") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "TEST-SECRET-ONLY" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    expect(input.value).toBe("");
    await screen.findByText("Cadastro salvo no cofre.");
    expect(bridge.saveCredential).toHaveBeenCalledExactlyOnceWith({ label: "New API", kind: "api-key", secret: "TEST-SECRET-ONLY", allowAgentAccess: false });
    expect(document.body.textContent).not.toContain("TEST-SECRET-ONLY");
    expect(localStorageWrite).not.toHaveBeenCalled();
  });

  it("preserves a stored credential when the replacement secret input is empty", async () => {
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar credencial API fixture" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    await screen.findByText("Cadastro salvo no cofre.");
    expect(bridge.saveCredential.mock.calls[0][0]).toEqual({ id: credential.id, label: credential.label, kind: "api-key", allowAgentAccess: false });
  });

  it("creates hosts without agent permissions and does not connect as a side effect", async () => {
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo host SSH" }));
    fireEvent.change(screen.getByLabelText("Nome do host"), { target: { value: "My test host" } });
    fireEvent.change(screen.getByLabelText("Hostname ou IP"), { target: { value: "test.example.invalid" } });
    fireEvent.change(screen.getByLabelText("Usuário SSH"), { target: { value: "tester" } });
    const permission = screen.getByLabelText("Permitir solicitações SSH de agentes para este host") as HTMLInputElement;
    expect(permission.checked).toBe(false);
    expect(screen.getByText(/Se não houver agente disponível, crie uma credencial/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar host" }));
    await screen.findByText("Cadastro salvo no cofre.");
    expect(bridge.saveHost).toHaveBeenCalledExactlyOnceWith({ label: "My test host", hostname: "test.example.invalid", username: "tester", port: 22, credentialId: null, useSshConfig: false, allowAgentAccess: false });
    expect(bridge.openSsh).not.toHaveBeenCalled();
  });

  it("configures an SSM tunnel and can start SSO login without saving or connecting", async () => {
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo host SSH" }));
    fireEvent.change(screen.getByLabelText("Nome do host"), { target: { value: "SSM" } });
    fireEvent.change(screen.getByLabelText("Hostname ou IP"), { target: { value: "127.0.0.1" } });
    fireEvent.change(screen.getByLabelText("Usuário SSH"), { target: { value: "admin" } });
    fireEvent.click(screen.getByLabelText("Abrir túnel AWS SSM automaticamente"));
    fireEvent.change(screen.getByLabelText("ID da instância EC2"), { target: { value: "i-0123456789abcdef0" } });
    fireEvent.change(screen.getByLabelText("Região AWS"), { target: { value: "sa-east-1" } });
    fireEvent.change(screen.getByLabelText("Perfil AWS CLI"), { target: { value: "hubbiparts" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar no AWS SSO" }));
    await waitFor(() => expect(bridge.loginSso).toHaveBeenCalledWith({ profile: "hubbiparts" }));
    expect(bridge.openSsh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar host" }));
    await waitFor(() => expect(bridge.saveHost).toHaveBeenCalledWith(expect.objectContaining({
      ssmTunnel: { instanceId: "i-0123456789abcdef0", region: "sa-east-1", profile: "hubbiparts", localPort: 2222 },
    })));
  });

  it("lets the user select a local SSH alias without granting agent access automatically", async () => {
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo host SSH" }));
    fireEvent.change(screen.getByLabelText("Nome do host"), { target: { value: "TOM" } });
    fireEvent.click(screen.getByLabelText("Usar configuração SSH local (alias, chave e ProxyJump)"));
    fireEvent.change(screen.getByLabelText("Alias em ~/.ssh/config"), { target: { value: "codebrain-tom" } });
    fireEvent.change(screen.getByLabelText("Usuário SSH"), { target: { value: "user" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar host" }));
    await screen.findByText("Cadastro salvo no cofre.");
    expect(bridge.saveHost).toHaveBeenCalledWith(expect.objectContaining({ hostname: "codebrain-tom", useSshConfig: true, allowAgentAccess: false }));
    expect(bridge.openSsh).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before deleting a host", async () => {
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Excluir host Fixture machine" }));
    expect(screen.getByRole("alertdialog", { name: "Confirmar" })).toBeTruthy();
    expect(bridge.deleteHost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "cancelar" }));
    expect(bridge.deleteHost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir host Fixture machine" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await screen.findByText("Cadastro removido do cofre.");
    expect(bridge.deleteHost).toHaveBeenCalledExactlyOnceWith({ id: host.id, confirmed: true });
  });

  it("disables vault data/forms when secure OS storage is unavailable", async () => {
    bridge.status.mockResolvedValue({ ok: true, status: { available: false, backend: "basic_text", reason: "Keyring seguro obrigatório" } });
    render(<AccessVaultSection />);
    expect(await screen.findByText("Cofre bloqueado")).toBeTruthy();
    expect(screen.getByText("Keyring seguro obrigatório")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nova credencial" })).toBeNull();
    expect(bridge.list).not.toHaveBeenCalled();
  });

  it("explains that SSH key file content is not encrypted/imported by the vault", async () => {
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova credencial" }));
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "ssh-key-path" } });
    expect(screen.getByLabelText("Caminho absoluto da chave SSH").getAttribute("type")).toBe("password");
    expect(screen.getByText(/O arquivo da chave permanece fora do cofre/)).toBeTruthy();
    expect(screen.getByText(/Conteúdo de chave privada não é importado/)).toBeTruthy();
  });

  it("requests SSH only through a stored host ID and reports interactive password requirements honestly", async () => {
    bridge.openSsh.mockResolvedValue({ ok: true, paneId: "ssh-fixture", interactive: true });
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir SSH Fixture machine" }));
    await screen.findByText("Terminal SSH aberto. Digite a senha manualmente; a senha salva não foi enviada.");
    expect(bridge.openSsh).toHaveBeenCalledExactlyOnceWith({ hostId: host.id });
    expect(navigation.setActive).toHaveBeenCalledWith("ssh-fixture");
    expect(navigation.openWorkspace).toHaveBeenCalledWith("D:/test-workspace");
    expect(navigation.navigate).toHaveBeenCalledWith("/workspace", { query: { path: "D:/test-workspace" } });
  });

  it("waits for the existing pane event before navigating and never creates a duplicate", async () => {
    navigation.panes = [];
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir SSH Fixture machine" }));
    await waitFor(() => expect(navigation.listeners.size).toBe(1));
    expect(navigation.navigate).not.toHaveBeenCalled();
    act(() => {
      navigation.panes = [{ id: "ssh-fixture", cwd: "D:/event-workspace", missionId: "event-mission", collapsed: true }];
      navigation.listeners.forEach(listener => listener());
    });
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("/workspace", { query: { path: "D:/event-workspace" } }));
    expect(navigation.setActiveMission).toHaveBeenCalledWith("D:/event-workspace", "event-mission");
    expect(navigation.updatePane).toHaveBeenCalledWith("ssh-fixture", { collapsed: false });
    expect(bridge.openSsh).toHaveBeenCalledTimes(1);
    expect(navigation.listeners.size).toBe(0);
  });

  it("refreshes on focus and visibility so newly registered agent hosts appear", async () => {
    render(<AccessVaultSection />);
    await screen.findByRole("heading", { name: "Fixture machine" });
    bridge.list.mockResolvedValue({ ok: true, hosts: [host, { ...host, id: "new-host", label: "Newly registered" }], credentials: [credential] });
    fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: "Newly registered" })).toBeTruthy();
    const count = bridge.list.mock.calls.length;
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(bridge.list.mock.calls.length).toBeGreaterThan(count));
  });

  it("clears a newly typed secret even when saving fails, without claiming success", async () => {
    bridge.saveCredential.mockResolvedValue({ ok: false, error: "Cofre bloqueado" });
    render(<AccessVaultSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Nova credencial" }));
    fireEvent.change(screen.getByLabelText("Nome da credencial"), { target: { value: "Fixture" } });
    const input = screen.getByLabelText("Valor secreto") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "TRANSIENT-SECRET" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar credencial" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Cofre bloqueado");
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("TRANSIENT-SECRET");
    expect(screen.queryByText("Cadastro salvo no cofre.")).toBeNull();
  });
});
