"use strict";

/**
 * Kanban task queue bridge handlers.
 * Provides CRUD operations for kanban board tasks with columns:
 * inbox → assigned → in_progress → review → done
 */
function createKanbanHandlers(opts = {}) {
  const getStore = () => opts.memoryStore;

  return {
    async taskCreate({ title, description, column, priority, assigned_to, workspace, mission_id }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      // Auto-inherit active mission if mission_id not provided
      let effectiveMissionId = mission_id;
      if (!effectiveMissionId && store.resolveActiveMission) {
        try {
          const ws = workspace || opts.getCurrentWorkspacePath?.() || undefined;
          const active = store.resolveActiveMission({ workspace: ws });
          if (active?.ok && active.mission) effectiveMissionId = active.mission.id;
        } catch {}
      }
      return store.createKanbanTask({ title, description, column, priority, assigned_to, workspace, mission_id: effectiveMissionId });
    },

    async taskMove({ id, column }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.moveKanbanTask({ id, column });
    },

    async taskList({ column, assigned_to, workspace, limit, mission_id }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.listKanbanTasks({ column, assigned_to, workspace, limit, mission_id });
    },

    async taskComplete({ id, result }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      const completed = store.completeKanbanTask({ id, result });
      if (completed?.ok) {
        const data = { taskId: id, result: result || null, workspace: opts.getCurrentWorkspacePath?.() || null };
        opts.hooksManager?.fire?.("task_completed", data);
        opts.hooksManager?.fire?.("work_reported", data);
      }
      return completed;
    },

    async taskAssign({ id, paneId }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.assignKanbanTask({ id, paneId });
    },

    async taskDelete({ id }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.deleteKanbanTask({ id });
    },
  };
}

module.exports = { createKanbanHandlers };
