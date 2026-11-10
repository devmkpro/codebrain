import React from "react";
import { getLocation, navigate, subscribeRouter } from "../../lib/router";
import { isSameLocation, ROOT, toLocation, type Location } from "../../lib/router-core";
import { useNavStore } from "../../stores/nav-store";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useTasksStore } from "../../stores/tasks-store";
import { useCronStore } from "../../stores/cron-store";
import { useMemoryStore } from "../../stores/memory-store";
import { useSessionHistoryStore } from "../../stores/session-history-store";
import { useCostStore } from "../../stores/cost-store";
import { usePanesStore } from "../../stores/panes-store";

export interface ShellNavState {
  tabs: Array<{ workspacePath: string; view: { kind: string; activityId?: string } }>;
  activeTabIndex: number;
  onHome: boolean;
  goHome: () => void;
  openWorkspace: (path: string) => void;
  navigateInActiveTab: (view: { kind: string; activityId?: string }) => void;
}

export const shellNavState = (): ShellNavState => useNavStore.getState() as ShellNavState;

function dismissShellOverlays(): void {
  usePaneLauncherStore.getState().close();
  useTasksStore.setState({ visible: false });
  useCronStore.setState({ visible: false });
  useMemoryStore.setState({ visible: false });
  useSessionHistoryStore.setState({ visible: false });
  useCostStore.setState({ visible: false });
}

/** Workspace views join the same history as home pages, without unmounting PTYs. */
export function connectShellNavigation(): () => void {
  const initialDeepLink = getLocation().path !== "/";
  let applyingRoute = false;
  let disposed = false;
  let queued = false;
  let lastHome = getLocation().path === "/workspace" ? ROOT : getLocation();

  const applyRoute = () => {
    const location = getLocation();
    applyingRoute = true;
    try {
      dismissShellOverlays();
      const nav = shellNavState();
      if (location.path === "/workspace" && location.query.path) {
        nav.openWorkspace(location.query.path);
        const view = location.query.activity
          ? { kind: "activity", activityId: location.query.activity }
          : { kind: "workspace" };
        shellNavState().navigateInActiveTab(view);
      } else {
        lastHome = location;
        nav.goHome();
      }
    } finally {
      applyingRoute = false;
    }
  };

  const locationForView = (): Location => {
    const nav = shellNavState();
    const tab = nav.tabs[nav.activeTabIndex];
    if (nav.onHome || !tab) return lastHome;
    return toLocation("/workspace", { query: {
      path: tab.workspacePath,
      activity: tab.view.kind === "activity" ? tab.view.activityId : undefined,
    } });
  };

  const recordView = () => {
    queued = false;
    if (disposed) return;
    const next = locationForView();
    if (!isSameLocation(next, getLocation())) navigate(next.path, { query: { ...next.query } });
  };

  const unsubscribeNav = useNavStore.subscribe(() => {
    if (applyingRoute || queued) return;
    queued = true;
    // goHome(); navigate('/settings') is one user action. Let its explicit
    // route win instead of inserting a spurious intermediate home entry.
    queueMicrotask(recordView);
  });
  const unsubscribeRouter = subscribeRouter(applyRoute);
  const unsubscribeHydration = useNavStore.persist.onFinishHydration(() => {
    if (initialDeepLink) applyRoute();
    else recordView();
  });

  if (getLocation().path !== "/") applyRoute();
  else recordView(); // Restore a persisted workspace, with Home behind it.

  return () => {
    disposed = true;
    unsubscribeNav();
    unsubscribeRouter();
    unsubscribeHydration();
  };
}

export function useShellNavigation(): void {
  React.useEffect(connectShellNavigation, []);
}

/** Home is a destination, even when a workspace or spawn selector is visible. */
export function navigateHome(): void {
  dismissShellOverlays();
  shellNavState().goHome();
  navigate("/");
}

/** Open the selected live terminal in its workspace, leaving landing/overlays. */
export function navigateToPane(paneId: string): void {
  const panes = usePanesStore.getState() as any;
  const pane = panes.panes.find((item: any) => item.id === paneId);
  const workspace = pane?.workspacePath ?? pane?.cwd;
  if (!workspace) return;
  dismissShellOverlays();
  panes.revealPane(paneId);
  shellNavState().openWorkspace(workspace);
  shellNavState().navigateInActiveTab({ kind: "workspace" });
  navigate("/workspace", { query: { path: workspace } });
}
