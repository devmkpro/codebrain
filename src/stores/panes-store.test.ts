import { beforeEach, describe, expect, it } from "vitest";
import { usePanesStore } from "./panes-store";

describe("panes layout movement", () => {
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
