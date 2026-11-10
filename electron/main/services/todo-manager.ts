import type { AppContext } from "../context";
import { isRegisteredOrActiveWorkspace, workspacePathKey } from "./workspace-list";

type Row = {
  id: string;
  title: string;
  workspace?: string | null;
  column_name: string;
  [key: string]: any;
};
export type TaskClearRequest = { workspace: string; scope: "done" | "all"; ids: string[] };

function emit(ctx: AppContext, workspace?: string | null) {
  const window = ctx.mainWindow;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send("tasks:updated", { workspace: workspace || null, at: Date.now() });
  }
}

/** The MCP bridge retains the same store object. Observe its task mutations once. */
const observers = new WeakMap<object, Set<AppContext>>();
const bulkMutation = new WeakSet<object>();
export function watchTaskMutations(ctx: AppContext): void {
  const store = ctx.memoryStore;
  if (!store) return;
  const existing = observers.get(store);
  if (existing) {
    existing.add(ctx);
    return;
  }
  const listeners = new Set([ctx]);
  observers.set(store, listeners);
  for (const name of [
    "createKanbanTask",
    "moveKanbanTask",
    "completeKanbanTask",
    "assignKanbanTask",
    "deleteKanbanTask",
  ]) {
    if (typeof store[name] !== "function") continue;
    const original = store[name];
    store[name] = function (args: any) {
      let input = args;
      if (name === "createKanbanTask" && !args?.workspace) {
        const mission = args?.mission_id && store.getMission?.({ id: args.mission_id })?.mission;
        input = { ...args, workspace: mission?.workspace || ctx.currentWorkspacePath || undefined };
      }
      const result = original.call(store, input);
      if (result?.ok && !bulkMutation.has(store))
        for (const listener of listeners) emit(listener, input?.workspace);
      return result;
    };
  }
}

function scopedRows(ctx: AppContext, workspace: string, missionId?: string): Row[] {
  if (!ctx.memoryStore?.listKanbanTasks) throw new Error("Banco de tarefas indisponível.");
  // Compare canonical paths so legacy slash/case variants remain in their own project.
  // Never expose a global row (workspace NULL) or guess which project owns it.
  const result = ctx.memoryStore.listKanbanTasks({
    limit: -1,
    ...(missionId ? { mission_id: missionId } : {}),
  });
  if (!result?.ok) throw new Error(result?.error || "Não foi possível consultar as tarefas.");
  const key = workspacePathKey(workspace);
  return (result.tasks ?? []).filter(
    (task: Row) =>
      typeof task.workspace === "string" &&
      workspacePathKey(task.workspace) === key &&
      (!missionId || task.mission_id === missionId)
  );
}

export function listTasks(ctx: AppContext, opts?: { workspace?: string; mission_id?: string }) {
  const workspace =
    typeof opts?.workspace === "string" && opts.workspace.trim() ? opts.workspace : null;
  if (!workspace || !isRegisteredOrActiveWorkspace(ctx, workspace))
    return { ok: true, workspace, tasks: [], activeTaskId: null };
  try {
    const tasks = scopedRows(ctx, workspace, opts?.mission_id).map((task) => ({
      id: task.id,
      name: task.title,
      label: task.title,
      workspacePath: task.workspace,
      status:
        task.column_name === "done"
          ? "done"
          : task.column_name === "in_progress"
            ? "running"
            : "pending",
      column: task.column_name,
      priority: task.priority,
      assigned_to: task.assigned_to,
      description: task.description,
      mission_id: task.mission_id,
      result: task.result,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    }));
    return {
      ok: true,
      workspace,
      tasks,
      activeTaskId: tasks.find((task) => task.column === "in_progress")?.id ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      workspace,
      tasks: [],
      activeTaskId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Only delete the task IDs the user saw and confirmed, within the selected workspace. */
export function clearTasks(ctx: AppContext, args: TaskClearRequest) {
  let deleted = 0;
  try {
    if (
      typeof args?.workspace !== "string" ||
      !args.workspace.trim() ||
      !isRegisteredOrActiveWorkspace(ctx, args.workspace)
    )
      throw new Error("Selecione um workspace registrado e existente.");
    if (args.scope !== "done" && args.scope !== "all")
      throw new Error("Escopo de limpeza inválido.");
    if (!Array.isArray(args.ids) || args.ids.some((id) => typeof id !== "string" || !id))
      throw new Error("Confirme os IDs das tarefas a limpar.");
    if (!ctx.memoryStore?.deleteKanbanTask) throw new Error("Limpeza de tarefas indisponível.");
    const ids = new Set(args.ids);
    const selected = scopedRows(ctx, args.workspace).filter(
      (task) => ids.has(task.id) && (args.scope === "all" || task.column_name === "done")
    );
    bulkMutation.add(ctx.memoryStore);
    try {
      for (const task of selected) {
        const result = ctx.memoryStore.deleteKanbanTask({ id: task.id });
        if (!result?.ok) throw new Error(result?.error || "Não foi possível remover uma tarefa.");
        if (result.deleted) ++deleted;
      }
    } finally {
      bulkMutation.delete(ctx.memoryStore);
    }
    for (const listener of observers.get(ctx.memoryStore) ?? [ctx]) emit(listener, args.workspace);
    return { ok: true, workspace: args.workspace, deleted };
  } catch (error) {
    if (deleted)
      for (const listener of observers.get(ctx.memoryStore) ?? [ctx])
        emit(listener, args.workspace);
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      workspace: args?.workspace ?? null,
      deleted,
      error: deleted
        ? `${message} ${deleted} tarefa(s) já removida(s); atualize a lista antes de tentar novamente.`
        : message,
    };
  }
}
