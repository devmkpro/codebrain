import { create } from "zustand";

export interface CostModelSummary {
  cost: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

export interface CostSummaryData {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Record<string, CostModelSummary>;
  byAgent: Record<string, CostModelSummary>;
}

export interface CostAlert {
  timestamp: number;
  type: string;
  message: string;
  sessionId?: string;
  cost?: number;
}

export interface CostTaskEntry {
  taskId: string | null;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
  model: string;
  agentId?: string;
  startedAt: number;
}

interface CostState {
  visible: boolean;
  summary: CostSummaryData | null;
  taskSummary: { tasks: CostTaskEntry[]; totalTasks: number } | null;
  alerts: CostAlert[];
  models: Record<string, { input: number; output: number }>;
  period: "today" | "week" | "month" | "all";
  loading: boolean;
  resetBusy: boolean;
  msg: string | null;

  toggle: () => void;
  setPeriod: (p: "today" | "week" | "month" | "all") => void;
  loadSummary: () => Promise<void>;
  loadTaskSummary: () => Promise<void>;
  loadAlerts: () => Promise<void>;
  loadModels: () => Promise<void>;
  setModelCost: (model: string, inputCost: number, outputCost: number) => Promise<boolean>;
  deleteModelCost: (model: string) => Promise<boolean>;
  resetUsage: (workspace?: string) => Promise<void>;
  clearMsg: () => void;
}

export const useCostStore = create<CostState>((set, get) => ({
  visible: false,
  summary: null,
  taskSummary: null,
  alerts: [],
  models: {},
  period: "all",
  loading: false,
  resetBusy: false,
  msg: null,

  toggle: () => set((s) => ({ visible: !s.visible })),

  setPeriod: (period) => {
    set({ period });
    get().loadSummary();
    get().loadTaskSummary();
  },

  loadSummary: async () => {
    set({ loading: true });
    try {
      const { period } = get();
      const result = await (window as any).codeBrainApp?.cost?.summary?.({ period });
      if (result?.ok) set({ summary: result.data || null });
    } catch {}
    set({ loading: false });
    get().loadTaskSummary();
  },

  loadTaskSummary: async () => {
    try {
      const { period } = get();
      const result = await (window as any).codeBrainApp?.cost?.taskSummary?.({ period });
      if (result?.ok) set({ taskSummary: result.data || null });
    } catch {}
  },

  loadAlerts: async () => {
    try {
      const result = await (window as any).codeBrainApp?.cost?.getAlerts?.({ limit: 30 });
      if (result?.ok) set({ alerts: result.data || [] });
    } catch {}
  },

  loadModels: async () => {
    try {
      const result = await (window as any).codeBrainApp?.cost?.listModels?.();
      if (result?.ok) set({ models: result.data || {} });
    } catch {}
  },

  setModelCost: async (model, inputCost, outputCost) => {
    try {
      const result = await (window as any).codeBrainApp?.cost?.setModelCost?.({ model, inputCost, outputCost });
      if (result?.ok) {
        get().loadModels();
        return true;
      }
    } catch {}
    return false;
  },

  deleteModelCost: async (model) => {
    try {
      const result = await (window as any).codeBrainApp?.cost?.deleteModelCost?.({ model });
      if (result?.ok) {
        get().loadModels();
        return true;
      }
    } catch {}
    return false;
  },

  resetUsage: async (workspace?: string) => {
    set({ resetBusy: true, msg: null });
    try {
      const result = await (window as any).codeBrainApp?.cost?.reset?.({ workspace });
      if (result?.ok) {
        const c = result.cleared;
        set({ msg: `Zerado: ${c?.sessions ?? 0} sessoes, ${c?.alerts ?? 0} alertas.` });
        get().loadSummary();
        get().loadAlerts();
        get().loadTaskSummary();
      } else {
        set({ msg: "Erro ao zerar." });
      }
    } catch {
      set({ msg: "Erro ao zerar." });
    }
    set({ resetBusy: false });
    setTimeout(() => set({ msg: null }), 5000);
  },

  clearMsg: () => set({ msg: null }),
}));
