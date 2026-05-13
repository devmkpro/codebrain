import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// tabToView, deriveView, useNavStore
function tabToView(tab) {
  if (tab.view.kind === "activity") {
    return {
      kind: "activity",
      workspacePath: tab.workspacePath,
      activityId: tab.view.activityId
    };
  }
  return {
    kind: "workspace",
    workspacePath: tab.workspacePath
  };
}
function deriveView(state) {
  if (state.onHome || state.tabs.length === 0) return {
    kind: "home"
  };
  const tab = state.tabs[state.activeTabIndex] ?? state.tabs[0];
  return tabToView(tab);
}
export const useNavStore = create()(persist((set, get) => ({
  tabs: [],
  activeTabIndex: 0,
  onHome: true,
  // Computed — recomputed after every set() via the getter pattern below
  get view() {
    const s = get();
    return deriveView(s);
  },
  // Legacy compat — kept so Breadcrumb / WorkspaceView / etc. don't break
  history: [],
  // ── Actions ────────────────────────────────────────────────────────────
  goHome() {
    set({
      onHome: true
    });
  },
  openWorkspace(path) {
    set(s => {
      const existing = s.tabs.findIndex(t => t.workspacePath === path);
      if (existing !== -1) {
        return {
          activeTabIndex: existing,
          onHome: false
        };
      }
      const newTab = {
        workspacePath: path,
        view: {
          kind: "workspace"
        }
      };
      const tabs = [...s.tabs, newTab];
      return {
        tabs,
        activeTabIndex: tabs.length - 1,
        onHome: false
      };
    });
  },
  closeTab(index) {
    set(s => {
      const tabs = s.tabs.filter((_2, i) => i !== index);
      if (tabs.length === 0) return {
        tabs,
        activeTabIndex: 0,
        onHome: true
      };
      const activeTabIndex = Math.min(s.activeTabIndex, tabs.length - 1);
      return {
        tabs,
        activeTabIndex
      };
    });
  },
  setActiveTab(index) {
    set(s => {
      if (index < 0 || index >= s.tabs.length) return {};
      return {
        activeTabIndex: index,
        onHome: false
      };
    });
  },
  moveTab(from, to) {
    set(s => {
      if (from === to) return {};
      if (from < 0 || from >= s.tabs.length) return {};
      if (to < 0 || to >= s.tabs.length) return {};
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return {};
      tabs.splice(to, 0, moved);
      let activeTabIndex = s.activeTabIndex;
      if (s.activeTabIndex === from) activeTabIndex = to;else if (from < s.activeTabIndex && to >= s.activeTabIndex) activeTabIndex = s.activeTabIndex - 1;else if (from > s.activeTabIndex && to <= s.activeTabIndex) activeTabIndex = s.activeTabIndex + 1;
      return {
        tabs,
        activeTabIndex
      };
    });
  },
  switchByIndex(n) {
    set(s => {
      if (n < 0 || n >= s.tabs.length) return {};
      return {
        activeTabIndex: n,
        onHome: false
      };
    });
  },
  cycleNext() {
    set(s => {
      if (s.tabs.length <= 1) return {};
      const next = (s.activeTabIndex + 1) % s.tabs.length;
      return {
        activeTabIndex: next,
        onHome: false
      };
    });
  },
  cyclePrev() {
    set(s => {
      if (s.tabs.length <= 1) return {};
      const prev = (s.activeTabIndex - 1 + s.tabs.length) % s.tabs.length;
      return {
        activeTabIndex: prev,
        onHome: false
      };
    });
  },
  navigateInActiveTab(v2) {
    set(s => {
      if (s.tabs.length === 0) return {};
      const idx = s.activeTabIndex;
      const tabs = s.tabs.map((t, i) => i === idx ? {
        ...t,
        view: v2
      } : t);
      return {
        tabs
      };
    });
  },
  back() {
    set(s => {
      if (s.tabs.length === 0) return {};
      const idx = s.activeTabIndex;
      const tab = s.tabs[idx];
      if (!tab) return {};
      if (tab.view.kind === "activity") {
        const tabs = s.tabs.map((t, i) => i === idx ? {
          ...t,
          view: {
            kind: "workspace"
          }
        } : t);
        return {
          tabs
        };
      }
      if (s.history.length > 0) {
        const prev = s.history[s.history.length - 1];
        const history = s.history.slice(0, -1);
        if (prev.kind === "home") return {
          onHome: true,
          history
        };
        if (prev.kind === "workspace") {
          const tabs = s.tabs.map((t, i) => i === idx ? {
            workspacePath: prev.workspacePath,
            view: {
              kind: "workspace"
            }
          } : t);
          return {
            tabs,
            history
          };
        }
        if (prev.kind === "activity") {
          const tabs = s.tabs.map((t, i) => i === idx ? {
            workspacePath: prev.workspacePath,
            view: {
              kind: "activity",
              activityId: prev.activityId
            }
          } : t);
          return {
            tabs,
            history
          };
        }
      }
      return {
        onHome: true
      };
    });
  },
  // ── Legacy navigate() — smart dispatcher ──────────────────────────────
  navigate(v2) {
    if (v2.kind === "home") {
      get().goHome();
      return;
    }
    if (v2.kind === "workspace") {
      const s = get();
      const existing = s.tabs.findIndex(t => t.workspacePath === v2.workspacePath);
      if (existing !== -1 && !s.onHome) {
        const activeTab = s.tabs[s.activeTabIndex];
        if (activeTab?.workspacePath === v2.workspacePath) {
          get().navigateInActiveTab({
            kind: "workspace"
          });
        } else {
          get().setActiveTab(existing);
        }
      } else {
        get().openWorkspace(v2.workspacePath);
      }
      return;
    }
    if (v2.kind === "activity") {
      set(s2 => {
        const currentView = deriveView(s2);
        const history = [...s2.history, currentView].slice(-10);
        return {
          history
        };
      });
      const s = get();
      const existing = s.tabs.findIndex(t => t.workspacePath === v2.workspacePath);
      if (existing !== -1) {
        set({
          activeTabIndex: existing,
          onHome: false
        });
        get().navigateInActiveTab({
          kind: "activity",
          activityId: v2.activityId
        });
      } else {
        set(s2 => {
          const newTab = {
            workspacePath: v2.workspacePath,
            view: {
              kind: "activity",
              activityId: v2.activityId
            }
          };
          const tabs = [...s2.tabs, newTab];
          return {
            tabs,
            activeTabIndex: tabs.length - 1,
            onHome: false
          };
        });
      }
    }
  }
}), {
  name: "codebrain-app-nav",
  skipHydration: true,
  // Persist structural state only; `view` is derived, `navigate`/etc are functions
  partialize: s => ({
    tabs: s.tabs,
    activeTabIndex: s.activeTabIndex,
    onHome: s.onHome,
    history: s.history
  })
}));