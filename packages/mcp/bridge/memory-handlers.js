"use strict";

/**
 * Memory-related bridge handlers for MCP tools.
 * Delegates to the MemoryStore singleton passed via opts.
 */
function createMemoryHandlers(opts) {
  function getStore() {
    if (!opts.memoryStore) {
      throw new Error("MemoryStore not initialized. Ensure memory store is started before using memory tools.");
    }
    return opts.memoryStore;
  }

  return {
    async memoryWrite({ type, key, content, tags, agent_id, workspace, id }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.write({ id, type, key, content, tags, agent_id, workspace: ws });
    },

    async memoryRead({ id, key, workspace }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.read({ id, key, workspace: ws });
    },

    async memorySearch({ query, type, workspace, limit }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.search({ query, type, workspace: ws, limit });
    },

    async memoryList({ type, agent_id, workspace, limit, offset }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.list({ type, agent_id, workspace: ws, limit, offset });
    },

    async memoryDelete({ id, key, workspace }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.delete({ id, key, workspace: ws });
    },

    async memoryStats({ workspace }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.stats({ workspace: ws });
    },

    async patternWrite({ pattern_type, description, source_trajectory, quality_score }) {
      const store = getStore();
      return store.writePattern({ pattern_type, description, source_trajectory, quality_score });
    },

    async patternList({ pattern_type, limit }) {
      const store = getStore();
      return store.listPatterns({ pattern_type, limit });
    },

    async patternUpdate({ id, quality_score }) {
      const store = getStore();
      return store.updatePatternScore({ id, quality_score });
    },

    async patternDelete({ id }) {
      const store = getStore();
      return store.deletePattern({ id });
    },

    // ── Trajectory Tracking ──────────────────────────────────────────────
    async trajectoryRecord({ session_id, agent_id, workspace, task_type, steps, outcome, outcome_detail, duration_ms, tool_calls }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.recordTrajectory({ session_id, agent_id, workspace: ws, task_type, steps, outcome, outcome_detail, duration_ms, tool_calls });
    },

    async trajectoryAddStep({ id, step }) {
      const store = getStore();
      return store.addTrajectoryStep({ id, step });
    },

    async trajectoryUpdate({ id, outcome, outcome_detail, duration_ms }) {
      const store = getStore();
      return store.updateTrajectory({ id, outcome, outcome_detail, duration_ms });
    },

    async trajectoryList({ session_id, agent_id, workspace, outcome, task_type, limit, offset }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.listTrajectories({ session_id, agent_id, workspace: ws, outcome, task_type, limit, offset });
    },

    async trajectoryGet({ id }) {
      const store = getStore();
      return store.getTrajectory({ id });
    },

    async trajectoryStats({ workspace }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.trajectoryStats({ workspace: ws });
    },

    async trajectoryExtractPatterns({ task_type, min_occurrences, workspace }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.extractPatterns({ task_type, minOccurrences: min_occurrences, workspace: ws });
    },

    async trajectoryDelete({ id }) {
      const store = getStore();
      return store.deleteTrajectory({ id });
    },

    // ── Knowledge Graph ────────────────────────────────────────────────
    async memoryGraph({ id }) {
      const store = getStore();
      return store.memoryGraph({ id });
    },

    async memoryRank({ workspace }) {
      const store = getStore();
      const ws = workspace || opts.getCurrentWorkspacePath?.();
      return store.memoryRank({ workspace: ws });
    },

    async memorySimilar({ id, limit }) {
      const store = getStore();
      return store.memorySimilar({ id, limit });
    },
  };
}

module.exports = { createMemoryHandlers };
