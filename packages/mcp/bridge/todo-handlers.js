"use strict";

/**
 * Todo manager bridge handler.
 */
function createTodoHandlers() {
  const todoState = { tasks: [], activeIndex: -1 };

  return {
    async todoManager(args) {
      switch (args.action) {
        case "set_tasks":
          todoState.tasks = (args.tasks || []).map((t, i) => ({ name: t, status: i === 0 ? "active" : "pending" }));
          todoState.activeIndex = 0;
          return { ok: true, tasks: todoState.tasks };

        case "add_task":
          if (args.task) todoState.tasks.push({ name: args.task, status: "pending" });
          return { ok: true, tasks: todoState.tasks };

        case "move_to_task": {
          const idx = todoState.tasks.findIndex((t) => t.name === args.moveToTask);
          if (idx === -1) return { ok: false, error: "task not found" };
          for (let i = 0; i < idx; i++) todoState.tasks[i].status = "done";
          todoState.tasks[idx].status = "active";
          if (args.taskNameActive) todoState.tasks[idx].displayName = args.taskNameActive;
          todoState.activeIndex = idx;
          return { ok: true, tasks: todoState.tasks, activeIndex: idx };
        }

        case "read_list":
          return { ok: true, tasks: todoState.tasks, activeIndex: todoState.activeIndex };

        case "mark_all_done":
          for (const t of todoState.tasks) t.status = "done";
          todoState.activeIndex = -1;
          return { ok: true, tasks: todoState.tasks };

        default:
          return { ok: false, error: `unknown action: ${args.action}` };
      }
    },
  };
}

module.exports = { createTodoHandlers };
