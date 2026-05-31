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
  };
}

module.exports = { createMissionHandlers };
