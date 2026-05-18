"use strict";

/**
 * Pipeline coordinator with dependency graph tracking, domain-based routing,
 * batch task creation, work-stealing, fan-out/fan-in, and chained execution.
 */

// Domain definitions for domain-based routing
const DOMAINS = {
  backend:  { label: "Backend",  keywords: ["api", "server", "database", "endpoint", "auth", "model", "migration", "query", "backend"] },
  frontend: { label: "Frontend", keywords: ["ui", "component", "page", "style", "css", "react", "form", "layout", "frontend"] },
  testing:  { label: "Testing",  keywords: ["test", "verify", "check", "validate", "assert", "mock", "spec"] },
  devops:   { label: "DevOps",   keywords: ["deploy", "ci", "cd", "docker", "build", "pipeline", "infra", "config"] },
  docs:     { label: "Docs",     keywords: ["document", "readme", "docs", "changelog", "guide", "tutorial"] },
};

function createPipelineHandlers(opts) {
  const pipelines = new Map();
  const activeTasks = new Map();
  const completedTasks = new Map(); // taskId -> result

  // Dependency graph: taskId -> { dependsOn: Set<taskId>, dependents: Set<taskId> }
  const dependencyGraph = new Map();

  // Domain queues: domain -> Array<task>
  const domainQueues = new Map();
  for (const domain of Object.keys(DOMAINS)) {
    domainQueues.set(domain, []);
  }

  // Work-stealing: track claimed tasks per worker
  const workerLoads = new Map(); // paneId -> { active: number, completed: number, stolen: number }

  // ─── Domain Detection ───

  function detectDomain(taskDescription) {
    const desc = (taskDescription || "").toLowerCase();
    let bestDomain = "backend"; // default
    let bestScore = 0;
    for (const [domain, def] of Object.entries(DOMAINS)) {
      let score = 0;
      for (const kw of def.keywords) {
        if (desc.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    }
    return bestDomain;
  }

  // ─── Dependency Management ───

  function registerDependency(taskId, dependsOnIds) {
    if (!dependencyGraph.has(taskId)) {
      dependencyGraph.set(taskId, { dependsOn: new Set(), dependents: new Set() });
    }
    const node = dependencyGraph.get(taskId);
    for (const depId of dependsOnIds) {
      node.dependsOn.add(depId);
      if (!dependencyGraph.has(depId)) {
        dependencyGraph.set(depId, { dependsOn: new Set(), dependents: new Set() });
      }
      dependencyGraph.get(depId).dependents.add(taskId);
    }
  }

  function isBlocked(taskId) {
    const node = dependencyGraph.get(taskId);
    if (!node || node.dependsOn.size === 0) return false;
    for (const depId of node.dependsOn) {
      const depTask = activeTasks.get(depId);
      if (depTask && depTask.status !== "completed") return true;
      // Also check completed tasks map
      if (!completedTasks.has(depId) && (!depTask || depTask.status !== "completed")) return true;
    }
    return false;
  }

  function getReadyTasks() {
    const ready = [];
    for (const [taskId, node] of dependencyGraph) {
      const task = activeTasks.get(taskId);
      if (task && task.status === "pending" && !isBlocked(taskId)) {
        ready.push(taskId);
      }
    }
    return ready;
  }

  // ─── Work Stealing ───

  function stealWork(thiefId) {
    const ptyManager = opts.ptyManager;
    if (!ptyManager) return null;

    const panes = ptyManager.list().filter(p => {
      const role = opts.roleMap?.get(p.paneId) || "worker";
      return role !== "orchestrator" && p.paneId !== thiefId && p.status !== "exited";
    });

    // Find the most overloaded worker
    let maxLoad = 0;
    let victimId = null;
    for (const pane of panes) {
      const load = workerLoads.get(pane.paneId);
      if (load && load.active > maxLoad) {
        maxLoad = load.active;
        victimId = pane.paneId;
      }
    }

    if (!victimId || maxLoad <= 1) return null;

    // Find a pending task assigned to the victim
    for (const [taskId, task] of activeTasks) {
      if (task.paneId === victimId && task.status === "assigned" && !isBlocked(taskId)) {
        // Reassign to thief
        task.paneId = thiefId;
        task.stolen = true;
        task.stolenFrom = victimId;
        task.stolenAt = Date.now();

        // Update loads
        const victimLoad = workerLoads.get(victimId) || { active: 0, completed: 0, stolen: 0 };
        victimLoad.active = Math.max(0, victimLoad.active - 1);
        victimLoad.stolen++;
        workerLoads.set(victimId, victimLoad);

        const thiefLoad = workerLoads.get(thiefId) || { active: 0, completed: 0, stolen: 0 };
        thiefLoad.active++;
        workerLoads.set(thiefId, thiefLoad);

        return { taskId, stolenFrom: victimId, assignedTo: thiefId };
      }
    }

    return null;
  }

  // ─── Batch Task Creation ───

  function createBatchTasks(tasks, targetWorker) {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const taskEntries = [];

    for (let i = 0; i < tasks.length; i++) {
      const taskDesc = typeof tasks[i] === "string" ? tasks[i] : (tasks[i].description || JSON.stringify(tasks[i]));
      const priority = typeof tasks[i] === "object" ? (tasks[i].priority || "normal") : "normal";
      const dependencies = typeof tasks[i] === "object" ? (tasks[i].dependsOn || []) : [];
      const domain = typeof tasks[i] === "object" ? (tasks[i].domain || detectDomain(taskDesc)) : detectDomain(taskDesc);
      const taskId = `task_${Date.now()}_${i}`;

      const entry = {
        taskId,
        paneId: targetWorker,
        status: "pending",
        startedAt: null,
        completedAt: null,
        batchId,
        domain,
        description: taskDesc,
        priority,
      };
      taskEntries.push(entry);
      activeTasks.set(taskId, entry);

      // Register dependencies
      if (dependencies.length > 0) {
        registerDependency(taskId, dependencies);
      }

      // Add to domain queue
      const dq = domainQueues.get(domain);
      if (dq) dq.push(entry);
    }

    return { batchId, tasks: taskEntries };
  }

  return {
    // ─── Core Pipeline Methods ───

    async swarmFanOut({ tasks, strategy = "parallel", domain = null, batchMode = false }) {
      if (!tasks || tasks.length === 0) return { ok: false, error: "tasks array required" };

      const ptyManager = opts.ptyManager;
      if (!ptyManager) return { ok: false, error: "ptyManager not available" };

      const panes = ptyManager.list().filter(p => {
        const role = opts.roleMap?.get(p.paneId) || "worker";
        return role !== "orchestrator" && p.status !== "exited";
      });

      if (panes.length === 0) return { ok: false, error: "no available workers" };

      const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const taskEntries = [];

      // Domain routing: filter workers by domain affinity
      let targetPanes = panes;
      if (domain && DOMAINS[domain]) {
        const domainPanes = panes.filter(p => {
          const label = (opts.paneLabels?.get(p.paneId) || p.agent || "").toLowerCase();
          return label.includes(domain) || DOMAINS[domain].keywords.some(kw => label.includes(kw));
        });
        if (domainPanes.length > 0) targetPanes = domainPanes;
      }

      if (batchMode) {
        // Batch mode: create all tasks first, then dispatch ready ones
        const batch = createBatchTasks(tasks, targetPanes[0].paneId);
        // Override paneId assignment with round-robin
        for (let i = 0; i < batch.tasks.length; i++) {
          batch.tasks[i].paneId = targetPanes[i % targetPanes.length].paneId;
        }

        // Dispatch only non-blocked tasks
        const dispatched = [];
        for (const task of batch.tasks) {
          if (!isBlocked(task.taskId)) {
            this._dispatchTask(task, ptyManager);
            dispatched.push(task);
          }
        }

        pipelines.set(pipelineId, {
          steps: tasks.map(t => typeof t === "string" ? t : t.description),
          strategy: "batch",
          status: "running",
          results: batch.tasks,
          currentStep: 0,
          batchId: batch.batchId,
        });

        return {
          ok: true,
          pipelineId,
          strategy: "batch",
          batchId: batch.batchId,
          totalTasks: batch.tasks.length,
          dispatched: dispatched.length,
          blocked: batch.tasks.length - dispatched.length,
          tasks: batch.tasks.map(t => ({ taskId: t.taskId, paneId: t.paneId, status: t.status, domain: t.domain })),
        };
      }

      if (strategy === "parallel") {
        for (let i = 0; i < tasks.length; i++) {
          const worker = targetPanes[i % targetPanes.length];
          const taskId = `task_${Date.now()}_${i}`;
          const taskDesc = typeof tasks[i] === "string" ? tasks[i] : (tasks[i].description || JSON.stringify(tasks[i]));
          const priority = typeof tasks[i] === "object" ? (tasks[i].priority || "normal") : "normal";
          const taskDomain = domain || detectDomain(taskDesc);

          if (opts.messageBus) {
            opts.messageBus.send(worker.paneId, {
              id: taskId, from: "pipeline", to: worker.paneId,
              content: `[PIPELINE TASK ${taskId}] ${taskDesc}`,
              type: "task_assign", priority, timestamp: Date.now(), read: false,
            });
          } else {
            try {
              ptyManager.injectOutput(worker.paneId,
                `\n\x1b[36m[PIPELINE TASK ${taskId}] ${taskDesc}\x1b[0m\n`
              );
            } catch (e) { /* ignore */ }
          }

          const entry = { taskId, paneId: worker.paneId, status: "assigned", startedAt: Date.now(), pipelineId, domain: taskDomain };
          taskEntries.push(entry);
          activeTasks.set(taskId, entry);

          // Update worker load
          const load = workerLoads.get(worker.paneId) || { active: 0, completed: 0, stolen: 0 };
          load.active++;
          workerLoads.set(worker.paneId, load);
        }
      } else if (strategy === "sequential") {
        const taskId = `task_${Date.now()}_0`;
        const taskDesc = typeof tasks[0] === "string" ? tasks[0] : (tasks[0].description || JSON.stringify(tasks[0]));
        const taskDomain = domain || detectDomain(taskDesc);

        if (opts.messageBus) {
          opts.messageBus.send(targetPanes[0].paneId, {
            id: taskId, from: "pipeline", to: targetPanes[0].paneId,
            content: `[PIPELINE TASK ${taskId}] ${taskDesc}`,
            type: "task_assign", priority: "normal", timestamp: Date.now(), read: false,
          });
        } else {
          try {
            ptyManager.injectOutput(targetPanes[0].paneId,
              `\n\x1b[36m[PIPELINE TASK ${taskId}] ${taskDesc}\x1b[0m\n`
            );
          } catch (e) { /* ignore */ }
        }

        const entry = { taskId, paneId: targetPanes[0].paneId, status: "assigned", startedAt: Date.now(), pipelineId, domain: taskDomain };
        taskEntries.push(entry);
        activeTasks.set(taskId, entry);
      }

      pipelines.set(pipelineId, {
        steps: tasks.map(t => typeof t === "string" ? t : t.description),
        strategy,
        status: "running",
        results: taskEntries,
        currentStep: 0,
      });

      return {
        ok: true,
        pipelineId,
        strategy,
        tasks: taskEntries.map(t => ({ taskId: t.taskId, paneId: t.paneId, status: t.status, domain: t.domain })),
        totalTasks: tasks.length,
        availableWorkers: targetPanes.length,
      };
    },

    async swarmFanIn({ taskIds, aggregationStrategy = "merge" }) {
      if (!taskIds || taskIds.length === 0) return { ok: false, error: "taskIds array required" };

      const ptyManager = opts.ptyManager;
      if (!ptyManager) return { ok: false, error: "ptyManager not available" };

      const results = [];
      for (const tid of taskIds) {
        const task = activeTasks.get(tid);
        if (!task) {
          results.push({ taskId: tid, status: "not_found", output: "" });
          continue;
        }

        let output = "";
        try {
          const lines = ptyManager.read(task.paneId, 50);
          output = Array.isArray(lines) ? lines.join("\n") : String(lines);
        } catch (e) {
          output = "(could not read output)";
        }

        results.push({ taskId: tid, paneId: task.paneId, status: task.status, output, domain: task.domain });
      }

      let aggregated;
      switch (aggregationStrategy) {
        case "merge":
          aggregated = results.map(r => `[${r.taskId}|${r.domain || "?"}] ${r.output}`).join("\n---\n");
          break;
        case "vote": {
          const counts = new Map();
          for (const r of results) {
            const key = r.output.slice(0, 500).trim();
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
          }
          let maxCount = 0;
          let best = "";
          for (const [k, v] of counts) {
            if (v > maxCount) { maxCount = v; best = k; }
          }
          aggregated = best;
          break;
        }
        case "best": {
          if (opts.agentScorer) {
            let bestScore = -1;
            let bestOutput = "";
            for (const r of results) {
              const score = opts.agentScorer.scoreAgent(r.paneId, null, []);
              if (score.score > bestScore) { bestScore = score.score; bestOutput = r.output; }
            }
            aggregated = bestOutput;
          } else {
            aggregated = results[0]?.output || "";
          }
          break;
        }
        case "domain_grouped": {
          const byDomain = new Map();
          for (const r of results) {
            const d = r.domain || "unknown";
            if (!byDomain.has(d)) byDomain.set(d, []);
            byDomain.get(d).push(r.output);
          }
          aggregated = [...byDomain.entries()]
            .map(([d, outs]) => `[${d}]\n${outs.join("\n")}`)
            .join("\n===\n");
          break;
        }
        default:
          aggregated = results.map(r => r.output).join("\n---\n");
      }

      for (const tid of taskIds) {
        const task = activeTasks.get(tid);
        if (task) {
          task.status = "completed";
          task.completedAt = Date.now();
          completedTasks.set(tid, task);

          // Update worker load
          const load = workerLoads.get(task.paneId) || { active: 0, completed: 0, stolen: 0 };
          load.active = Math.max(0, load.active - 1);
          load.completed++;
          workerLoads.set(task.paneId, load);
        }
      }

      return { ok: true, results, aggregated, count: results.length, aggregationStrategy };
    },

    async swarmPipeline({ steps }) {
      if (!steps || steps.length === 0) return { ok: false, error: "steps array required" };

      const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      pipelines.set(pipelineId, {
        steps: steps.map(s => typeof s === "string" ? s : s.description),
        strategy: "pipeline",
        status: "running",
        results: [],
        currentStep: 0,
      });

      const firstStep = steps[0];
      const taskDesc = typeof firstStep === "string" ? firstStep : (firstStep.description || JSON.stringify(firstStep));

      const fanResult = await this.swarmFanOut({
        tasks: [{ description: taskDesc, priority: "normal" }],
        strategy: "parallel",
      });

      if (fanResult.ok) {
        const pipe = pipelines.get(pipelineId);
        if (pipe && fanResult.tasks.length > 0) {
          const task = activeTasks.get(fanResult.tasks[0].taskId);
          if (task) task.pipelineId = pipelineId;
          pipe.results.push(fanResult.tasks[0]);
        }
      }

      return { ok: true, pipelineId, currentStep: 0, totalSteps: steps.length, ...fanResult };
    },

    async swarmPipelineStatus({ pipelineId }) {
      const pipeline = pipelines.get(pipelineId);
      if (!pipeline) return { ok: false, error: "pipeline not found" };

      return {
        ok: true,
        pipelineId,
        strategy: pipeline.strategy,
        status: pipeline.status,
        currentStep: pipeline.currentStep,
        totalSteps: pipeline.steps.length,
        steps: pipeline.steps,
        tasks: pipeline.results.map(t => ({
          taskId: t.taskId, paneId: t.paneId, status: t.status, domain: t.domain,
        })),
      };
    },

    // ─── Extended Methods ───

    /**
     * Mark a task as complete and unblock dependents.
     */
    async swarmCompleteTask({ taskId, result }) {
      const task = activeTasks.get(taskId);
      if (!task) return { ok: false, error: "task not found" };

      task.status = "completed";
      task.completedAt = Date.now();
      if (result) task.result = result;
      completedTasks.set(taskId, task);

      // Update worker load
      const load = workerLoads.get(task.paneId) || { active: 0, completed: 0, stolen: 0 };
      load.active = Math.max(0, load.active - 1);
      load.completed++;
      workerLoads.set(task.paneId, load);

      // Find unblocked dependents
      const node = dependencyGraph.get(taskId);
      const unblocked = [];
      if (node) {
        for (const depId of node.dependents) {
          if (!isBlocked(depId)) {
            unblocked.push(depId);
          }
        }
      }

      return {
        ok: true,
        taskId,
        status: "completed",
        unblockedDependents: unblocked,
      };
    },

    /**
     * Get domain queue status.
     */
    async swarmDomainStatus() {
      const status = {};
      for (const [domain, queue] of domainQueues) {
        const pending = queue.filter(t => t.status === "pending").length;
        const active = queue.filter(t => t.status === "assigned").length;
        const completed = queue.filter(t => t.status === "completed").length;
        status[domain] = { pending, active, completed, total: queue.length };
      }
      return { ok: true, domains: status };
    },

    /**
     * Get worker load distribution.
     */
    async swarmWorkerLoads() {
      const loads = {};
      for (const [paneId, load] of workerLoads) {
        loads[paneId] = { ...load };
      }
      return { ok: true, loads };
    },

    /**
     * Trigger work stealing for an idle worker.
     */
    async swarmStealWork({ paneId }) {
      const stolen = stealWork(paneId);
      if (stolen) {
        return { ok: true, stolen };
      }
      return { ok: false, message: "no work to steal" };
    },
  };

  // ─── Internal Helper ───

  function _dispatchTask(task, ptyManager) {
    task.status = "assigned";
    task.startedAt = Date.now();

    if (opts.messageBus) {
      opts.messageBus.send(task.paneId, {
        id: task.taskId, from: "pipeline", to: task.paneId,
        content: `[BATCH TASK ${task.taskId}] ${task.description}`,
        type: "task_assign", priority: task.priority || "normal",
        timestamp: Date.now(), read: false,
      });
    } else {
      try {
        ptyManager.injectOutput(task.paneId,
          `\n\x1b[36m[BATCH TASK ${task.taskId}] ${task.description}\x1b[0m\n`
        );
      } catch (e) { /* ignore */ }
    }

    const load = workerLoads.get(task.paneId) || { active: 0, completed: 0, stolen: 0 };
    load.active++;
    workerLoads.set(task.paneId, load);
  }
}

module.exports = { createPipelineHandlers, DOMAINS };
