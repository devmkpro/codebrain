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
  };
}

module.exports = { createMemoryHandlers };
