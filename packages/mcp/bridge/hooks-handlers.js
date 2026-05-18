"use strict";

/**
 * MCP bridge handlers for the Hooks system.
 * Provides lifecycle event querying and hook management.
 */
function createHooksHandlers(opts = {}) {
  return {
    /**
     * List registered hooks and recent events.
     */
    async hooksStatus() {
      const hooks = opts.hooksManager;
      if (!hooks) return { ok: false, error: "hooks system not available" };
      return {
        ok: true,
        hooks: hooks.list(),
        stats: hooks.stats(),
        recentEvents: hooks.getLog(20),
      };
    },

    /**
     * Get event log from hooks system.
     */
    async hooksLog(opts2 = {}) {
      const hooks = opts.hooksManager;
      if (!hooks) return { ok: false, error: "hooks system not available" };
      return { ok: true, events: hooks.getLog(opts2.limit || 50) };
    },

    /**
     * Fire a custom hook event (for testing or automation).
     */
    async hooksFire({ type, data }) {
      const hooks = opts.hooksManager;
      if (!hooks) return { ok: false, error: "hooks system not available" };
      if (!type) return { ok: false, error: "type is required" };
      hooks.fire(type, data);
      return { ok: true, fired: type };
    },
  };
}

module.exports = { createHooksHandlers };
