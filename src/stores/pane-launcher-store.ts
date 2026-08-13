import { create } from "zustand";

interface PaneLauncherState {
  open: boolean;
  request: { title?: string; subtitle?: string; initialPrompt?: string } | null;
  show: (request?: { title?: string; subtitle?: string; initialPrompt?: string }) => void;
  close: () => void;
}

export const usePaneLauncherStore = create<PaneLauncherState>((set) => ({
  open: false,
  request: null,
  show: (request) => set({ open: true, request: request ?? null }),
  close: () => set({ open: false, request: null }),
}));
