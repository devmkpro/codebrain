"use strict";
const { createSessionHandlers } = require("./session-handlers.js");

/**
 * Mission CRUD bridge handlers.
 * Missions represent scoped worktrees with title, summary, and lifecycle status.
 */
function createMissionHandlers(opts = {}) {
  const getStore = () => opts.memoryStore;
  const session = createSessionHandlers(opts);

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
      return session.missionContext({ paneId, workspace, missionId });
    },
  };
}

module.exports = { createMissionHandlers };
