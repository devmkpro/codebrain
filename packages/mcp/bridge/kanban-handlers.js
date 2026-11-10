"use strict";
const { createSessionHandlers, paneIdentity, workspaceKey } = require("./session-handlers.js");

/**
 * Kanban task queue bridge handlers.
 * Provides CRUD operations for kanban board tasks with columns:
 * inbox → assigned → in_progress → done
 */
function createKanbanHandlers(opts = {}) {
  const getStore = () => opts.memoryStore;
  const session = createSessionHandlers(opts);

  return {
    async taskCreate({ title, description, column, priority, assigned_to, workspace, mission_id }, context = {}) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      const assigned = paneIdentity(opts, assigned_to);
      const caller = paneIdentity(opts, context.fromPaneId || context.callerPaneId || opts.getCallerPaneId?.());
      let effectiveWorkspace = workspace?.trim();
      let effectiveMissionId = mission_id;
      if (!effectiveWorkspace && effectiveMissionId) {
        const selected = store.getMission?.({ id: effectiveMissionId });
        if (!selected?.ok || !selected.mission?.workspace)
          return { ok: false, error: "Workspace da missão não encontrado" };
        effectiveWorkspace = selected.mission.workspace;
      }
      effectiveWorkspace ||= assigned?.workspace || caller?.workspace || opts.getCurrentWorkspacePath?.();
      if (!effectiveWorkspace) return { ok: false, error: "Workspace obrigatório para criar tarefa" };
      if (!effectiveMissionId) {
        const owner = [assigned, caller].find(identity => identity?.missionId && workspaceKey(identity.workspace) === workspaceKey(effectiveWorkspace));
        effectiveMissionId = owner?.missionId;
      }
      // Active-mission fallback stays inside the resolved workspace, never the
      // currently visible UI project when a target pane supplies its scope.
      if (!effectiveMissionId && store.resolveActiveMission) {
        try {
          const active = store.resolveActiveMission({ workspace: effectiveWorkspace });
          if (active?.ok && active.mission) effectiveMissionId = active.mission.id;
        } catch {}
      }
      return store.createKanbanTask({ title, description, column, priority, assigned_to, workspace: effectiveWorkspace, mission_id: effectiveMissionId });
    },

    async taskMove({ id, column }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.moveKanbanTask({ id, column });
    },

    async taskList(args = {}, context = {}) {
      return session.taskList(args, context);
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
