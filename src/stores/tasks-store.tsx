import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// useTasksStore
export const useTasksStore = create(set => ({
  list: [],
  activeTaskId: null,
  visible: false,
  load: async () => {
    const state = (await window.codeBrainApp?.tasks?.list?.()) ?? {
      list: [],
      activeTaskId: null
    };
    set({
      list: state.list ?? [],
      activeTaskId: state.activeTaskId ?? null
    });
  },
  setState: state => set({
    list: state.list ?? [],
    activeTaskId: state.activeTaskId ?? null
  }),
  toggle: () => set(s => ({
    visible: !s.visible
  }))
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