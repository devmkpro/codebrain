import { create } from "zustand";
import { nanoid } from "nanoid";
import { findLeaf, removeLeaf, insertNextToLeaf, appendLeafBalanced, insertWorkLeaf } from "../components/auth/AuthLayout";
import { useMissionsStore } from "./missions-store";
import { activityClockKey, derivePaneActivity } from "../components/shell/pane-status";
import { resumeIdentity } from "../lib/native-resume";

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

/** Campos de identidade que o backend envia por pane:added e pane.onMeta. */
const PANE_META_KEYS = [
  "label", "taskType", "effort", "accountLabel", "accountId", "parentPaneId", "role",
  "handoffStatus", "evidence", "contractStatus", "awaitingInput",
] as const;

function pickPaneMeta(source: any): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of PANE_META_KEYS) {
    if (source?.[key] !== undefined) meta[key] = source[key];
  }
  return meta;
}

/** Atualiza o relógio quando o pane muda de estado; pensar↔executar não conta. */
function withActivityClock(previous: any, next: any) {
  const before = activityClockKey(derivePaneActivity(previous));
  const after = activityClockKey(derivePaneActivity(next));
  return before === after ? next : { ...next, activitySince: Date.now() };
}

/**
 * Metadado que chegou antes do pane existir. Os ouvintes de pane:added rodam
 * em ordem de registro, e quem cria o pane pode vir depois de quem o descreve.
 */
const pendingPaneMeta = new Map<string, Record<string, unknown>>();
const PENDING_META_LIMIT = 64;

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
      const identity = resumeIdentity({ ...config, session });
      const sameSession = (get() as any).panes.find((p: any) => p.status !== "exited" && p.status !== "error" && resumeIdentity(p) === identity);
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
      status: kind === "browser" || kind === "office" ? "running" : "booting",
      collapsed: false,
      title: kind === "browser" ? "browser" : kind === "office" ? "escritório" : config.agent ?? "shell",
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
      activitySince: Date.now(),
      ...pickPaneMeta(config),
      ...pendingPaneMeta.get(id),
    };
    pendingPaneMeta.delete(id);
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
        : kind === "browser" || kind === "office"
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
  /** Selecting a rail row must reveal its layout, not only recolor the row. */
  revealPane: (id: string) => {
    const state = get() as any;
    const pane = state.panes.find((item: any) => item.id === id);
    if (!pane) return;
    const ws = pane.workspacePath ?? pane.cwd;
    if (!ws) return;
    const missions = useMissionsStore.getState();
    const available = missions.getWorkspaceMissions(ws).filter(m => m.status !== "archived");
    const owner = Object.entries(state.layouts[ws] ?? {}).find(([mid, layout]) =>
      available.some(m => m.id === mid) && findLeaf(layout, id));
    const missionId = owner?.[0] ?? (available.some(m => m.id === pane.missionId)
      ? pane.missionId : missions.ensureMissionForWorkspace(ws));
    const layout = state.layouts[ws]?.[missionId] ?? null;
    const cleanLayouts = removePaneFromLayouts(state.layouts, id);
    missions.setActiveMission(ws, missionId);
    set({
      activePaneId: id,
      panes: state.panes.map((item: any) => item.id === id ? { ...item, missionId } : item),
      layouts: findLeaf(layout, id) ? state.layouts : {
        ...cleanLayouts,
        [ws]: { ...cleanLayouts[ws], [missionId]: appendLeafBalanced(layout, { kind: "leaf", paneId: id }) },
      },
    });
  },
  setPendingActive: (id: string) => set({ pendingActivePaneId: id }),

  updatePane: (id: string, patch: any) => set((s: any) => ({
    panes: s.panes.map((p: any) => p.id === id ? withActivityClock(p, { ...p, ...patch }) : p),
  })),

  /** Metadado vindo do backend. Um nome dado pelo usuário não é sobrescrito. */
  applyPaneMeta: (id: string, source: any) => {
    const meta = pickPaneMeta(source);
    if (Object.keys(meta).length === 0) return;
    const pane = (get() as any).panes.find((p: any) => p.id === id);
    if (!pane) {
      if (pendingPaneMeta.size >= PENDING_META_LIMIT) {
        pendingPaneMeta.delete(pendingPaneMeta.keys().next().value as string);
      }
      pendingPaneMeta.set(id, { ...pendingPaneMeta.get(id), ...meta });
      return;
    }
    if (pane.labelLocked) delete meta.label;
    if (Object.keys(meta).every(key => pane[key] === meta[key])) return;
    set((s: any) => ({
      panes: s.panes.map((p: any) => p.id === id ? withActivityClock(p, { ...p, ...meta }) : p),
    }));
  },

  /** Sinal vivo lido da saída do terminal. Escreve só quando muda. */
  setPaneLive: (id: string, live: string | null) => {
    const pane = (get() as any).panes.find((p: any) => p.id === id);
    if (!pane || (pane.live ?? null) === live) return;
    set((s: any) => ({
      panes: s.panes.map((p: any) => p.id === id ? withActivityClock(p, { ...p, live }) : p),
    }));
  },

  /** Nome dado pelo usuário: vazio volta ao nome padrão. */
  renamePane: (id: string, name: string) => set((s: any) => ({
    panes: s.panes.map((p: any) => p.id === id
      ? { ...p, label: name.trim() || undefined, labelLocked: Boolean(name.trim()) }
      : p),
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
