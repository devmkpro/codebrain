import { create } from "zustand";
import { nanoid } from "nanoid";
import { findLeaf, removeLeaf, insertNextToLeaf, appendLeafBalanced, insertWorkLeaf } from "../components/auth/AuthLayout";
import { useMissionsStore } from "./missions-store";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Remove um paneId de todos os layouts [ws][missionId] */
function removePaneFromLayouts(layouts: Record<string, Record<string, any>>, paneId: string) {
  const next: Record<string, Record<string, any>> = {};
  for (const [ws, wsLayouts] of Object.entries(layouts)) {
    const nextWs: Record<string, any> = {};
    for (const [mid, layout] of Object.entries(wsLayouts)) {
      const updated = removeLeaf(layout, paneId);
      if (updated) nextWs[mid] = updated;
    }
    if (Object.keys(nextWs).length > 0) next[ws] = nextWs;
  }
  return next;
}

/** Obtém o missionId para um pane: usa config.missionId ou pede ao missions-store a missão ativa */
function missionForPane(config: any): string {
  if (config.missionId) return config.missionId;
  const ws = config.workspacePath ?? config.cwd;
  if (!ws) return "default";
  try {
    return useMissionsStore.getState().ensureMissionForWorkspace(ws);
  } catch {
    return "default";
  }
}

// usePanesStore
export const usePanesStore = create((set, get) => ({
  panes: [] as any[],
  activePaneId: null as string | null,
  pendingActivePaneId: null as string | null,
  // layouts: Record<workspacePath, Record<missionId, LayoutNode>>
  layouts: {} as Record<string, Record<string, any>>,

  addPane: (config: any) => {
    const id = config.id ?? nanoid();
    const existing = (get() as any).panes.find((p: any) => p.id === id);
    if (existing) return existing;
    const session = config.session ?? (config.claudeSessionId ? {
      provider: "claude",
      id: config.claudeSessionId,
      capturedAt: Date.now(),
      confidence: "high",
      source: "transcript-file"
    } : void 0);
    if (session?.confidence === "high") {
      const sameSession = (get() as any).panes.find((p: any) => p.session?.provider === session.provider && p.session?.id === session.id);
      if (sameSession) {
        set({ activePaneId: sameSession.id });
        return sameSession;
      }
    }
    // Resolve missionId (creates mission if needed)
    const missionId = missionForPane(config);
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
      missionId,
    };
    set((s: any) => {
      const ws = pane.workspacePath ?? pane.cwd;
      const missionLayouts = s.layouts[ws] ?? {};
      const existingLayout = missionLayouts[missionId] ?? null;
      // panes pertencentes a esta missão para o insertWorkLeaf
      const missionPanes = s.panes.filter((p: any) =>
        (p.workspacePath ?? p.cwd) === ws && (p.missionId === missionId || (!p.missionId && missionId))
      );
      const newLeaf = { kind: "leaf", paneId: pane.id };
      const nextLayout = findLeaf(existingLayout, pane.id)
        ? existingLayout
        : kind === "browser"
          ? appendLeafBalanced(existingLayout, newLeaf)
          : insertWorkLeaf(existingLayout, missionPanes, newLeaf);
      return {
        panes: [...s.panes, pane],
        activePaneId: pane.id,
        layouts: {
          ...s.layouts,
          [ws]: {
            ...missionLayouts,
            [missionId]: nextLayout,
          },
        },
      };
    });
    return pane;
  },

  removePane: (id: string) => set((s: any) => {
    const remaining = s.panes.filter((p: any) => p.id !== id);
    const nextActive = s.activePaneId === id
      ? remaining[remaining.length - 1]?.id ?? null
      : s.activePaneId;
    return {
      panes: remaining,
      activePaneId: nextActive,
      layouts: removePaneFromLayouts(s.layouts, id),
    };
  }),

  removeWorkspace: (workspacePath: string) => set((s: any) => {
    const remaining = s.panes.filter((p: any) => (p.workspacePath ?? p.cwd) !== workspacePath);
    const nextActive = remaining[remaining.length - 1]?.id ?? null;
    const layouts = { ...s.layouts };
    delete layouts[workspacePath];
    return { panes: remaining, activePaneId: nextActive, layouts };
  }),

  setActive: (id: string) => set({ activePaneId: id }),
  setPendingActive: (id: string) => set({ pendingActivePaneId: id }),

  updatePane: (id: string, patch: any) => set((s: any) => ({
    panes: s.panes.map((p: any) => p.id === id ? { ...p, ...patch } : p),
  })),

  collapsePane: (id: string, collapsed: boolean) => set((s: any) => ({
    panes: s.panes.map((p: any) => p.id === id ? { ...p, collapsed } : p),
  })),

  /** Mover pane para outra posição na grid (dentro da missão) */
  movePaneTo: (workspacePath: string, fromPaneId: string, toLeafPaneId: string, side: string) => set((s: any) => {
    if (fromPaneId === toLeafPaneId) return s;
    // Encontrar em qual missionId o toLeafPaneId está
    const wsLayouts = s.layouts[workspacePath];
    if (!wsLayouts) return s;
    let targetMissionId: string | null = null;
    for (const [mid, layout] of Object.entries(wsLayouts)) {
      if (findLeaf(layout as any, toLeafPaneId)) { targetMissionId = mid; break; }
    }
    if (!targetMissionId) return s;
    const targetRoot = wsLayouts[targetMissionId];
    if (!targetRoot) return s;
    let layouts = removePaneFromLayouts(s.layouts, fromPaneId);
    const detachedRoot = layouts[workspacePath]?.[targetMissionId] ?? targetRoot;
    if (!findLeaf(detachedRoot, toLeafPaneId)) return s;
    const reinserted = insertNextToLeaf(detachedRoot, toLeafPaneId, { kind: "leaf", paneId: fromPaneId }, side);
    return {
      panes: s.panes.map((p: any) => p.id === fromPaneId ? { ...p, workspacePath, missionId: targetMissionId } : p),
      layouts: {
        ...layouts,
        [workspacePath]: {
          ...layouts[workspacePath] ?? {},
          [targetMissionId]: reinserted,
        },
      },
    };
  }),

  /** Atualizar a missão de um pane (mover entre missões) */
  updatePaneMission: (paneId: string, missionId: string) => set((s: any) => {
    const pane = s.panes.find((p: any) => p.id === paneId);
    if (!pane) return s;
    const ws = pane.workspacePath ?? pane.cwd;
    // Remove do layout antigo
    let layouts = removePaneFromLayouts(s.layouts, paneId);
    // Insere no layout da nova missão
    const missionLayouts = layouts[ws] ?? {};
    const existingLayout = missionLayouts[missionId] ?? null;
    const newLeaf = { kind: "leaf", paneId };
    const nextLayout = appendLeafBalanced(existingLayout, newLeaf);
    layouts = {
      ...layouts,
      [ws]: { ...missionLayouts, [missionId]: nextLayout },
    };
    return {
      panes: s.panes.map((p: any) => p.id === paneId ? { ...p, missionId } : p),
      layouts,
    };
  }),
}));
