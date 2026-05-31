import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { workspaceForPane, findLeaf, removeLeaf, insertNextToLeaf, appendLeafBalanced, insertWorkLeaf } from "../components/auth/AuthLayout";

// usePanesStore
export const usePanesStore = create((set, get) => ({
  panes: [],
  activePaneId: null,
  pendingActivePaneId: null,
  layouts: {},
  addPane: config => {
    const id = config.id ?? nanoid();
    const existing = get().panes.find(p => p.id === id);
    if (existing) return existing;
    const session = config.session ?? (config.claudeSessionId ? {
      provider: "claude",
      id: config.claudeSessionId,
      capturedAt: Date.now(),
      confidence: "high",
      source: "transcript-file"
    } : void 0);
    if (session?.confidence === "high") {
      const sameSession = get().panes.find(p => p.session?.provider === session.provider && p.session?.id === session.id);
      if (sameSession) {
        set({
          activePaneId: sameSession.id
        });
        return sameSession;
      }
    }
    const kind = config.kind ?? "terminal";
    const pane = {
      id,
      agent: config.agent ?? "shell",
      cwd: config.cwd ?? "/",
      workspacePath: config.workspacePath,
      args: config.args,
      kind,
      url: config.url,
      status: kind === "browser" ? "running" : "booting",
      collapsed: false,
      title: kind === "browser" ? "browser" : config.agent ?? "shell",
      externallySpawned: config.externallySpawned,
      activityId: config.activityId,
      session,
      lastLines: config.lastLines,
      claudeSessionId: config.claudeSessionId ?? (session?.provider === "claude" ? session.id : void 0),
      subtaskId: config.subtaskId,
      providerId: config.providerId,
      model: config.model,
      permissionMode: config.permissionMode,
      missionId: config.missionId,
    };
    set(s => {
      const ws = pane.workspacePath ?? pane.cwd;
      const existingLayout = s.layouts[ws] ?? null;
      const newLeaf = {
        kind: "leaf",
        paneId: pane.id
      };
      const nextLayout = findLeaf(existingLayout, pane.id) ? existingLayout : kind === "browser" ? appendLeafBalanced(existingLayout, newLeaf) : insertWorkLeaf(existingLayout, s.panes, newLeaf);
      return {
        panes: [...s.panes, pane],
        activePaneId: pane.id,
        layouts: {
          ...s.layouts,
          [ws]: nextLayout
        }
      };
    });
    return pane;
  },
  removePane: id => set(s => {
    const ws = workspaceForPane(s.panes, id);
    const remaining = s.panes.filter(p => p.id !== id);
    const nextActive = s.activePaneId === id ? remaining[remaining.length - 1]?.id ?? null : s.activePaneId;
    const layouts = {
      ...s.layouts
    };
    if (ws) layouts[ws] = removeLeaf(layouts[ws] ?? null, id);
    return {
      panes: remaining,
      activePaneId: nextActive,
      layouts
    };
  }),
  setActive: id => set({
    activePaneId: id
  }),
  setPendingActive: id => set({
    pendingActivePaneId: id
  }),
  updatePane: (id, patch) => set(s => ({
    panes: s.panes.map(p => p.id === id ? {
      ...p,
      ...patch
    } : p)
  })),
  collapsePane: (id, collapsed) => set(s => ({
    panes: s.panes.map(p => p.id === id ? {
      ...p,
      collapsed
    } : p)
  })),
  movePaneTo: (workspacePath, fromPaneId, toLeafPaneId, side) => set(s => {
    if (fromPaneId === toLeafPaneId) return s;
    const root2 = s.layouts[workspacePath];
    if (!root2) return s;
    const detached = removeLeaf(root2, fromPaneId);
    if (!detached) return s;
    if (!findLeaf(detached, toLeafPaneId)) return s;
    const newLeaf = {
      kind: "leaf",
      paneId: fromPaneId
    };
    const reinserted = insertNextToLeaf(detached, toLeafPaneId, newLeaf, side);
    return {
      layouts: {
        ...s.layouts,
        [workspacePath]: reinserted
      }
    };
  }),
  updatePaneMission: (paneId, missionId) => set(s => ({
    panes: s.panes.map(p => p.id === paneId ? { ...p, missionId } : p),
  }))
}));