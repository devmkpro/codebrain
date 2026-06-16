"use strict";

/**
 * History Search Handlers (MiMo-inspired)
 * FTS5-based cross-session conversation history search with BM25 ranking.
 */

function createHistoryHandlers(opts) {
  return {
    /** Record a conversation message for cross-session history. */
    async historyRecord({ sessionId, workspace, role, content, kind, toolName }) {
      try {
        const store = opts.memoryStore;
        if (!store?.recordHistoryMessage) return { ok: false, error: "recordHistoryMessage not available" };
        return store.recordHistoryMessage({ sessionId, workspace: workspace || opts.getCurrentWorkspacePath?.(), role, content, kind, toolName });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Search cross-session history with FTS5 + BM25. */
    async historySearch({ query, scope, sessionId, kind, toolName, since, limit }) {
      try {
        const store = opts.memoryStore;
        if (!store?.searchHistory) return { ok: false, error: "searchHistory not available" };
        return store.searchHistory({ query, scope, sessionId, kind, toolName, since, limit });
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get messages around a specific message ID for context. */
    async historyAround({ messageId, before, after }) {
      try {
        const store = opts.memoryStore;
        if (!store?.getHistoryAround) return { ok: false, error: "getHistoryAround not available" };
        return store.getHistoryAround({ messageId, before, after });
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createHistoryHandlers };
