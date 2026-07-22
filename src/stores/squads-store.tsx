import { create } from "zustand";

export type SquadAgentCategory =
  | "builder"
  | "planner"
  | "researcher"
  | "reviewer"
  | "tester"
  | "devops"
  | "designer"
  | string;

export interface SquadAgent {
  id: string;
  /** Display name / handle for this agent slot */
  agentName: string;
  /** Functional category — shown as badge in the UI */
  category: SquadAgentCategory;
  /** CLI runner: "claude" | "openclaude" | "gemini" | "codex" | "shell" */
  cli: string;
  /** Provider ID (from providers store) */
  providerId?: string;
  /** Model override */
  model?: string;
  /** Reasoning effort hint: "low" | "medium" | "high" */
  effort?: "low" | "medium" | "high";
  /** Skills this agent is allowed to use (null = all) */
  allowedSkills?: string[] | null;
  /** If true, this agent is a sub-orchestrator that only delegates — never writes code */
  delegateOnly?: boolean;
  /** Callable alias used in squadCallable injection */
  invocable?: string;
  /** If true, this agent is a leaf executor (no further delegation) */
  leaf?: boolean;
}

export interface Squad {
  id: string;
  name: string;
  description?: string;
  /** Overall squad mode */
  mode?: "sequential" | "parallel" | "auto";
  /** Orchestrator config */
  orchestrator: {
    providerId?: string;
    model?: string;
    cli?: string;
    effort?: "low" | "medium" | "high";
    allowedSkills?: string[] | null;
  };
  /** High-level instructions injected into the orchestrator system prompt */
  orchestratorInstructions?: string;
  /** Skills the orchestrator itself is allowed to use */
  orchestratorAllowedSkills?: string[] | null;
  /** Per-platform native instructions (injected verbatim) */
  nativeInstructions?: string;
  /** Worker agents */
  agents: SquadAgent[];
  createdAt: number;
  updatedAt?: number;
}

interface SquadsState {
  squads: Squad[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (squad: Squad) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export const useSquadsStore = create<SquadsState>((set, get) => ({
  squads: [],
  loaded: false,

  load: async () => {
    const list = (await window.codeBrainApp?.squads?.list?.()) ?? [];
    set({ squads: list as Squad[], loaded: true });
  },

  save: async (squad: Squad) => {
    const updated = { ...squad, updatedAt: Date.now() };
    const res = (await window.codeBrainApp?.squads?.save?.(updated as any)) ?? { ok: false };
    if ((res as any).ok) await get().load();
    return res as { ok: boolean; error?: string };
  },

  remove: async (id: string) => {
    const res = (await window.codeBrainApp?.squads?.delete?.(id)) ?? { ok: false };
    if ((res as any).ok) await get().load();
    return res as { ok: boolean; error?: string };
  },
}));

/** Subscribe to backend push-updates (mirrors provider pattern) */
export function subscribeSquadUpdates(): () => void {
  const off = (window.codeBrainApp?.squads as any)?.onUpdated?.((squads: Squad[]) => {
    useSquadsStore.setState({ squads, loaded: true });
  });
  return off ?? (() => {});
}

/** @deprecated Use SquadAgent instead */
export type SquadWorker = SquadAgent;

/** Convert SquadAgent[] to squadCallable format for pane_spawn */
export function buildSquadCallable(agents: SquadAgent[]): object[] {
  return agents.map((a) => ({
    role: a.category ?? "builder",
    agentName: a.agentName,
    cli: a.cli || "claude",
    ...(a.providerId ? { providerId: a.providerId } : {}),
    ...(a.model ? { model: a.model } : {}),
    ...(a.effort ? { effort: a.effort } : {}),
    ...(a.allowedSkills != null ? { allowedSkills: a.allowedSkills } : {}),
    ...(a.delegateOnly ? { delegateOnly: true } : {}),
    ...(a.invocable ? { invocable: a.invocable } : {}),
    ...(a.leaf ? { leaf: true } : {}),
  }));
}
