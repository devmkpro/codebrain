"use strict";

/**
 * Kanban task queue bridge handlers.
 * Provides CRUD operations for kanban board tasks with columns:
 * inbox → assigned → in_progress → review → done
 */
function createKanbanHandlers(opts = {}) {
  const getStore = () => opts.memoryStore;

  return {
    async taskCreate({ title, description, column, priority, assigned_to, workspace }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.createKanbanTask({ title, description, column, priority, assigned_to, workspace });
    },

    async taskMove({ id, column }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.moveKanbanTask({ id, column });
    },

    async taskList({ column, assigned_to, workspace, limit }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.listKanbanTasks({ column, assigned_to, workspace, limit });
    },

    async taskComplete({ id, result }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.completeKanbanTask({ id, result });
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
