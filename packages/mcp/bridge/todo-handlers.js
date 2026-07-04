"use strict";

/**
 * Todo manager bridge handler.
 * When a kanban memory store is provided, delegates to kanban_tasks (persistent,
 * mission-scoped). Otherwise falls back to in-memory state for backward compat.
 */
function createTodoHandlers(opts = {}) {
  const todoState = { tasks: [], activeIndex: -1 };
  const getStore = () => opts.memoryStore;

  return {
    async todoManager(args) {
      const store = getStore();
      const missionId = args.mission_id;
      const workspace = args.workspace;

      // ── When kanban store + mission_id are available, delegate to kanban ──
      if (store && missionId) {
        switch (args.action) {
          case "set_tasks": {
            // Create kanban tasks for each item
            const created = [];
            for (const t of (args.tasks || [])) {
              const res = store.createKanbanTask({
                title: typeof t === "string" ? t : t.name,
                column: "inbox",
                mission_id: missionId,
                workspace,
              });
              if (res?.ok && res.task) created.push(res.task);
            }
            return { ok: true, tasks: created, delegated: "kanban" };
          }

          case "add_task": {
            if (!args.task) return { ok: true, tasks: [] };
            const res = store.createKanbanTask({
              title: args.task,
              column: "inbox",
              mission_id: missionId,
              workspace,
            });
            return { ok: true, task: res?.task, delegated: "kanban" };
          }

          case "move_to_task": {
            // Find task by name in kanban
            const list = store.listKanbanTasks({ mission_id: missionId, workspace, limit: 100 });
            const tasks = list?.tasks ?? [];
            const target = tasks.find(t => t.title === args.moveToTask);
            if (!target) return { ok: false, error: "task not found in kanban board" };
            store.moveKanbanTask({ id: target.id, column: "in_progress" });
            return { ok: true, task: target, delegated: "kanban" };
          }

          case "read_list": {
            const list = store.listKanbanTasks({ mission_id: missionId, workspace, limit: 100 });
            return { ok: true, tasks: list?.tasks ?? [], delegated: "kanban" };
          }

          case "mark_all_done": {
            const list = store.listKanbanTasks({ mission_id: missionId, workspace, limit: 100 });
            for (const t of (list?.tasks ?? [])) {
              if (t.column !== "done") store.moveKanbanTask({ id: t.id, column: "done" });
            }
            return { ok: true, delegated: "kanban" };
          }

          default:
            return { ok: false, error: `unknown action: ${args.action}` };
        }
      }

      // ── Fallback: in-memory (legacy, no persistence) ──
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
