"use strict";

/**
 * Multi-factor agent scoring for intelligent task delegation.
 * Score = capability(30%) + load(20%) + performance(25%) + health(15%) + availability(10%)
 * + typeMatchBonus(+50) - workloadPenalty(-20 * load_ratio)
 */

const WEIGHTS = {
  capability: 0.30,
  load: 0.20,
  performance: 0.25,
  health: 0.15,
  availability: 0.10,
};

const TYPE_MATCH_BONUS = 50;
const WORKLOAD_PENALTY_FACTOR = 20;
const MAX_CONCURRENT_TASKS = 5;

// Role-to-capability mapping
const ROLE_CAPABILITIES = {
  "backend": ["api_design", "database_schema", "authentication", "server_logic", "middleware", "testing"],
  "frontend": ["component_design", "state_management", "styling", "responsive_design", "accessibility", "testing"],
  "ui-tester": ["browser_automation", "console_monitoring", "network_monitoring", "visual_verification", "bug_detection", "accessibility_testing"],
  "orchestrator": ["task_planning", "worker_delegation", "memory_management", "swarm_coordination", "pattern_learning"],
};

class AgentScorer {
  constructor(opts) {
    this.ptyManager = opts.ptyManager;
    this.roleMap = opts.roleMap;
    this.paneLabels = opts.paneLabels;
    this.memoryStore = opts.memoryStore;
    this.providerHealth = opts.providerHealth;
    this.taskHistory = new Map(); // paneId -> [{ taskType, outcome, duration, timestamp }]
  }

  /**
   * Score a single agent for a task.
   * @param {string} paneId
   * @param {string} taskType
   * @param {string[]} requiredCapabilities
   * @returns {{ paneId: string, score: number, factors: object }}
   */
  scoreAgent(paneId, taskType, requiredCapabilities = []) {
    const cap = this._capabilityScore(paneId, requiredCapabilities, taskType);
    const load = this._loadScore(paneId);
    const perf = this._performanceScore(paneId, taskType);
    const health = this._healthScore(paneId);
    const avail = this._availabilityScore(paneId);

    let score = cap * WEIGHTS.capability
              + load * WEIGHTS.load
              + perf * WEIGHTS.performance
              + health * WEIGHTS.health
              + avail * WEIGHTS.availability;

    // Type matching bonus
    const role = this.roleMap?.get(paneId) || "";
    const label = (this.paneLabels?.get(paneId) || "").toLowerCase();
    if (taskType) {
      const taskLower = taskType.toLowerCase();
      if (role.includes(taskLower) || label.includes(taskLower) || taskLower.includes(role)) {
        score += TYPE_MATCH_BONUS;
      }
    }

    // Workload penalty
    const activeTasks = this._getActiveTaskCount(paneId);
    score -= WORKLOAD_PENALTY_FACTOR * (activeTasks / MAX_CONCURRENT_TASKS);

    // Clamp to 0-200 range (allows for bonuses)
    score = Math.max(0, Math.min(200, Math.round(score * 100) / 100));

    return {
      paneId,
      score,
      factors: {
        capability: Math.round(cap * 100) / 100,
        load: Math.round(load * 100) / 100,
        performance: Math.round(perf * 100) / 100,
        health: Math.round(health * 100) / 100,
        availability: Math.round(avail * 100) / 100,
      },
      role: this.roleMap?.get(paneId) || "worker",
      label: this.paneLabels?.get(paneId) || "",
    };
  }

  /**
   * Score all available agents and return ranked list.
   * @param {string} taskType
   * @param {string[]} requiredCapabilities
   * @returns {Array<{paneId, score, factors, role, label}>}
   */
  scoreAllAgents(taskType, requiredCapabilities = []) {
    if (!this.ptyManager) return [];

    const panes = this.ptyManager.list();
    const scores = [];

    for (const pane of panes) {
      // Skip exited panes
      if (pane.status === "exited" || pane.status === "error") continue;
      const result = this.scoreAgent(pane.paneId, taskType, requiredCapabilities);
      scores.push(result);
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    return scores;
  }

  /**
   * Record the outcome of a task for performance tracking.
   */
  recordOutcome(paneId, taskType, outcome, durationMs) {
    if (!this.taskHistory.has(paneId)) {
      this.taskHistory.set(paneId, []);
    }
    const history = this.taskHistory.get(paneId);
    history.push({
      taskType,
      outcome, // "success", "failure", "partial"
      duration: durationMs,
      timestamp: Date.now(),
    });

    // Keep only last 100 entries per agent
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    // Also record in trajectory system if available
    if (this.memoryStore) {
      try {
        this.memoryStore.trajectoryRecord({
          agent_id: paneId,
          task_type: taskType,
          outcome,
          duration_ms: durationMs,
          workspace: "",
          session_id: `scorer_${Date.now()}`,
        });
      } catch (e) {
        // Ignore trajectory errors
      }
    }
  }

  /**
   * Capability score: how well does this agent's role match the task?
   */
  _capabilityScore(paneId, requiredCapabilities, taskType) {
    const role = this.roleMap?.get(paneId) || "worker";
    const label = (this.paneLabels?.get(paneId) || "").toLowerCase();

    // Check role capabilities
    const roleCaps = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES["worker"] || [];

    if (requiredCapabilities.length === 0) {
      // No specific capabilities required, score based on role-task match
      if (taskType) {
        const taskLower = taskType.toLowerCase();
        if (role === taskLower || label.includes(taskLower)) return 100;
        if (role === "orchestrator") return 40; // orchestrator is less suited for tasks
        return 60; // neutral
      }
      return 70; // no task type specified, default high
    }

    // Count how many required capabilities the agent has
    let matched = 0;
    for (const cap of requiredCapabilities) {
      if (roleCaps.includes(cap) || label.includes(cap.toLowerCase())) {
        matched++;
      }
    }

    return (matched / requiredCapabilities.length) * 100;
  }

  /**
   * Load score: inversely proportional to active task count.
   */
  _loadScore(paneId) {
    const activeTasks = this._getActiveTaskCount(paneId);
    return Math.max(0, 100 - (activeTasks * (100 / MAX_CONCURRENT_TASKS)));
  }

  /**
   * Performance score: based on historical success rate for this task type.
   */
  _performanceScore(paneId, taskType) {
    // Try in-memory history first
    const history = this.taskHistory.get(paneId);
    if (history && history.length > 0) {
      const relevant = taskType
        ? history.filter(h => h.taskType === taskType)
        : history;
      if (relevant.length > 0) {
        const successes = relevant.filter(h => h.outcome === "success").length;
        return (successes / relevant.length) * 100;
      }
    }

    // Try trajectories from memory store
    if (this.memoryStore && taskType) {
      try {
        const result = this.memoryStore.trajectoryList({
          agent_id: paneId,
          task_type: taskType,
          limit: 20,
        });
        if (result && result.ok && result.trajectories && result.trajectories.length > 0) {
          const successes = result.trajectories.filter(t => t.outcome === "success").length;
          return (successes / result.trajectories.length) * 100;
        }
      } catch (e) {
        // Ignore
      }
    }

    return 50; // neutral default
  }

  /**
   * Health score: based on pane status and provider health.
   */
  _healthScore(paneId) {
    let score = 100;

    // Check pane status
    if (!this.ptyManager) return 50;
    const pane = this.ptyManager.list().find(p => p.paneId === paneId);
    if (!pane) return 0;
    if (pane.status === "exited" || pane.status === "error") return 0;

    // Check provider health
    if (this.providerHealth) {
      const health = this.providerHealth.get(paneId);
      if (health) {
        const total = health.successCount + health.errorCount;
        if (total > 0) {
          const errorRate = health.errorCount / total;
          score *= (1 - errorRate);
        }
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Availability score: is the pane idle?
   */
  _availabilityScore(paneId) {
    if (!this.ptyManager) return 50;
    const pane = this.ptyManager.list().find(p => p.paneId === paneId);
    if (!pane) return 0;
    if (pane.status === "exited" || pane.status === "error") return 0;
    if (pane.status === "idle") return 100;
    return 30; // active but available
  }

  /**
   * Get active task count for a pane (from task history).
   */
  _getActiveTaskCount(paneId) {
    const history = this.taskHistory.get(paneId);
    if (!history) return 0;
    // Count tasks started in the last 5 minutes without completion
    const cutoff = Date.now() - 5 * 60 * 1000;
    return history.filter(h => h.timestamp > cutoff && !h.outcome).length;
  }
}

module.exports = { AgentScorer, ROLE_CAPABILITIES };
