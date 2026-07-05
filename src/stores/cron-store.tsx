import { create } from "zustand";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  status: "active" | "paused";
  workspace: string | null;
  task_prompt: string;
  agent: string;
  model: string | null;
  label: string | null;
  next_fire_at: number | null;
  last_fired_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface CronCreateInput {
  name: string;
  schedule: string;
  task_prompt: string;
  agent?: string;
  model?: string;
  label?: string;
}

interface CronStore {
  // State
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
  visible: boolean;
  creating: boolean;

  // Actions
  load: () => Promise<void>;
  create: (input: CronCreateInput) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  toggleStatus: (job: CronJob) => Promise<boolean>;
  toggle: () => void;
  clearError: () => void;
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useCronStore = create<CronStore>((set, get) => ({
  jobs: [],
  loading: false,
  error: null,
  visible: false,
  creating: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const res = await window.codeBrainApp.cron.list();
      if (res?.ok) {
        set({ jobs: res.jobs || [], loading: false });
      } else {
        set({ loading: false, error: res?.error || "Failed to load cron jobs" });
      }
    } catch (err: any) {
      set({ loading: false, error: err?.message || String(err) });
    }
  },

  create: async (input: CronCreateInput) => {
    set({ creating: true, error: null });
    try {
      const res = await window.codeBrainApp.cron.create(input);
      if (res?.ok) {
        set({ creating: false });
        await get().load();
        return true;
      }
      set({ creating: false, error: res?.error || "Failed to create cron job" });
      return false;
    } catch (err: any) {
      set({ creating: false, error: err?.message || String(err) });
      return false;
    }
  },

  remove: async (id: string) => {
    try {
      const res = await window.codeBrainApp.cron.delete({ id });
      if (res?.ok) {
        await get().load();
        return true;
      }
      set({ error: res?.error || "Failed to delete cron job" });
      return false;
    } catch (err: any) {
      set({ error: err?.message || String(err) });
      return false;
    }
  },

  toggleStatus: async (job: CronJob) => {
    const newStatus = job.status === "active" ? "paused" : "active";
    try {
      const res = await window.codeBrainApp.cron.update({ id: job.id, status: newStatus });
      if (res?.ok) {
        await get().load();
        return true;
      }
      set({ error: res?.error || "Failed to update cron job" });
      return false;
    } catch (err: any) {
      set({ error: err?.message || String(err) });
      return false;
    }
  },

  toggle: () => set((s) => ({ visible: !s.visible })),
  clearError: () => set({ error: null }),
}));
