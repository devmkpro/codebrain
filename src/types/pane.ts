import type { Session } from "./electron";

export type PaneKind = "terminal" | "browser";
export type PaneStatus = "booting" | "running" | "idle" | "error" | "exited";
export type PaneAgent = "claude" | "shell" | string;

export interface Pane {
  id: string;
  agent: PaneAgent;
  cwd: string;
  workspacePath?: string;
  args?: string[];
  kind: PaneKind;
  url?: string;
  status: PaneStatus;
  collapsed: boolean;
  title: string;
  externallySpawned?: boolean;
  activityId?: string;
  session?: Session;
  lastLines?: string[];
  claudeSessionId?: string;
  subtaskId?: string;
  providerId?: string;
  model?: string;
  permissionMode?: string;
  role?: string;
  mission_id?: string;
}

// Layout tree types for the grid system
export type LayoutNode = LayoutLeaf | LayoutSplit;

export interface LayoutLeaf {
  kind: "leaf";
  paneId: string;
}

export interface LayoutSplit {
  kind: "horizontal" | "vertical";
  children: [LayoutNode, LayoutNode];
  sizes?: [number, number];
}

export type DropSide = "left" | "right" | "top" | "bottom";
