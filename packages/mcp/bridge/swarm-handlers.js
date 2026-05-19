"use strict";

/**
 * Swarm coordination bridge handlers for MCP tools.
 * Provides swarm status, broadcast, task assignment, health monitoring, and respawn.
 */
function createSwarmHandlers(ptyManager, opts) {
  const topology = { type: "hierarchical" }; // hierarchical | mesh | centralized

  return {
    /**
     * Get swarm status: active panes, their roles, health, and topology.
     */
    async swarmStatus() {
      const panes = ptyManager.list();
      const roleMap = opts.roleMap || new Map();
      const paneLabels = opts.paneLabels || new Map();

      const workers = panes.map((p) => ({
        paneId: p.paneId,
        agent: p.agent,
        role: roleMap.get(p.paneId) || "worker",
        label: paneLabels.get(p.paneId) || p.agent,
        status: p.status || "unknown",
        hasAgent: p.hasAgent || false,
      }));

      const orchestrator = workers.find((w) => w.role === "orchestrator");
      const activeWorkers = workers.filter((w) => w.role !== "orchestrator");

      return {
        ok: true,
        topology: topology.type,
        totalPanes: panes.length,
        orchestrator: orchestrator || null,
        workers: activeWorkers,
        activeCount: activeWorkers.filter((w) => w.status === "running" || w.status === "idle").length,
        crashedCount: activeWorkers.filter((w) => w.status === "exited" || w.status === "error").length,
      };
    },

    /**
     * Broadcast a message to all active worker panes.
     */
    async swarmBroadcast({ message, from }) {
      if (!message) return { ok: false, error: "message is required" };
      const panes = ptyManager.list();
      const roleMap = opts.roleMap || new Map();
      let sent = 0;

      for (const pane of panes) {
        const role = roleMap.get(pane.paneId) || "worker";
        if (role !== "orchestrator" && pane.paneId !== from) {
          try {
            ptyManager.injectOutput(pane.paneId, `\n\x1b[33m[BROADCAST from ${from || "orchestrator"}] ${message}\x1b[0m\n`);
            sent++;
          } catch {}
        }
      }

      return { ok: true, sent, total: panes.length };
    },

    /**
     * Assign a task to a specific worker via message injection.
     */
    async swarmAssignTask({ paneId, task, from }) {
      if (!paneId || !task) return { ok: false, error: "paneId and task are required" };
      if (!ptyManager.hasPane(paneId)) return { ok: false, error: "pane not found" };

      try {
        ptyManager.injectOutput(paneId, `\n\x1b[36m[TASK from ${from || "orchestrator"}] ${task}\x1b[0m\n`);
        return { ok: true, paneId, task };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Health check for a specific worker: checks if alive and recent output.
     */
    async swarmWorkerHealth({ paneId }) {
      if (!paneId) return { ok: false, error: "paneId is required" };
      const panes = ptyManager.list();
      const pane = panes.find((p) => p.paneId === paneId);

      if (!pane) return { ok: false, error: "pane not found", health: "dead" };

      const recentLines = ptyManager.read(paneId, 10);
      const isAlive = pane.status !== "exited" && pane.status !== "error";
      const roleMap = opts.roleMap || new Map();
      const paneLabels = opts.paneLabels || new Map();

      return {
        ok: true,
        paneId,
        agent: pane.agent,
        role: roleMap.get(paneId) || "worker",
        label: paneLabels.get(paneId) || pane.agent,
        status: pane.status || "unknown",
        health: isAlive ? "healthy" : "dead",
        recentOutput: recentLines,
      };
    },

    /**
     * Respawn a crashed worker: re-spawns with the same configuration.
     */
    async swarmRespawn({ paneId }) {
      if (!paneId) return { ok: false, error: "paneId is required" };

      const paneConfigs = opts.paneConfigs;
      const config = paneConfigs?.get(paneId);
      if (!config) return { ok: false, error: "original config not found for this pane" };

      try {
        const spawnFn = opts.spawnPaneFn;
        if (!spawnFn) return { ok: false, error: "spawn function not available" };

        const result = await spawnFn({
          agent: config.agent,
          cwd: config.cwd,
          providerId: config.providerId,
          model: config.model,
        });

        if (result.ok && result.paneId) {
          const roleMap = opts.roleMap || new Map();
          const paneLabels = opts.paneLabels || new Map();
          roleMap.set(result.paneId, config.role || "worker");
          return { ok: true, oldPaneId: paneId, newPaneId: result.paneId };
        }

        return { ok: false, error: result.error || "spawn failed" };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Set the swarm topology.
     */
    async swarmSetTopology({ type }) {
      const valid = ["hierarchical", "mesh", "centralized"];
      if (!valid.includes(type)) return { ok: false, error: `invalid topology. Must be one of: ${valid.join(", ")}` };
      topology.type = type;
      return { ok: true, topology: type };
    },

    /**
     * Score all agents using the multi-factor AgentScorer.
     */
    async swarmScoreAgents({ taskType, requiredCapabilities } = {}) {
      const scorer = opts.agentScorer;
      if (!scorer) return { ok: false, error: "agentScorer not available" };

      const result = scorer.scoreAllAgents(taskType, requiredCapabilities);
      return { ok: true, ...result };
    },
  };
}

module.exports = { createSwarmHandlers };
