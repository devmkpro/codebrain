import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsSection } from "./AccountsSection";
import { CatalogSection } from "./CatalogSection";
import { FindingsSection } from "./FindingsSection";
import { HarnessSection } from "./HarnessSection";
import { MediaSection } from "./MediaSection";
import { blankRow } from "./logic";
import type { CliEntry } from "./cli-registry";
import type { HarnessTable } from "./types";

const { openProviders } = vi.hoisted(() => ({ openProviders: vi.fn() }));
vi.mock("../../stores/providers-store", () => ({
  useProvidersStore: (selector: (state: unknown) => unknown) => selector({ providers: [] }),
}));
vi.mock("../../stores/nav-store", () => ({
  useNavStore: { getState: () => ({ openWorkspace: vi.fn() }) },
}));
vi.mock("../../stores/panes-store", () => ({
  usePanesStore: { getState: () => ({ addPane: vi.fn(), setActive: vi.fn() }) },
}));
vi.mock("../../stores/modals-store", () => ({
  useModalsStore: { getState: () => ({ openProviders }) },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entries: CliEntry[] = [
  {
    id: "claude",
    label: "Claude",
    found: true,
    verified: true,
    capabilities: {
      model: true,
      effort: true,
      skills: true,
      systemPrompt: true,
      multiAccount: true,
    },
  },
  {
    id: "kiro",
    label: "Kiro",
    found: true,
    verified: false,
    capabilities: { model: true, effort: false, skills: false, multiAccount: false },
  },
  { id: "unknown", label: "Desconhecida", found: true },
];
const makeTable = (): HarnessTable => ({
  version: 1,
  tierModels: {},
  decider: {
    enabled: false,
    providerId: "api",
    model: "model-a",
    minConfidence: 0.6,
    timeoutMs: 4000,
  },
  rows: [{ ...blankRow([]), id: "geral", name: "Geral", cli: "claude" }],
});

describe("edição de harness", () => {
  it("identifica login CLI sem chave, preserva seleção e permite prazo maior antes do fallback", async () => {
    const table = makeTable();
    table.decider = { ...table.decider, providerId: "cli:codex", model: "gpt-5", timeoutMs: 20000 };
    const saveTable = vi.fn(async (value: HarnessTable) => ({ ok: true, table: value }));
    const testDecider = vi.fn().mockResolvedValue({ ok: false, reason: "tempo limite", error: "tempo limite" });
    vi.stubGlobal("codeBrainApp", {
      cli: { registry: vi.fn().mockResolvedValue(entries) },
      harness: {
        getTable: vi.fn().mockResolvedValue({ ok: true, table }), saveTable, testDecider,
        deciderProviders: vi.fn().mockResolvedValue({ ok: true, providers: [
          { id: "cli:codex", label: "Codex", models: ["gpt-5"], transport: "cli", cli: "codex", authentication: "existing-login" },
          { id: "api", label: "Minha API", models: ["model-a"], transport: "api" },
        ] }),
      },
    });
    render(<HarnessSection workspace="D:/a" />);
    await screen.findByRole("option", { name: "Codex · CLI" });
    expect(screen.getByRole("option", { name: "Minha API · API" })).toBeTruthy();
    expect(screen.getByText("Autenticação: login existente da CLI.")).toBeTruthy();
    expect(within(screen.getByLabelText("Quem responde")).queryByRole("option", { name: /Kiro/ })).toBeNull();
    expect(screen.getByText(/login já existente.*sem chave de API/i)).toBeTruthy();
    expect(screen.getByText(/palavras-chave.*padrão/i)).toBeTruthy();
    const timeout = screen.getByLabelText(/Tempo limite:/) as HTMLInputElement;
    expect(timeout.max).toBe("30000");
    expect(timeout.value).toBe("20000");
    fireEvent.change(timeout, { target: { value: "25000" } });
    fireEvent.click(screen.getByRole("button", { name: "salvar" }));
    await waitFor(() => expect(saveTable).toHaveBeenCalled());
    expect(saveTable.mock.calls[0][0].decider).toMatchObject({ providerId: "cli:codex", model: "gpt-5", timeoutMs: 25000 });
    fireEvent.change(screen.getByLabelText("Testar"), { target: { value: "um pedido" } });
    fireEvent.click(screen.getByRole("button", { name: "testar" }));
    await screen.findByRole("alert");
    expect(testDecider).toHaveBeenCalledWith({ prompt: "um pedido" });
    expect((screen.getByLabelText("Quem responde") as HTMLSelectElement).value).toBe("cli:codex");
  });

  it("explica lista vazia sem exigir chave e oferece configurar API como opção", async () => {
    vi.stubGlobal("codeBrainApp", {
      cli: { registry: vi.fn().mockResolvedValue(entries) },
      harness: {
        getTable: vi.fn().mockResolvedValue({ ok: true, table: makeTable() }),
        deciderProviders: vi.fn().mockResolvedValue({ ok: true, providers: [] }),
      },
    });
    render(<HarnessSection workspace="D:/a" />);
    await screen.findByText(/Nenhuma CLI com transporte compatível/i);
    expect(screen.queryByText(/nenhum provedor com chave/i)).toBeNull();
    expect(screen.getByText(/login já existente/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "configurar API (opcional)" }));
    expect(openProviders).toHaveBeenCalledWith("list");
  });

  it("gates conta/esforço/skills por capacidade e salva o agente selecionado", async () => {
    const saveTable = vi.fn(async (table: HarnessTable) => ({ ok: true, table }));
    vi.stubGlobal("codeBrainApp", {
      cli: { registry: vi.fn().mockResolvedValue(entries) },
      harness: {
        getTable: vi.fn().mockResolvedValue({ ok: true, table: makeTable() }),
        saveTable,
        deciderProviders: vi.fn().mockResolvedValue({ ok: true, providers: [] }),
      },
      accounts: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          accounts: [
            { id: "claude-1", cli: "claude", label: "Trabalho" },
            { id: "kiro-1", cli: "kiro", label: "Kiro conta" },
          ],
        }),
      },
      agentCatalog: {
        scan: vi.fn().mockResolvedValue({ ok: true, items: [{ kind: "agent", name: "revisor" }] }),
      },
    });
    render(<HarnessSection workspace="D:/a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Geral, editar" }));
    await screen.findByRole("option", { name: /Kiro.*experimental/ });
    expect(screen.getByLabelText("Conta").querySelectorAll("option")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Agente"), { target: { value: "revisor" } });
    fireEvent.click(screen.getByRole("button", { name: "salvar" }));
    await waitFor(() => expect(saveTable).toHaveBeenCalled());
    expect(saveTable.mock.calls[0][0].rows[0].agentName).toBe("revisor");
    await waitFor(() =>
      expect((screen.getByLabelText("CLI") as HTMLSelectElement).disabled).toBe(false)
    );
    fireEvent.change(screen.getByLabelText("CLI"), { target: { value: "kiro" } });
    expect(screen.queryByLabelText("Conta")).toBeNull();
    expect(screen.queryByLabelText("Esforço")).toBeNull();
    expect(screen.queryByRole("group", { name: "Skills permitidas" })).toBeNull();
    expect(screen.getByLabelText("Modelo", { selector: "#row-geral-model" })).toBeDefined();
  });

  it("testa Decisor desligado e atualiza provedores sem apagar alterações no formulário", async () => {
    let updated: (() => void) | undefined;
    const deciderProviders = vi.fn().mockResolvedValue({
      ok: true,
      providers: [{ id: "api", label: "API", models: ["model-a"] }],
    });
    const testDecider = vi.fn().mockResolvedValue({
      ok: true,
      decision: { taskId: "geral", confidence: 0.8, reason: "pedido geral" },
      taskName: "Geral",
    });
    vi.stubGlobal("codeBrainApp", {
      cli: { registry: vi.fn().mockResolvedValue(entries) },
      providers: {
        onUpdated: (callback: () => void) => {
          updated = callback;
          return vi.fn();
        },
      },
      harness: {
        getTable: vi.fn().mockResolvedValue({ ok: true, table: makeTable() }),
        deciderProviders,
        testDecider,
      },
    });
    render(<HarnessSection workspace="D:/a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Geral, editar" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Meu geral" } });
    fireEvent.change(screen.getByLabelText("Testar"), { target: { value: "um pedido" } });
    expect((screen.getByRole("button", { name: "testar" }) as HTMLButtonElement).disabled).toBe(
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "testar" }));
    await screen.findByText("decidiria");
    expect(testDecider).toHaveBeenCalledWith({ prompt: "um pedido" });
    deciderProviders.mockResolvedValue({
      ok: true,
      providers: [{ id: "api", label: "API nova", models: ["model-b"] }],
    });
    await act(async () => {
      updated?.();
    });
    await screen.findByRole("option", { name: "API nova" });
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Meu geral");
    expect(
      (screen.getByLabelText("Modelo", { selector: "select" }) as HTMLSelectElement).value
    ).toBe("model-a");
  });
});

describe("contas e catálogo", () => {
  it("só exibe e cria contas para multiAccount explícito", async () => {
    vi.stubGlobal("codeBrainApp", {
      cli: {
        registry: vi
          .fn()
          .mockResolvedValue([
            ...entries,
            { id: "futura", label: "Futura", found: true, capabilities: { multiAccount: true } },
          ]),
      },
      accounts: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          accounts: entries.map((entry) => ({
            id: entry.id,
            cli: entry.id,
            label: `${entry.label} pessoal`,
          })),
        }),
      },
    });
    render(<AccountsSection workspace={null} />);
    await screen.findByText("Claude pessoal");
    expect(screen.queryByText("Kiro pessoal")).toBeNull();
    expect(screen.queryByText("Desconhecida pessoal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ conta" }));
    expect(within(screen.getByLabelText("CLI da conta")).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "criar" })).toBeDefined();
  });

  it("oferece adaptação de agentes e skills também para harnesses sem suporte nativo", async () => {
    const copyTo = vi.fn().mockResolvedValue({ ok: true, copied: [] });
    vi.stubGlobal("codeBrainApp", {
      cli: { registry: vi.fn().mockResolvedValue(entries) },
      agentCatalog: {
        copyTo,
        scan: vi.fn().mockResolvedValue({
          ok: true,
          items: [
            { kind: "agent", name: "revisor" },
            { kind: "skill", name: "minha-skill", installedIn: [] },
          ],
        }),
      },
      accounts: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          accounts: [{ id: "claude", cli: "claude", label: "Padrão" }],
        }),
      },
    });
    render(<CatalogSection workspace="D:/a" />);
    await screen.findByRole("button", { name: /revisor/ });
    expect(screen.getByLabelText("Copiar para outro harness ou Codebrain")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "minha-skill skill" }));
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("Copiar para outro harness ou Codebrain")).getAllByRole("option")
      ).toHaveLength(4)
    );
    expect((screen.getByLabelText("Copiar para outro harness ou Codebrain") as HTMLSelectElement).value).toBe(
      "codebrain"
    );
    fireEvent.change(screen.getByLabelText("Copiar para outro harness ou Codebrain"), { target: { value: "claude" } });
    fireEvent.click(screen.getByRole("button", { name: "copiar" }));
    await screen.findByText(/Nenhum arquivo novo em claude/);
    expect(copyTo).toHaveBeenCalledWith({ name: "minha-skill", kind: "skill", cli: "claude", workspace: "D:/a" });
    expect(screen.queryByText("Copiado para claude.")).toBeNull();
  });
});

it("não transfere a nota de correção entre findings", async () => {
  vi.stubGlobal("codeBrainApp", {
    findings: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        findings: [
          { id: "F-1", title: "Primeiro", severity: "high", status: "open" },
          { id: "F-2", title: "Segundo", severity: "high", status: "open" },
        ],
      }),
    },
  });
  render(<FindingsSection workspace="D:/a" />);
  fireEvent.click(await screen.findByRole("button", { name: "marcar corrigido" }));
  fireEvent.change(screen.getByLabelText("Qual era a causa e como você validou"), {
    target: { value: "nota do primeiro" },
  });
  fireEvent.click(screen.getByRole("button", { name: /F-2 Segundo/ }));
  fireEvent.click(screen.getByRole("button", { name: "marcar corrigido" }));
  expect(
    (screen.getByLabelText("Qual era a causa e como você validou") as HTMLTextAreaElement).value
  ).toBe("");
});

it("usa tamanhos de vídeo e atualiza provedores preservando a descrição", async () => {
  let updated: (() => void) | undefined;
  const generate = vi.fn().mockResolvedValue({ ok: true, path: "D:/a/assets/generated/a.mp4" });
  const providers = vi.fn().mockResolvedValue({
    ok: true,
    providers: [{ id: "openai", label: "OpenAI", kinds: ["image", "video"] }],
  });
  vi.stubGlobal("codeBrainApp", {
    providers: {
      onUpdated: (callback: () => void) => {
        updated = callback;
        return vi.fn();
      },
    },
    media: { providers, list: vi.fn().mockResolvedValue({ ok: true, items: [] }), generate },
  });
  render(<MediaSection workspace="D:/a" />);
  fireEvent.change(await screen.findByLabelText("O que gerar"), {
    target: { value: "Um terminal" },
  });
  await act(async () => {
    updated?.();
  });
  expect((screen.getByLabelText("O que gerar") as HTMLTextAreaElement).value).toBe("Um terminal");
  fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "video" } });
  fireEvent.click(screen.getByRole("button", { name: "gerar" }));
  await waitFor(() =>
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "video",
        size: "1280x720",
        workspace: "D:/a",
        prompt: "Um terminal",
      })
    )
  );
});
