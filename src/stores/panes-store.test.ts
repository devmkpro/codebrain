import { beforeEach, describe, expect, it } from "vitest";
import { usePanesStore } from "./panes-store";
import { useMissionsStore } from "./missions-store";

describe("panes layout movement", () => {
  it("reveals an existing terminal even when the active mission has no layout", () => {
    const ws = "C:\\project";
    const mission = useMissionsStore.getState().ensureMissionForWorkspace(ws);
    usePanesStore.setState({ panes: [{ id: "hidden", cwd: ws, missionId: mission }], layouts: {}, activePaneId: null });
    (usePanesStore.getState() as any).revealPane("hidden");
    const state = usePanesStore.getState() as any;
    expect(state.activePaneId).toBe("hidden");
    expect(state.layouts[ws][mission]).toEqual({ kind: "leaf", paneId: "hidden" });
    expect(useMissionsStore.getState().getActiveMissionId(ws)).toBe(mission);
  });
  it("switches to the selected terminal's mission without spawning or losing its siblings", () => {
    const ws = "C:\\project";
    const missions = useMissionsStore.getState();
    missions.ensureMissionForWorkspace(ws);
    const selected = missions.createMission(ws, { title: "Other" });
    usePanesStore.setState({ panes: [{ id: "selected", cwd: ws, missionId: selected }], layouts: { [ws]: { [selected]: { kind: "split", axis: "h", a: { kind: "leaf", paneId: "selected" }, b: { kind: "leaf", paneId: "sibling" }, ratio: 50 } } } });
    (usePanesStore.getState() as any).revealPane("selected");
    expect(useMissionsStore.getState().getActiveMissionId(ws)).toBe(selected);
    expect((usePanesStore.getState() as any).layouts[ws][selected].kind).toBe("split");
  });
  it("does not merge the same native ID across profiles or resurrect an exited pane", () => {
    usePanesStore.setState({ panes: [], layouts: {}, activePaneId: null });
    const first = { id: "profile-one", agent: "codex", cwd: "C:\\project", accountId: "one", session: { provider: "codex", id: "native-id", confidence: "high", scopeKey: "one" } };
    const store = usePanesStore.getState() as any;
    store.addPane(first);
    store.addPane({ ...first, id: "profile-two", accountId: "two", session: { ...first.session, scopeKey: "two" } });
    expect((usePanesStore.getState() as any).panes).toHaveLength(2);
    store.updatePane("profile-one", { status: "exited" });
    store.addPane({ ...first, id: "resumed-one" });
    expect((usePanesStore.getState() as any).panes).toHaveLength(3);
    expect((usePanesStore.getState() as any).panes.find(p => p.id === "resumed-one")?.accountId).toBe("one");
  });
  beforeEach(() => {
    usePanesStore.setState({
      panes: [
        { id: "target", cwd: "C:\\project", workspacePath: "C:\\project", missionId: "main" },
        { id: "dragged", cwd: "C:\\project", workspacePath: "C:\\project", missionId: "other" },
      ],
      activePaneId: "target",
      layouts: {
        "C:\\project": {
          main: { kind: "leaf", paneId: "target" },
          other: { kind: "leaf", paneId: "dragged" },
        },
      },
    });
  });

  it("moves a rail pane beside the target in the active mission", () => {
    usePanesStore.getState().movePaneTo("C:\\project", "dragged", "target", "right");
    const state = usePanesStore.getState();
    expect(state.layouts["C:\\project"].main).toEqual({
      kind: "split",
      axis: "h",
      a: { kind: "leaf", paneId: "target" },
      b: { kind: "leaf", paneId: "dragged" },
      ratio: 50,
    });
    expect(state.layouts["C:\\project"].other).toBeUndefined();
    expect(state.panes.find((pane: any) => pane.id === "dragged")?.missionId).toBe("main");
  });

  it("removes a closed agent from panes and layouts", () => {
    usePanesStore.getState().removePane("dragged");
    const state = usePanesStore.getState();
    expect(state.panes.some((pane: any) => pane.id === "dragged")).toBe(false);
    expect(state.layouts["C:\\project"].other).toBeUndefined();
  });
});
