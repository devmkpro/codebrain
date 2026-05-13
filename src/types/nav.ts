export type ViewKind = "home" | "workspace" | "activity";

export interface HomeView {
  kind: "home";
}

export interface WorkspaceView {
  kind: "workspace";
  workspacePath: string;
}

export interface ActivityView {
  kind: "activity";
  workspacePath: string;
  activityId: string;
}

export type AppView = HomeView | WorkspaceView | ActivityView;

export interface TabView {
  kind: "workspace" | "activity";
  activityId?: string;
}

export interface Tab {
  workspacePath: string;
  view: TabView;
}
