import { create } from "zustand";

interface PaneLauncherState {
  open: boolean;
  show: () => void;
  close: () => void;
}

export const usePaneLauncherStore = create<PaneLauncherState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
