"use strict";

/**
 * MCP bridge handlers for background worker management.
 */

function createBackgroundWorkerHandlers(opts) {
  return {
    async workerStart({ name }) {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.start(name);
    },

    async workerStop({ name }) {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.stop(name);
    },

    async workerStatus() {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.status();
    },

    async workerAlerts({ limit } = {}) {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.getAlerts(limit || 50);
    },

    async workerStartAll() {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.startAll();
    },

    async workerStopAll() {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.stopAll();
    },

    async workerExecuteTrigger({ triggerName, context }) {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.executeTrigger(triggerName, context || {});
    },

    async workerDetectTriggers({ text }) {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.detectTriggers(text);
    },

    async workerListTriggers() {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.listTriggers();
    },

    async workerTriggerHistory({ limit } = {}) {
      const manager = opts.workerManager;
      if (!manager) return { ok: false, error: "worker manager not available" };
      return manager.getTriggerHistory(limit || 20);
    },
  };
}

module.exports = { createBackgroundWorkerHandlers };
