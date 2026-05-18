"use strict";

/**
 * MCP bridge handlers for the Hooks system.
 * Provides lifecycle event querying, hook management, interception, and observability.
 */
function createHooksHandlers(opts = {}) {
  const hooksManager = opts.hooksManager;
  if (!hooksManager) {
    // Return a shimmed version if the hooks manager isn't available
    // to avoid breaking the MCP server on startup.
    const unavailable = () => Promise.resolve({ ok: false, error: "hooks system not available" });
    return {
      hooksStatus: unavailable,
      hooksLog: unavailable,
      hooksFire: unavailable,
      hooksExportLogs: unavailable,
      hooksEventStats: unavailable,
      hooksCorrelationEvents: unavailable,
      hooksPreToolUse: unavailable,
      hooksPostToolUse: unavailable,
    };
  }

  return {
    /**
     * List registered hooks and recent events.
     */
    async hooksStatus() {
      return {
        ok: true,
        hooks: hooksManager.list(),
        stats: hooksManager.stats(), // Deprecated but kept for backward compatibility
        eventStats: hooksManager.eventStats(),
        recentEvents: hooksManager.getLog(20),
      };
    },

    /**
     * Get event log from hooks system.
     */
    async hooksLog({ limit = 50 } = {}) {
      return { ok: true, events: hooksManager.getLog(limit) };
    },

    /**
     * Fire a custom hook event (for testing or automation).
     */
    async hooksFire({ type, data, paneId, correlationId }) {
      if (!type) return { ok: false, error: "type is required" };
      hooksManager.fire(type, data, paneId, correlationId);
      return { ok: true, fired: type };
    },

    /**
     * Export hook event logs in JSONL or CSV format.
     */
    async hooksExportLogs({ format = 'jsonl', since, types, limit }) {
      try {
        const logs = hooksManager.exportLogs(format, { since, types, limit });
        return { ok: true, data: logs };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Get detailed event statistics from the HooksManager.
     */
    async hooksEventStats() {
      try {
        const stats = hooksManager.eventStats();
        return { ok: true, data: stats };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Retrieve all events associated with a specific correlation ID.
     */
    async hooksCorrelationEvents({ correlationId }) {
        if (!correlationId) {
            return { ok: false, error: "correlationId is required" };
        }
      try {
        const allEvents = hooksManager.getLog(1000); // Get a reasonable number of recent logs
        const correlatedEvents = allEvents.filter(e => e.correlationId === correlationId);
        return { ok: true, data: correlatedEvents };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Fire a pre_tool_use hook for interception and validation.
     */
    async hooksPreToolUse({ toolName, args, paneId, correlationId }) {
      try {
        let proceed = true;
        const eventData = { toolName, args, proceed };
        hooksManager.fire("pre_tool_use", eventData, paneId, correlationId);
        return { ok: true, data: { proceed: eventData.proceed } };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Fire a post_tool_use hook to log the result of a tool call.
     */
    async hooksPostToolUse({ toolName, args, result, paneId, durationMs, correlationId }) {
      try {
        const eventData = { toolName, args, result, durationMs };
        hooksManager.fire("post_tool_use", eventData, paneId, correlationId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };
}

module.exports = { createHooksHandlers };
