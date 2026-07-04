"use strict";

/**
 * Mission CRUD bridge handlers.
 * Missions represent scoped worktrees with title, summary, and lifecycle status.
 */
function createMissionHandlers(opts = {}) {
  const getStore = () => opts.memoryStore;

  return {
    async missionCreate({ title, summary, worktreePath, workspace }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.createMission({ title, summary, worktreePath, workspace });
    },

    async missionGet({ id }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.getMission({ id });
    },

    async missionList({ status, workspace, limit } = {}) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.listMissions({ status, workspace, limit });
    },

    async missionSet({ id, updates }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.updateMission({ id, updates });
    },

    async missionDelete({ id }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      return store.deleteMission({ id });
    },

    /**
     * Auto-discovery context for a pane: resolves mission, finds orchestrator,
     * and determines the pane's role in the mission. Used by workers on boot.
     *
     * Actions:
     *  - 'already_set': pane is already the orchestrator
     *  - 'adopt': exactly 1 orchestrator found → pane becomes worker, linked to it
     *  - 'ask_if_orchestrator': 0 or 2+ orchestrators → pane should ask user
     *
     * @param {{ paneId: string, workspace?: string, missionId?: string }} opts
     */
    async missionContext({ paneId, workspace, missionId }) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };

      try {
        // 1. Resolve mission
        let mission = null;
        if (missionId) {
          const res = store.getMission({ id: missionId });
          if (res.ok) mission = res.mission;
        } else {
          const res = store.resolveActiveMission({ workspace });
          if (res.ok) mission = res.mission;
        }

        // 2. Get current pane role
        const myRole = store.getActorRole({ paneId });
        const currentRole = myRole.ok ? myRole : { role: null, missionId: null };

        // 3. If already orchestrator → nothing to do
        if (currentRole.role === "orchestrator") {
          return {
            ok: true,
            action: "already_set",
            mission,
            myRole: currentRole,
            orchestrator: { paneId },
            ambiguous: false,
            tasks: [],
          };
        }

        // 4. Find orchestrator(s)
        const orchs = store.findOrchestrator({ missionId: mission?.id, workspace });

        // 5. Decide action
        let action = "ask_if_orchestrator";
        let orchestrator = null;
        let ambiguous = false;
        let tasks = [];

        if (orchs.ok && orchs.count === 1) {
          // Exactly 1 orchestrator → adopt worker role
          action = "adopt";
          orchestrator = { paneId: orchs.orchestrators[0] };
          // Persist role assignment
          store.setActorRole({ paneId, role: "worker", missionId: mission?.id || null });
        } else if (orchs.ok && orchs.count > 1) {
          // Multiple orchestrators → ambiguous
          action = "ask_if_orchestrator";
          ambiguous = true;
        } else {
          // 0 orchestrators
          action = "ask_if_orchestrator";
          ambiguous = false;
        }

        // 6. Get open kanban tasks for this mission
        let myTasks = [];
        if (mission?.id) {
          const taskRes = store.listKanbanTasks({ mission_id: mission.id, workspace, limit: 50 });
          if (taskRes.ok) {
            tasks = (taskRes.tasks || []).filter(t => t.column_name !== "done");
            // Filter tasks assigned to this pane
            myTasks = tasks.filter(t => t.assigned_to === paneId);
          }
        }

        return {
          ok: true,
          mission,
          myRole: currentRole,
          orchestrator,
          ambiguous,
          action,
          tasks,
          myTasks,
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}

module.exports = { createMissionHandlers };
