import React from "react";
import { create } from "zustand";

// useTasksStore — backed by kanban_tasks (persistent, mission-scoped)
export const useTasksStore = create(set => ({
  list: [] as any[],
  activeTaskId: null as string | null,
  visible: false,
  load: async () => {
    try {
      // Read workspace from active tab
      const navStore = (await import("./nav-store")).useNavStore.getState();
      const tabs = navStore.tabs as any[];
      const tab = tabs[navStore.activeTabIndex];
      const workspace = tab?.workspacePath as string | undefined;
      const state = await window.codeBrainApp?.tasks?.list?.({ workspace });
      set({
        list: state?.tasks ?? [],
        activeTaskId: state?.activeTaskId ?? null,
      });
    } catch {
      set({ list: [], activeTaskId: null });
    }
  },
  setState: (state: any) => set({
    list: state.tasks ?? state.list ?? [],
    activeTaskId: state.activeTaskId ?? null,
  }),
  toggle: () => set((s: any) => ({
    visible: !s.visible,
  })),
}));
export function subscribeTaskUpdates() {
  const off = window.codeBrainApp?.tasks?.onUpdated?.(state => {
    useTasksStore.getState().setState(state);
  });
  return off ?? (() => {});
}
function basename(p) {
  if (!p) return "";
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
export function tabLabel(tab) {
  return basename(tab.workspacePath) || tab.workspacePath;
}
export function isConversationVoiceMode(mode) {
  return mode === "conversation" || mode === "planning";
}
export function outputModeForInteractionMode(mode) {
  return isConversationVoiceMode(mode) ? "original" : "english";
}
export function normalizedVoiceMode(mode) {
  return isConversationVoiceMode(mode) ? "conversation" : "coding";
}
function BrainVoiceLockLabel(config) {
  if (config.BrainVoiceAccess.reason === "entitlement_missing") return "BOOST PRO";
  if (config.BrainVoiceAccess.reason === "inactive_subscription") return "ASSINATURA";
  if (config.BrainVoiceAccess.reason === "no_session") return "LOGIN";
  return "ASSINAR BrainVoice";
}