"use strict";

/**
 * cron-handlers — MCP bridge handlers for cron job management.
 *
 * Pattern: 3-layer (bridge → index.js → bridge.js).
 * All handlers return { ok: boolean, data?, error? }.
 *
 * Includes the CronTickLoop — a 60s interval that checks for due jobs
 * and fires them via the spawn callback.
 *
 * Ported from Overclock sidecar (cronTickLoop.js + cron store).
 */

const { nextCronAfter, shouldFireJob, isStaleJob, CRON_STALE_MS } = require("./cron-utils.js");

const CRON_TICK_MS = 60_000; // 1 minute

/**
 * Create cron handlers for the MCP bridge.
 *
 * @param {Object} opts
 * @param {Object} opts.memoryStore - SQLite memory store with cron methods
 * @param {Function} opts.spawnPaneFn - Function to spawn a pane: ({ agent, model, label, cwd }) => { ok, paneId }
 * @param {Function} [opts.getCurrentWorkspacePath] - Returns current workspace path
 * @param {Object} [opts.hooksManager] - Hooks manager for firing events
 */
function createCronHandlers(opts) {
  let tickTimer = null;
  let tickRunning = false;

  /**
   * Fire a single cron job: spawn a pane with the job's task prompt.
   * Returns the paneId of the spawned pane, or null on failure.
   */
  async function fireJob({ job }) {
    const store = opts.memoryStore;
    if (!store) return null;

    try {
      const spawnOpts = {
        agent: job.agent || "openclaude",
        label: job.label || `cron-${job.name}`,
        cwd: job.workspace || opts.getCurrentWorkspacePath?.(),
      };
      if (job.model) spawnOpts.model = job.model;

      const result = await opts.spawnPaneFn?.(spawnOpts);
      if (!result?.ok || !result?.paneId) {
        return null;
      }

      // Write the task prompt to the spawned pane
      // Note: ptyManager is accessed through spawnPaneFn's closure
      // The spawn function in mcp.ts already handles ptyManager.write
      return result.paneId;
    } catch (err) {
      process.stderr.write(`[cron] fireJob error: ${err.message}\n`);
      return null;
    }
  }

  /**
   * Run one tick: scan all due jobs, fire them, advance nextFireAt.
   * Skip-if-stale: jobs overdue by >5min are skipped and advanced.
   */
  async function tick() {
    if (tickRunning) return; // prevent overlapping ticks
    tickRunning = true;
    try {
      const store = opts.memoryStore;
      if (!store?.getDueCronJobs) return;

      const now = Date.now();
      const dueJobs = store.getDueCronJobs();

      for (const job of dueJobs) {
        if (shouldFireJob(job, now)) {
          process.stderr.write(`[cron] firing job "${job.name}" (id=${job.id})\n`);
          let paneId = null;
          let lastError;

          try {
            paneId = await fireJob({ job });
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[cron] job "${job.name}" fire error: ${lastError}\n`);
          }

          if (!paneId && !lastError) {
            lastError = "spawn returned null";
          }

          const nextFireAt = nextCronAfter(job.schedule, now) || null;
          store.markCronFired({
            id: job.id,
            nextFireAt,
            lastError,
          });

          try {
            opts.hooksManager?.fire?.("cron_fired", {
              jobId: job.id,
              name: job.name,
              paneId,
              success: !!paneId,
            });
          } catch {}
        } else if (isStaleJob(job, now)) {
          const overdueMs = now - job.next_fire_at;
          process.stderr.write(`[cron] skipping stale job "${job.name}" (overdue ${Math.round(overdueMs / 1000)}s)\n`);
          const nextFireAt = nextCronAfter(job.schedule, now) || null;
          store.markCronFired({ id: job.id, nextFireAt });
        }
      }
    } catch (err) {
      process.stderr.write(`[cron] tick error: ${err.message}\n`);
    } finally {
      tickRunning = false;
    }
  }

  /**
   * Start the tick loop. Idempotent.
   */
  function startTickLoop() {
    if (tickTimer != null) return;
    tickTimer = setInterval(() => {
      void tick().catch((err) => {
        process.stderr.write(`[cron] tick uncaught: ${err.message}\n`);
      });
    }, CRON_TICK_MS);
    // Don't block process exit
    if (typeof tickTimer.unref === "function") {
      tickTimer.unref();
    }
    process.stderr.write(`[cron] tick loop started (${CRON_TICK_MS / 1000}s interval)\n`);
  }

  /**
   * Stop the tick loop.
   */
  function stopTickLoop() {
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
      process.stderr.write("[cron] tick loop stopped\n");
    }
  }

  return {
    /**
     * Create a new cron job.
     * @param {{ name: string, schedule: string, task_prompt: string, workspace?: string, agent?: string, model?: string, label?: string }} args
     */
    async cronCreate(args) {
      try {
        const store = opts.memoryStore;
        if (!store?.createCronJob) return { ok: false, error: "cron store not available" };

        // Validate cron expression
        const { parseCronExpression } = require("./cron-utils.js");
        try {
          parseCronExpression(args.schedule);
        } catch (err) {
          return { ok: false, error: `Invalid cron schedule: ${err.message}` };
        }

        const result = store.createCronJob({
          name: args.name,
          schedule: args.schedule,
          workspace: args.workspace || opts.getCurrentWorkspacePath?.() || null,
          task_prompt: args.task_prompt,
          agent: args.agent || "openclaude",
          model: args.model || null,
          label: args.label || null,
        });

        if (result.ok) {
          try {
            opts.hooksManager?.fire?.("cron_created", { jobId: result.id, name: args.name });
          } catch {}
        }

        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * List cron jobs.
     * @param {{ workspace?: string, status?: string }} args
     */
    async cronList(args) {
      try {
        const store = opts.memoryStore;
        if (!store?.listCronJobs) return { ok: false, error: "cron store not available" };
        return store.listCronJobs({
          workspace: args?.workspace || opts.getCurrentWorkspacePath?.() || null,
          status: args?.status || null,
        });
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Delete a cron job.
     * @param {{ id: string }} args
     */
    async cronDelete(args) {
      try {
        const store = opts.memoryStore;
        if (!store?.deleteCronJob) return { ok: false, error: "cron store not available" };
        const result = store.deleteCronJob({ id: args.id });
        if (result.ok) {
          try {
            opts.hooksManager?.fire?.("cron_deleted", { jobId: args.id });
          } catch {}
        }
        return result;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Update a cron job (pause/resume, change schedule, etc).
     * @param {{ id: string, name?: string, schedule?: string, status?: string, task_prompt?: string, agent?: string, model?: string, label?: string }} args
     */
    async cronUpdate(args) {
      try {
        const store = opts.memoryStore;
        if (!store?.updateCronJob) return { ok: false, error: "cron store not available" };
        return store.updateCronJob(args);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    // Expose for external control
    startTickLoop,
    stopTickLoop,
    tick, // for testing
  };
}

module.exports = { createCronHandlers, CRON_TICK_MS };
