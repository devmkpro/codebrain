"use strict";

/**
 * Expanded hooks handlers for Codebrain MCP bridge.
 * Adds tool-call interception, structured log export, correlation tracking.
 */

function createExpandedHooksHandlers(opts) {
  return {
    async hooksExportLogs({ format = "jsonl", since, types, limit } = {}) {
      const hooks = opts.hooksManager;
      if (!hooks || !hooks.exportLogs) return { ok: false, error: "hooks manager not available or exportLogs not supported" };
      try {
        const result = hooks.exportLogs(format, { since, types, limit });
        return { ok: true, format, data: result, size: result.length };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async hooksEventStats() {
      const hooks = opts.hooksManager;
      if (!hooks || !hooks.eventStats) return { ok: false, error: "hooks manager not available or eventStats not supported" };
      try {
        const stats = hooks.eventStats();
        return { ok: true, ...stats };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async hooksCorrelationEvents({ correlationId }) {
      const hooks = opts.hooksManager;
      if (!hooks) return { ok: false, error: "hooks manager not available" };
      if (!correlationId) return { ok: false, error: "correlationId is required" };
      try {
        const log = hooks.getLog(500);
        const filtered = log.filter(e => e.correlationId === correlationId);
        return { ok: true, correlationId, events: filtered, count: filtered.length };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    async hooksPreToolUse({ toolName, args, paneId } = {}) {
      const hooks = opts.hooksManager;
      if (!hooks) return { ok: true, proceed: true };
      try {
        const correlationId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        hooks.fire("pre_tool_use", { toolName, args: args ? JSON.stringify(args).slice(0, 500) : null }, paneId, correlationId);
        return { ok: true, proceed: true, correlationId };
      } catch (e) { return { ok: true, proceed: true }; }
    },

    async hooksPostToolUse({ toolName, args, result, paneId, durationMs, correlationId } = {}) {
      const hooks = opts.hooksManager;
      if (!hooks) return { ok: true };
      try {
        hooks.fire("post_tool_use", {
          toolName,
          durationMs,
          success: result?.ok !== false,
          resultPreview: result ? JSON.stringify(result).slice(0, 200) : null,
        }, paneId, correlationId);
        return { ok: true };
      } catch (e) { return { ok: true }; }
    },
  };
}

module.exports = { createExpandedHooksHandlers };
