import React from "react";
import { ListTodo, X$1, CircleCheck, LoaderCircle, Circle } from "../../stores/providers-store";
import { formatDuration } from "../navigation/WhatsNewModal";

// TasksSidebar
import { useTasksStore } from "../../stores/tasks-store";
export function TasksSidebar() {
  const visible = useTasksStore(s => s.visible);
  const list = useTasksStore(s => s.list);
  const activeTaskId = useTasksStore(s => s.activeTaskId);
  const load = useTasksStore(s => s.load);
  const toggle = useTasksStore(s => s.toggle);
  React.useEffect(() => {
    load();
  }, [load]);
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
              {list.filter(t => t.status === "done").length}/{list.length}
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
              Agente cria via tool
              <br />
              <span className="text-gray-600">todo_manager</span>.
            </p>
          </div>}
        {list.map(task => {
        const isActive = task.id === activeTaskId;
        const Icon2 = task.status === "done" ? CircleCheck : task.status === "in_progress" ? LoaderCircle : Circle;
        const iconClass = task.status === "done" ? "text-green-500" : task.status === "in_progress" ? "text-red-500 animate-spin" : "text-gray-700";
        const textClass = task.status === "done" ? "text-gray-600 line-through" : isActive ? "text-white" : "text-gray-400";
        const label = task.status === "in_progress" && task.taskNameActive ? task.taskNameActive : task.status === "done" && task.taskNameComplete ? task.taskNameComplete : task.name;
        return <div className={`flex items-start gap-2 px-3 py-2 border-b border-white/5 ${isActive ? "bg-red-500/5" : ""}`}>
              <Icon2 size={12} strokeWidth={1.5} className={`${iconClass} shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className={`font-mono text-[11px] leading-snug ${textClass}`}>{label}</p>
                {task.status === "in_progress" && task.startedAt && <p className="font-mono text-[9px] text-gray-700 mt-0.5">
                    {formatDuration(Date.now() - task.startedAt)}
                  </p>}
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