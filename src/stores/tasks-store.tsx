import React from "react";
import { create } from "zustand";
import { useNavStore } from "./nav-store";
import type { Task } from "../types/electron";

type ClearScope = "done" | "all";
type Update = { workspace?: string | null; at?: number };
type TasksBridge = {
  list: (opts: {
    workspace: string;
  }) => Promise<{
    ok?: boolean;
    error?: string;
    workspace?: string | null;
    tasks: Task[];
    activeTaskId?: string | null;
  }>;
  clear?: (args: {
    workspace: string;
    scope: ClearScope;
    ids: string[];
  }) => Promise<{ ok: boolean; deleted?: number; error?: string }>;
  onUpdated?: (callback: (event: Update) => void) => () => void;
};
interface TasksStore {
  list: Task[];
  activeTaskId: string | null;
  workspace: string | null;
  available: boolean;
  loading: boolean;
  clearing: boolean;
  error: string | null;
  actionError: string | null;
  visible: boolean;
  load: () => Promise<void>;
  clear: (workspace: string, scope: ClearScope, ids: string[]) => Promise<number | null>;
  toggle: () => void;
}

export function taskWorkspaceKey(value: string | null | undefined): string {
  if (!value) return "";
  const key = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(key) || key.startsWith("//") ? key.toLowerCase() : key;
}

export function activeTasksWorkspace(): string | null {
  const nav = useNavStore.getState() as {
    onHome: boolean;
    tabs: { workspacePath: string }[];
    activeTabIndex: number;
  };
  return !nav.onHome ? nav.tabs[nav.activeTabIndex]?.workspacePath || null : null;
}

const bridge = () => window.codeBrainApp?.tasks as unknown as TasksBridge | undefined;
let request = 0;
async function registered(workspace: string): Promise<boolean> {
  const recent = window.codeBrainApp?.workspaces?.recent;
  if (!recent) throw new Error("Registro de workspaces indisponível nesta versão.");
  const paths = await recent();
  return (
    Array.isArray(paths) &&
    paths.some((path) => taskWorkspaceKey(path) === taskWorkspaceKey(workspace))
  );
}

export const useTasksStore = create<TasksStore>((set, get) => ({
  list: [],
  activeTaskId: null,
  workspace: null,
  available: false,
  loading: false,
  clearing: false,
  error: null,
  actionError: null,
  visible: false,
  load: async () => {
    const id = ++request;
    const workspace = activeTasksWorkspace();
    const changed = taskWorkspaceKey(workspace) !== taskWorkspaceKey(get().workspace);
    const current = () =>
      id === request && taskWorkspaceKey(activeTasksWorkspace()) === taskWorkspaceKey(workspace);
    if (!workspace) {
      set({
        list: [],
        activeTaskId: null,
        workspace: null,
        available: false,
        loading: false,
        clearing: false,
        error: null,
        actionError: null,
      });
      return;
    }
    set({
      workspace,
      loading: true,
      error: null,
      ...(changed
        ? { list: [], activeTaskId: null, available: false, clearing: false, actionError: null }
        : {}),
    });
    try {
      const exists = await registered(workspace);
      if (!current()) return;
      if (!exists) {
        set({ list: [], activeTaskId: null, available: false, loading: false });
        return;
      }
      const api = bridge();
      if (!api?.list) throw new Error("Consulta de tarefas indisponível nesta versão.");
      const result = await api.list({ workspace });
      if (!current()) return;
      if (!result || result.ok === false)
        throw new Error(result?.error || "Não foi possível carregar as tarefas.");
      if (taskWorkspaceKey(result.workspace) !== taskWorkspaceKey(workspace))
        throw new Error("A ponte do app não confirmou o workspace das tarefas. Atualize o app.");
      const list = (result.tasks ?? []).filter(
        (task) =>
          !task.workspacePath ||
          taskWorkspaceKey(task.workspacePath) === taskWorkspaceKey(workspace)
      );
      set({
        list,
        activeTaskId: list.some((task) => task.id === result.activeTaskId)
          ? (result.activeTaskId ?? null)
          : null,
        available: true,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (current())
        set({
          list: [],
          activeTaskId: null,
          available: false,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  },
  clear: async (workspace, scope, ids) => {
    if (get().clearing) return null;
    const current = () =>
      taskWorkspaceKey(activeTasksWorkspace()) === taskWorkspaceKey(workspace) &&
      taskWorkspaceKey(get().workspace) === taskWorkspaceKey(workspace);
    ++request;
    set({ clearing: true, actionError: null });
    try {
      if (!current() || !(await registered(workspace)) || !current())
        throw new Error("O workspace mudou ou foi removido. Confirme a limpeza novamente.");
      const clear = bridge()?.clear;
      if (!clear) throw new Error("Limpeza indisponível nesta versão do app.");
      const result = await clear({ workspace, scope, ids });
      if (!result?.ok) {
        if (current()) await get().load();
        throw new Error(result?.error || "Não foi possível limpar as tarefas.");
      }
      if (current()) await get().load();
      return result.deleted ?? 0;
    } catch (error) {
      if (current()) set({ actionError: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      if (current()) set({ clearing: false });
    }
  },
  toggle: () => set((state) => ({ visible: !state.visible })),
}));

let subscriptions = 0;
let dispose: (() => void) | undefined;
export function subscribeTaskUpdates() {
  if (++subscriptions === 1) {
    const refresh = () => {
      void useTasksStore.getState().load();
    };
    const invalidateRegistry = () => {
      ++request;
      useTasksStore.setState({ list: [], activeTaskId: null, available: false });
      refresh();
    };
    const offTasks = bridge()?.onUpdated?.((event) => {
      const active = activeTasksWorkspace();
      if (!event?.workspace || taskWorkspaceKey(event.workspace) === taskWorkspaceKey(active))
        refresh();
    });
    const offRegistry = window.codeBrainApp?.operations?.onUpdated?.((event) => {
      if (event && "workspaceListChanged" in event) invalidateRegistry();
    });
    const offNav = useNavStore.subscribe(() => {
      if (
        taskWorkspaceKey(activeTasksWorkspace()) !==
        taskWorkspaceKey(useTasksStore.getState().workspace)
      )
        refresh();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !useTasksStore.getState().clearing) refresh();
    }, 10000);
    window.addEventListener("focus", refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    dispose = () => {
      ++request;
      offTasks?.();
      offRegistry?.();
      offNav();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
    refresh();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--subscriptions === 0) {
      dispose?.();
      dispose = undefined;
    }
  };
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
