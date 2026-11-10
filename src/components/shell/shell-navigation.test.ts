import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRouter, back, forward, getLocation, navigate } from "../../lib/router";
import { toLocation } from "../../lib/router-core";
import { useNavStore } from "../../stores/nav-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { connectShellNavigation, navigateHome, shellNavState } from "./shell-navigation";

let disconnect: (() => void) | undefined;
beforeEach(() => {
  __resetRouter();
  useNavStore.setState({ tabs: [], activeTabIndex: 0, onHome: true, history: [] });
  usePaneLauncherStore.getState().close();
});
afterEach(() => { disconnect?.(); disconnect = undefined; });

describe("shell navigation history", () => {
  it("records workspaces and restores Home/workspace/activity on back and forward", async () => {
    disconnect = connectShellNavigation();
    shellNavState().openWorkspace("D:/project");
    await Promise.resolve();
    expect(getLocation()).toEqual(toLocation("/workspace", { query: { path: "D:/project" } }));
    shellNavState().navigateInActiveTab({ kind: "activity", activityId: "a" });
    await Promise.resolve();
    back();
    expect(shellNavState().tabs[0].view.kind).toBe("workspace");
    back();
    expect(shellNavState().onHome).toBe(true);
    expect(getLocation().path).toBe("/");
    forward();
    expect(shellNavState().onHome).toBe(false);
    expect(shellNavState().tabs).toHaveLength(1);
  });

  it("reveals settings and closes the launcher when navigating from a workspace", async () => {
    disconnect = connectShellNavigation();
    shellNavState().openWorkspace("D:/project");
    await Promise.resolve();
    usePaneLauncherStore.getState().show();
    navigate("/settings");
    expect(shellNavState().onHome).toBe(true);
    expect(usePaneLauncherStore.getState().open).toBe(false);
    back();
    expect(shellNavState().onHome).toBe(false);
  });

  it("Home always closes the launcher and reveals the dashboard", async () => {
    disconnect = connectShellNavigation();
    shellNavState().openWorkspace("D:/project");
    await Promise.resolve();
    usePaneLauncherStore.getState().show();
    navigateHome();
    expect(getLocation().path).toBe("/");
    expect(shellNavState().onHome).toBe(true);
    expect(usePaneLauncherStore.getState().open).toBe(false);
    expect(shellNavState().tabs).toHaveLength(1);
  });

  it("preserves a Central deep link with an empty clean profile", async () => {
    __resetRouter(toLocation("/central", { query: { s: "tarefas" } }));
    disconnect = connectShellNavigation();
    await Promise.resolve();
    expect(getLocation()).toEqual(toLocation("/central", { query: { s: "tarefas" } }));
    expect(shellNavState().onHome).toBe(true);
  });

  it("does not insert an intermediate home entry for goHome followed by explicit navigation", async () => {
    disconnect = connectShellNavigation();
    shellNavState().openWorkspace("D:/project");
    await Promise.resolve();
    shellNavState().goHome();
    navigate("/settings");
    await Promise.resolve();
    back();
    expect(getLocation().path).toBe("/workspace");
  });
});
