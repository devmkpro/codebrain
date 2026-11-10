import React from "react";
import { ListTodo, X, CircleCheck, LoaderCircle, Circle, RefreshCw } from "lucide-react";

// TasksSidebar — backed by kanban_tasks (persistent, mission-scoped)
import {
  useTasksStore,
  subscribeTaskUpdates,
  taskWorkspaceKey,
  activeTasksWorkspace,
} from "../../stores/tasks-store";
import { useNavStore } from "../../stores/nav-store";

const COLUMN_LABELS: Record<string, string> = {
  inbox: "inbox",
  assigned: "assigned",
  in_progress: "wip",
  review: "validation",
  done: "done",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  normal: "text-slate-500 bg-slate-500/10 border-slate-500/20",
  low: "text-slate-600 bg-slate-600/10 border-slate-600/20",
};

export function TasksSidebar() {
  const {
    visible,
    list: stored,
    activeTaskId,
    load,
    toggle,
    workspace,
    available,
    loading,
    clearing,
    error,
    actionError,
    clear,
  } = useTasksStore();
  const activeWorkspace = useNavStore((state: any) =>
    !state.onHome ? state.tabs[state.activeTabIndex]?.workspacePath || null : null
  ) as string | null;
  const sameWorkspace =
    Boolean(activeWorkspace) && taskWorkspaceKey(activeWorkspace) === taskWorkspaceKey(workspace);
  const list = sameWorkspace && available ? stored : [];
  const [confirmation, setConfirmation] = React.useState<{
    workspace: string;
    scope: "done" | "all";
    ids: string[];
  } | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(subscribeTaskUpdates, []);
  React.useEffect(() => {
    setConfirmation(null);
    setNote(null);
  }, [activeWorkspace, visible]);
  const confirm = async () => {
    if (!confirmation) return;
    const snapshot = confirmation;
    const deleted = await clear(snapshot.workspace, snapshot.scope, snapshot.ids);
    if (deleted !== null) {
      setConfirmation((current) => (current === snapshot ? null : current));
      if (taskWorkspaceKey(snapshot.workspace) === taskWorkspaceKey(activeTasksWorkspace()))
        setNote(`${deleted} tarefa(s) removida(s).`);
    }
  };
  const askClear = (scope: "done" | "all") => {
    if (!activeWorkspace || !sameWorkspace || !available) return;
    setNote(null);
    useTasksStore.setState({ actionError: null });
    setConfirmation({
      workspace: activeWorkspace,
      scope,
      ids: list.filter((task) => scope === "all" || task.column === "done").map((task) => task.id),
    });
  };
  if (!visible) return null;
  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-20 w-72 bg-black border-l border-white/10 flex flex-col shadow-2xl"
      style={
        {
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-1.5">
          <ListTodo size={13} strokeWidth={1.5} className="text-indigo-500/70" />
          <p className="font-mono text-[10px] font-bold text-white tracking-widest uppercase">
            Tasks
          </p>
          {list.length > 0 && (
            <span className="font-mono text-[9px] text-gray-600">
              {list.filter((t: any) => t.column === "done").length}/{list.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || clearing}
            className="text-gray-500 hover:text-white disabled:opacity-40"
            aria-label="Atualizar tarefas"
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="text-gray-600 hover:text-red-500 cursor-pointer"
            aria-label="Fechar tarefas"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <p className="text-[10px] text-gray-500 truncate" title={activeWorkspace ?? undefined}>
          {activeWorkspace?.split(/[\\/]/).filter(Boolean).pop() || "Sem workspace ativo"}
        </p>
        <div className="flex gap-3 mt-2 text-[10px]">
          <button
            type="button"
            disabled={clearing || !list.some((task) => task.column === "done")}
            className="text-gray-400 hover:text-white disabled:opacity-40"
            onClick={() => askClear("done")}
          >
            limpar concluídas
          </button>
          <button
            type="button"
            disabled={clearing || !list.length}
            className="text-red-400 hover:text-red-300 disabled:opacity-40"
            onClick={() => askClear("all")}
          >
            limpar todas
          </button>
        </div>
      </div>
      {confirmation && (
        <div
          role="alertdialog"
          aria-label="Confirmar limpeza de tarefas"
          className="px-3 py-3 border-b border-red-500/20 text-xs text-gray-300 shrink-0"
        >
          <p>
            Limpar {confirmation.ids.length} tarefa(s){" "}
            {confirmation.scope === "done" ? "concluída(s)" : "desta lista"}?
          </p>
          <p className="break-all mt-1 text-[10px] text-gray-500">
            Workspace: {confirmation.workspace}
          </p>
          <p className="mt-1 text-[10px] text-gray-500">
            Remove apenas os registros das tarefas confirmadas neste workspace.
          </p>
          <div className="flex gap-3 mt-2">
            <button type="button" disabled={clearing} onClick={() => setConfirmation(null)}>
              cancelar
            </button>
            <button
              type="button"
              disabled={clearing || !confirmation.ids.length}
              className="text-red-400"
              onClick={() => void confirm()}
            >
              {clearing ? "limpando…" : "confirmar limpeza"}
            </button>
          </div>
          {actionError && (
            <p className="mt-2 text-red-400" role="alert">
              {actionError}
            </p>
          )}
        </div>
      )}
      {note && (
        <p className="px-3 py-2 text-[10px] text-green-400" role="status">
          {note}
        </p>
      )}
      {error && sameWorkspace && (
        <p className="px-3 py-2 text-[10px] text-red-400" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="px-3 py-2 text-[10px] text-gray-500" role="status">
          Atualizando tarefas…
        </p>
      )}
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="font-mono text-[10px] text-gray-700 leading-relaxed">
              {!activeWorkspace
                ? "Abra um workspace para ver as tarefas."
                : !loading && !available && !error
                  ? "Workspace removido ou inexistente no registro."
                  : "Sem tarefas neste workspace."}
              <br />
              {activeWorkspace && available && (
                <>
                  Crie via <span className="text-gray-500">task_create</span>.
                </>
              )}
            </p>
          </div>
        )}
        {list.map((task: any) => {
          const isActive = task.id === activeTaskId;
          const isDone = task.column === "done";
          const isInProgress = task.column === "in_progress";
          const Icon2 = isDone ? CircleCheck : isInProgress ? LoaderCircle : Circle;
          const iconClass = isDone
            ? "text-green-500"
            : isInProgress
              ? "text-indigo-400 animate-spin"
              : "text-gray-700";
          const textClass = isDone
            ? "text-gray-600 line-through"
            : isActive
              ? "text-white"
              : "text-gray-400";
          const label = task.name || task.label;
          const colLabel = COLUMN_LABELS[task.column] || task.column;
          const prioClass = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal;
          return (
            <div
              key={task.id}
              className={`flex items-start gap-2 px-3 py-2 border-b border-white/5 ${isActive ? "bg-indigo-500/5" : ""}`}
            >
              <Icon2 size={12} strokeWidth={1.5} className={`${iconClass} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className={`font-mono text-[11px] leading-snug ${textClass}`}>{label}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-indigo-400/70 bg-indigo-500/10 border border-indigo-500/20 rounded px-1 py-0.5">
                    {colLabel}
                  </span>
                  {task.priority && task.priority !== "normal" && (
                    <span
                      className={`font-mono text-[8px] uppercase tracking-wider border rounded px-1 py-0.5 ${prioClass}`}
                    >
                      {task.priority}
                    </span>
                  )}
                  {task.assigned_to && (
                    <span
                      className="font-mono text-[8px] text-slate-600 truncate max-w-[60px]"
                      title={task.assigned_to}
                    >
                      {task.assigned_to.slice(0, 8)}
                    </span>
                  )}
                </div>
                {task.description && (
                  <p className="font-mono text-[9px] text-gray-700 mt-0.5 truncate">
                    {task.description.slice(0, 60)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export const TERMINAL_AGENTS = ["openclaude", "shell"];
function isTerminalAgent(agent) {
  return TERMINAL_AGENTS.includes(agent);
}
