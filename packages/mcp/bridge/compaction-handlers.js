"use strict";

/**
 * Session Compaction Handlers (MiMo-inspired)
 * Summarizes older messages when context pressure is high,
 * freeing context space while preserving key information.
 */

function createCompactionHandlers(opts) {
  return {
    /**
     * Get compaction status and recommendation for a pane.
     * The actual summarization is done by the calling agent (LLM).
     */
    async sessionCompact({ paneId, preserveRecentTurns = 5, summaryPrompt }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        const state = store.getCompactionState(paneId) || { messageCount: 0, totalChars: 0 };
        const pressure = store.getPressureLevel ? store.getPressureLevel({ paneId }) : null;
        return {
          ok: true, data: {
            paneId, pressureLevel: pressure?.level || 0, pressureLabel: pressure?.label || "unknown",
            messageCount: state.messageCount, totalChars: state.totalChars, preserveRecentTurns,
            shouldCompact: (pressure?.level || 0) >= 2,
            summaryPrompt: summaryPrompt || "Summarize the following conversation preserving key decisions, file changes, errors, and current task state. Be concise but complete.",
            instructions: "Generate a summary of older messages, then call session_compact_save to store it.",
          },
        };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Save a compaction summary for a session. */
    async sessionCompactSave({ paneId, sessionId, summary, messagesCompacted, tokensSaved }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        store.write({
          type: "working", key: `compaction-${sessionId || paneId}-${Date.now()}`,
          content: summary, tags: ["compaction", "session-summary"],
          agent_id: "compaction-system", workspace: opts.getCurrentWorkspacePath?.() || null,
        });
        store.updateCompactionState(paneId, {
          lastCompactionAt: Date.now(), messagesCompacted: messagesCompacted || 0, tokensSaved: tokensSaved || 0,
        });
        return { ok: true, message: `Compaction saved. ${messagesCompacted || 0} messages summarized, ~${tokensSaved || 0} tokens freed.` };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** Get compaction history. */
    async sessionCompactionHistory({ sessionId, workspace, limit }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "Memory store not available" };
        return store.getCompactionHistory({ sessionId, workspace, limit });
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };
}

module.exports = { createCompactionHandlers };
