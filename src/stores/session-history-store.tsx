import { create } from "zustand";
import type { SessionHistoryEntry } from "../types/electron";

interface SessionHistoryState {
  visible: boolean;
  sessions: SessionHistoryEntry[];
  loading: boolean;
  toggle: () => void;
  load: () => Promise<void>;
  deleteOne: (id: string) => Promise<void>;
}

export const useSessionHistoryStore = create<SessionHistoryState>((set, get) => ({
  visible: false,
  sessions: [],
  loading: false,

  toggle: () => {
    const next = !get().visible;
    set({ visible: next });
    if (next) get().load();
  },

  load: async () => {
    set({ loading: true });
    try {
      const sessions = await window.codeBrainApp.session.loadAll("");
      set({ sessions: sessions || [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  deleteOne: async (id: string) => {
    try {
      await window.codeBrainApp.session.deleteOne("", id);
      set({ sessions: get().sessions.filter((s) => s.id !== id) });
    } catch {}
  },
}));
