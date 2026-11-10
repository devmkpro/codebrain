import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsBoard } from "./OperationsBoard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function snapshot(workspace: string, title: string) {
  return { ok: true, workspace, actors: [], missions: [{ id: workspace, title, workspace, source: "derived", lane: "idle", actorIds: [], counts: { actors: 0, running: 0, tasks: 0, tasksDone: 0, messages: 0 } }] };
}
const actions = { onOpenWorkspace: vi.fn(), onNewPane: vi.fn() };

describe("operations board registry changes", () => {
  it("removes an unlinked card without allowing an old in-flight update to revive it", async () => {
    let resolveOld: (data: unknown) => void = () => {};
    const getSnapshot = vi.fn().mockResolvedValueOnce(snapshot("/removed", "Old workspace"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    vi.stubGlobal("codeBrainApp", { operations: { snapshot: getSnapshot } });
    const { rerender } = render(<OperationsBoard workspacePaths={["/removed"]} {...actions} />);
    await screen.findByText("Old workspace");
    fireEvent.click(screen.getByRole("button", { name: /atualizar/ }));
    rerender(<OperationsBoard workspacePaths={[]} {...actions} />);
    await act(async () => { resolveOld(snapshot("/removed", "Old workspace")); });
    expect(screen.queryByText("Old workspace")).toBeNull();
    expect(screen.getByText("Nenhum workspace aberto")).toBeTruthy();
  });

  it("keeps healthy workspaces visible if one refresh fails", async () => {
    const getSnapshot = vi.fn(({ workspace }) => workspace === "/existing" ? Promise.resolve(snapshot(workspace, "Existing workspace")) : Promise.reject(new Error("offline")));
    vi.stubGlobal("codeBrainApp", { operations: { snapshot: getSnapshot } });
    render(<OperationsBoard workspacePaths={["/existing", "/failed"]} {...actions} />);
    await screen.findByText("Existing workspace");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Não foi possível atualizar"));
  });
});

describe("individual operation archive controls", () => {
  function fixture(active = false) {
    const hidden = new Set<string>();
    const one = { ...snapshot("/project", "One").missions[0], id: "m1", actorIds: active ? ["p1"] : [] };
    const two = { ...one, id: "m2", title: "Two", actorIds: [] };
    const getSnapshot = vi.fn(async () => ({ ...snapshot("/project", "One"), missions: [one, two].filter((item) => !hidden.has(item.id)), actors: active ? [{ pane_id: "p1", label: "Selected worker", live: true }] : [] }));
    const archive = vi.fn(async ({ missionId }: { missionId: string }) => { hidden.add(missionId); return { ok: true }; });
    vi.stubGlobal("codeBrainApp", { operations: { snapshot: getSnapshot, archive } });
    return { getSnapshot, archive, hidden };
  }

  it("archives only one card and keeps it hidden after refresh and remount", async () => {
    const { archive } = fixture();
    const view = render(<OperationsBoard workspacePaths={["/project"]} {...actions} />);
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "Arquivar operação One" }));
    await waitFor(() => expect(screen.queryByText("One")).toBeNull());
    expect(archive).toHaveBeenCalledWith({ workspace: "/project", missionId: "m1", confirmedActive: false });
    expect(screen.getByText("Two")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /atualizar/ }));
    await waitFor(() => expect(screen.queryByText("One")).toBeNull());
    view.unmount();
    render(<OperationsBoard workspacePaths={["/project"]} {...actions} />);
    await screen.findByText("Two");
    expect(screen.queryByText("One")).toBeNull();
  });

  it("shows the precise active-pane confirmation on the selected card and lets cancel preserve everything", async () => {
    const { archive } = fixture(true);
    render(<OperationsBoard workspacePaths={["/project"]} {...actions} />);
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "Arquivar operação One" }));
    const dialog = screen.getByRole("alertdialog", { name: "Arquivar One?" });
    expect(dialog.textContent).toContain("Selected worker");
    expect(dialog.textContent).toContain("continuará executando");
    expect(dialog.textContent).toContain("/project");
    expect(archive).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Arquivar operação One" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar arquivamento de One" }));
    await waitFor(() => expect(screen.queryByText("One")).toBeNull());
    expect(archive).toHaveBeenCalledWith({ workspace: "/project", missionId: "m1", confirmedActive: true });
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("keeps the card and shows an error when persistence fails", async () => {
    const { archive } = fixture();
    archive.mockImplementationOnce(async () => ({ ok: false, error: "disco indisponível" } as any));
    render(<OperationsBoard workspacePaths={["/project"]} {...actions} />);
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "Arquivar operação One" }));
    await screen.findByText("disco indisponível");
    expect(screen.getByText("One")).toBeTruthy();
  });

  it("requires fresh confirmation when main discovers a live pane absent from the old snapshot", async () => {
    const { archive } = fixture();
    archive.mockImplementationOnce(async () => ({ ok: false, requiresConfirmation: true, activePaneIds: ["new-pane"] } as any));
    render(<OperationsBoard workspacePaths={["/project"]} {...actions} />);
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "Arquivar operação One" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("new-pane");
    expect(screen.getByText("One")).toBeTruthy();
  });

  it("ignores a stale pre-archive snapshot that arrives after the durable archive", async () => {
    const { getSnapshot } = fixture();
    let finishOld: (data: unknown) => void = () => {};
    render(<OperationsBoard workspacePaths={["/project"]} {...actions} />);
    await screen.findByText("One");
    getSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }) as any);
    fireEvent.click(screen.getByRole("button", { name: /atualizar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Arquivar operação One" }));
    await waitFor(() => expect(screen.queryByText("One")).toBeNull());
    await act(async () => { finishOld(snapshot("/project", "One")); });
    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getByText("Two")).toBeTruthy();
  });
});
