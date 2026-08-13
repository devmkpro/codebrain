import { beforeEach, describe, expect, it } from "vitest";
import { useNavStore } from "./nav-store";

const tab = (workspacePath: string) => ({ workspacePath, view: { kind: "workspace" } });

describe("nav store workspace closing", () => {
  beforeEach(() => {
    useNavStore.setState({
      tabs: [tab("A"), tab("B"), tab("C")],
      activeTabIndex: 2,
      onHome: false,
      history: [],
    });
  });

  it("preserves the active workspace when a previous tab is removed", () => {
    useNavStore.getState().closeTab(0);
    const state = useNavStore.getState();
    expect(state.activeTabIndex).toBe(1);
    expect(state.tabs[state.activeTabIndex].workspacePath).toBe("C");
  });

  it("goes home after the last workspace is removed", () => {
    useNavStore.setState({ tabs: [tab("A")], activeTabIndex: 0, onHome: false });
    useNavStore.getState().closeTab(0);
    expect(useNavStore.getState()).toMatchObject({ tabs: [], activeTabIndex: 0, onHome: true });
  });
});
