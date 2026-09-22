import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appStorage } from "./persist-storage";

interface OnboardingState {
  completed: boolean;
  visible: boolean;
  step: number;
  show: () => void;
  setStep: (step: number) => void;
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      visible: true,
      step: 0,
      show: () => set({ visible: true, step: 0 }),
      setStep: (step) => set({ step: Math.max(0, Math.min(step, 2)) }),
      finish: () => set({ completed: true, visible: false, step: 0 }),
    }),
    {
      name: "codebrain.onboarding.terminal-first",
      storage: appStorage,
      version: 1,
      partialize: (state) => ({ completed: state.completed }),
      merge: (persisted, current) => {
        const completed = Boolean((persisted as Partial<OnboardingState> | undefined)?.completed);
        return { ...current, completed, visible: !completed };
      },
    },
  ),
);
