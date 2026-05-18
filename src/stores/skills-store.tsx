import { create } from "zustand";
import type { SkillManifest } from "../types/electron";

export interface SkillEntry {
  manifest: SkillManifest;
  path: string;
}

interface SkillsState {
  installed: SkillEntry[];
  registrySkills: SkillManifest[];
  loading: boolean;
  syncing: boolean;
  error: string | null;

  loadInstalled: (type?: string) => Promise<void>;
  loadRegistry: () => Promise<void>;
  getSkill: (id: string) => Promise<{ ok: boolean; manifest?: SkillManifest; content?: Record<string, string>; error?: string }>;
  installFromRegistry: (id: string) => Promise<{ ok: boolean; error?: string }>;
  uninstallSkill: (id: string) => Promise<{ ok: boolean; error?: string }>;
  sync: (direction: "pull" | "push") => Promise<{ ok: boolean; results?: Array<{ id: string; action: string; version?: string }>; error?: string }>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  installed: [],
  registrySkills: [],
  loading: false,
  syncing: false,
  error: null,

  loadInstalled: async (type?: string) => {
    set({ loading: true, error: null });
    try {
      const entries = await window.codeBrainApp.skill.listInstalled(type ? { type } : undefined);
      set({ installed: entries, loading: false });
    } catch (err: any) {
      set({ error: err?.message || String(err), loading: false });
    }
  },

  loadRegistry: async () => {
    try {
      const result = await window.codeBrainApp.skill.registryIndex();
      if (result.ok && result.index) {
        set({ registrySkills: result.index.skills || [] });
      }
    } catch {}
  },

  getSkill: async (id: string) => {
    try {
      return await window.codeBrainApp.skill.get({ id });
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },

  installFromRegistry: async (id: string) => {
    try {
      const result = await window.codeBrainApp.skill.installFromRegistry({ id });
      if (result.ok) {
        await get().loadInstalled();
      }
      return result;
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },

  uninstallSkill: async (id: string) => {
    try {
      const result = await window.codeBrainApp.skill.uninstallSkill({ id });
      if (result.ok) {
        await get().loadInstalled();
      }
      return result;
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  },

  sync: async (direction: "pull" | "push") => {
    set({ syncing: true, error: null });
    try {
      const result = await window.codeBrainApp.skill.sync({ direction });
      if (result.ok) {
        await get().loadInstalled();
      }
      set({ syncing: false });
      return result;
    } catch (err: any) {
      set({ syncing: false, error: err?.message || String(err) });
      return { ok: false, error: err?.message || String(err) };
    }
  },
}));
