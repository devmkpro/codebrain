import React from "react";
import { ListTodo, X$1, CircleCheck, LoaderCircle, Circle } from "../../stores/providers-store";

// TasksSidebar — backed by kanban_tasks (persistent, mission-scoped)
import { useTasksStore } from "../../stores/tasks-store";

const COLUMN_LABELS: Record<string, string> = {
  inbox: "inbox",
  assigned: "assigned",
  in_progress: "wip",
  review: "review",
  done: "done",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  normal: "text-slate-500 bg-slate-500/10 border-slate-500/20",
  low: "text-slate-600 bg-slate-600/10 border-slate-600/20",
};

export function TasksSidebar() {
  const visible = useTasksStore((s: any) => s.visible);
  const list = useTasksStore((s: any) => s.list);
  const activeTaskId = useTasksStore((s: any) => s.activeTaskId);
  const load = useTasksStore((s: any) => s.load);
  const toggle = useTasksStore((s: any) => s.toggle);
  React.useEffect(() => {
    load();
    // Auto-refresh every 10s when visible (kanban tasks may change from agents)
    if (!visible) return;
    const timer = setInterval(() => load(), 10000);
    return () => clearInterval(timer);
  }, [load, visible]);
  if (!visible) return null;
  return <div className="absolute right-0 top-0 bottom-0 z-20 w-72 bg-black border-l border-white/10 flex flex-col shadow-2xl" style={{
    WebkitAppRegion: "no-drag"
  }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-1.5">
          <ListTodo size={13} strokeWidth={1.5} className="text-indigo-500/70" />
          <p className="font-mono text-[10px] font-bold text-white tracking-widest uppercase">
            Tasks
          </p>
          {list.length > 0 && <span className="font-mono text-[9px] text-gray-600">
              {list.filter((t: any) => t.column === "done").length}/{list.length}
            </span>}
        </div>
        <button onClick={toggle} className="text-gray-600 hover:text-red-500 cursor-pointer">
          <X$1 size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 && <div className="px-3 py-6 text-center">
            <p className="font-mono text-[10px] text-gray-700 leading-relaxed">
              Sem tasks ainda.
              <br />
              Crie via <span className="text-gray-500">task_create</span> ou
              <br />
              <span className="text-gray-500">mission_context</span>.
            </p>
          </div>}
        {list.map((task: any) => {
        const isActive = task.id === activeTaskId;
        const isDone = task.column === "done";
        const isInProgress = task.column === "in_progress";
        const Icon2 = isDone ? CircleCheck : isInProgress ? LoaderCircle : Circle;
        const iconClass = isDone ? "text-green-500" : isInProgress ? "text-indigo-400 animate-spin" : "text-gray-700";
        const textClass = isDone ? "text-gray-600 line-through" : isActive ? "text-white" : "text-gray-400";
        const label = task.name || task.label;
        const colLabel = COLUMN_LABELS[task.column] || task.column;
        const prioClass = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal;
        return <div key={task.id} className={`flex items-start gap-2 px-3 py-2 border-b border-white/5 ${isActive ? "bg-indigo-500/5" : ""}`}>
              <Icon2 size={12} strokeWidth={1.5} className={`${iconClass} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className={`font-mono text-[11px] leading-snug ${textClass}`}>{label}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-indigo-400/70 bg-indigo-500/10 border border-indigo-500/20 rounded px-1 py-0.5">{colLabel}</span>
                  {task.priority && task.priority !== "normal" && <span className={`font-mono text-[8px] uppercase tracking-wider border rounded px-1 py-0.5 ${prioClass}`}>{task.priority}</span>}
                  {task.assigned_to && <span className="font-mono text-[8px] text-slate-600 truncate max-w-[60px]" title={task.assigned_to}>{task.assigned_to.slice(0, 8)}</span>}
                </div>
                {task.description && <p className="font-mono text-[9px] text-gray-700 mt-0.5 truncate">{task.description.slice(0, 60)}</p>}
              </div>
            </div>;
      })}
      </div>
    </div>;
}
export const TERMINAL_AGENTS = ["openclaude", "shell"];
function isTerminalAgent(agent) {
  return TERMINAL_AGENTS.includes(agent);
}