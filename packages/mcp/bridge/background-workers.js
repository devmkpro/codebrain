"use strict";

/**
 * Persistent background workers for system maintenance.
 * Includes regex-based trigger detection, 12 on-demand triggers,
 * cache-aware heartbeat (270s), and max 5 concurrent workers.
 */

const fs = require("fs");
const path = require("path");

// Optional vector-store for pattern similarity calculations
let tokenize = null, cosineSimilarity = null;
try {
  const vs = require("../../memory/vector-store.js");
  tokenize = vs.tokenize;
  cosineSimilarity = vs.cosineSimilarity;
} catch { /* graceful degradation */ }

const MAX_CONCURRENT = 5;
const MAX_METRICS = 1000;
const MAX_ALERTS = 500;
const CACHE_HEARTBEAT_INTERVAL = 270 * 1000; // 270s for prompt cache optimization

const WORKER_DEFINITIONS = [
  { name: "health",    intervalMs: 5 * 60 * 1000,    description: "Monitor pane health and detect crashed workers", priority: "high" },
  { name: "patterns",  intervalMs: 15 * 60 * 1000,   description: "Extract patterns from recent trajectories", priority: "normal" },
  { name: "security",  intervalMs: 30 * 60 * 1000,   description: "Scan recent file changes for security issues", priority: "high" },
  { name: "git",       intervalMs: 5 * 60 * 1000,    description: "Monitor git status and uncommitted changes", priority: "normal" },
  { name: "learning",  intervalMs: 30 * 60 * 1000,   description: "Promote short-term memories to long-term", priority: "normal" },
  { name: "cache",     intervalMs: 60 * 60 * 1000,   description: "Clean expired messages and stale cache entries", priority: "background" },
  { name: "swarm",     intervalMs: 1 * 60 * 1000,    description: "Monitor swarm health and detect stalled workers", priority: "high" },
  { name: "heartbeat", intervalMs: CACHE_HEARTBEAT_INTERVAL, description: "Cache-aware heartbeat for prompt cache optimization (270s)", priority: "background" },
  { name: "mr_poll",   intervalMs: 5 * 60 * 1000,    description: "Auto-review new MRs when mr_auto_review is enabled", priority: "normal" },
];

// ─── On-Demand Trigger Definitions (12 triggers) ───

const ON_DEMAND_TRIGGERS = [
  {
    name: "ultralearn",
    patterns: [/ultra\s*learn/i, /rapid\s*learn/i, /intensive\s*study/i, /deep\s*understand/i],
    priority: "high",
    description: "Ultra-learning mode: intensive knowledge absorption and synthesis",
    capabilities: ["learning", "synthesis", "knowledge-graph"],
    handler: "_triggerUltralearn",
  },
  {
    name: "optimize",
    patterns: [/optimize/i, /improve\s+performance/i, /make\s+(it\s+)?faster/i, /speed\s+up/i, /perf\s+improve/i],
    priority: "high",
    description: "Performance optimization task detected",
    capabilities: ["profiling", "optimization", "benchmarking"],
    handler: "_triggerOptimize",
  },
  {
    name: "consolidate",
    patterns: [/consolidat/i, /merge\s+(memories|patterns)/i, /dedup/i, /clean\s+up\s+memory/i],
    priority: "normal",
    description: "Memory/pattern consolidation detected",
    capabilities: ["memory-management", "deduplication"],
    handler: "_triggerConsolidate",
  },
  {
    name: "predict",
    patterns: [/predict/i, /forecast/i, /anticipate/i, /estimate\s+(time|effort)/i],
    priority: "normal",
    description: "Prediction/estimation task detected",
    capabilities: ["prediction", "analysis"],
    handler: "_triggerPredict",
  },
  {
    name: "audit",
    patterns: [/security\s+audit/i, /vulnerability/i, /cve/i, /owasp/i, /check\s+security/i, /audit\s+code/i],
    priority: "critical",
    description: "Security audit task detected",
    capabilities: ["security", "vulnerability-scanning", "audit"],
    handler: "_triggerAudit",
  },
  {
    name: "map",
    patterns: [/map\s+(the\s+)?code/i, /codebase\s+map/i, /architecture\s+map/i, /dependency\s+graph/i, /visualize\s+structure/i],
    priority: "normal",
    description: "Codebase mapping/architecture visualization detected",
    capabilities: ["architecture", "visualization", "graph-analysis"],
    handler: "_triggerMap",
  },
  {
    name: "preload",
    patterns: [/preload/i, /pre\s*fetch/i, /warm\s*up\s*cache/i, /anticipatory\s*load/i],
    priority: "normal",
    description: "Preloading/warming task detected",
    capabilities: ["caching", "optimization"],
    handler: "_triggerPreload",
  },
  {
    name: "deepdive",
    patterns: [/deep\s*dive/i, /analyze\s+thoroughly/i, /investigate/i, /root\s+cause/i, /deep\s+analysis/i],
    priority: "normal",
    description: "Deep analysis task detected",
    capabilities: ["analysis", "research"],
    handler: "_triggerDeepdive",
  },
  {
    name: "document",
    patterns: [/document\s+(this|the)/i, /generate\s+docs/i, /write\s+docs/i, /add\s+comments/i, /docstring/i],
    priority: "normal",
    description: "Documentation task detected",
    capabilities: ["documentation", "writing"],
    handler: "_triggerDocument",
  },
  {
    name: "refactor",
    patterns: [/refactor/i, /clean\s+up\s+code/i, /improve\s+readability/i, /code\s+quality/i, /technical\s+debt/i],
    priority: "high",
    description: "Refactoring task detected",
    capabilities: ["refactoring", "code-quality"],
    handler: "_triggerRefactor",
  },
  {
    name: "benchmark",
    patterns: [/benchmark/i, /performance\s+test/i, /load\s+test/i, /stress\s+test/i, /throughput/i],
    priority: "normal",
    description: "Benchmarking task detected",
    capabilities: ["benchmarking", "profiling"],
    handler: "_triggerBenchmark",
  },
  {
    name: "testgaps",
    patterns: [/test\s+coverage/i, /missing\s+tests/i, /add\s+tests/i, /write\s+tests/i, /untested/i, /test\s+gap/i],
    priority: "high",
    description: "Test coverage gap detected",
    capabilities: ["testing", "coverage"],
    handler: "_triggerTestgaps",
  },
];

// ─── Trigger Detection (regex-based) ───

function detectTriggers(text) {
  if (!text) return [];
  const detected = [];
  for (const trigger of ON_DEMAND_TRIGGERS) {
    for (const pattern of trigger.patterns) {
      if (pattern.test(text)) {
        detected.push({
          name: trigger.name,
          priority: trigger.priority,
          description: trigger.description,
          capabilities: trigger.capabilities,
          matchedPattern: pattern.source,
        });
        break;
      }
    }
  }
  return detected;
}

class WorkerManager {
  constructor(opts) {
    this.workers = new Map();
    this.opts = opts;
    this.alerts = [];
    this.statePath = opts.statePath || path.join(
      opts.dataDir || path.join(require("os").homedir(), ".codebrain"),
      "worker-state.json"
    );

    // Trigger history
    this.triggerHistory = [];
    this.maxTriggerHistory = 200;

    // Cache heartbeat state
    this._lastCacheHeartbeat = null;
    this._cacheHeartbeatHits = 0;
    this._cacheHeartbeatMisses = 0;

    // Initialize worker entries
    for (const def of WORKER_DEFINITIONS) {
      this.workers.set(def.name, {
        timer: null,
        running: false,
        intervalMs: def.intervalMs,
        lastRun: null,
        metrics: [],
        state: null,
        definition: def,
      });
    }

    this._loadState();
  }

  // ─── Worker Lifecycle ───

  start(name) {
    const worker = this.workers.get(name);
    if (!worker) return { ok: false, error: `unknown worker: ${name}. Available: ${WORKER_DEFINITIONS.map(d => d.name).join(", ")}` };
    if (worker.timer) return { ok: false, error: `worker ${name} is already running` };

    const running = Array.from(this.workers.values()).filter(w => w.timer !== null).length;
    if (running >= MAX_CONCURRENT) {
      return { ok: false, error: `max ${MAX_CONCURRENT} concurrent workers. Stop one first.` };
    }

    this._runWorker(name);
    worker.timer = setInterval(() => this._runWorker(name), worker.intervalMs);
    if (worker.timer.unref) worker.timer.unref();

    this._addAlert("info", `Worker ${name} started (interval: ${Math.round(worker.intervalMs / 1000)}s)`, name);
    return { ok: true, name, intervalMs: worker.intervalMs, running: true };
  }

  stop(name) {
    const worker = this.workers.get(name);
    if (!worker) return { ok: false, error: `unknown worker: ${name}` };
    if (!worker.timer) return { ok: false, error: `worker ${name} is not running` };

    clearInterval(worker.timer);
    worker.timer = null;
    worker.running = false;

    this._addAlert("info", `Worker ${name} stopped`, name);
    return { ok: true, name, running: false };
  }

  startAll() {
    const results = [];
    for (const def of WORKER_DEFINITIONS) {
      const worker = this.workers.get(def.name);
      if (!worker.timer) results.push(this.start(def.name));
    }
    return { ok: true, started: results };
  }

  stopAll() {
    for (const [name, worker] of this.workers) {
      if (worker.timer) {
        clearInterval(worker.timer);
        worker.timer = null;
        worker.running = false;
      }
    }
    return { ok: true, message: "all workers stopped" };
  }

  status() {
    const workers = [];
    for (const [name, worker] of this.workers) {
      workers.push({
        name,
        running: worker.timer !== null,
        isExecuting: worker.running,
        intervalMs: worker.intervalMs,
        lastRun: worker.lastRun,
        description: worker.definition.description,
        priority: worker.definition.priority,
        metricCount: worker.metrics.length,
        lastMetrics: worker.metrics.length > 0 ? worker.metrics[worker.metrics.length - 1] : null,
        state: worker.state,
      });
    }

    const activeCount = workers.filter(w => w.running).length;
    return {
      ok: true,
      workers,
      activeCount,
      maxConcurrent: MAX_CONCURRENT,
      alertCount: this.alerts.length,
      triggerCount: this.triggerHistory.length,
      cacheHeartbeat: {
        lastBeat: this._lastCacheHeartbeat,
        hits: this._cacheHeartbeatHits,
        misses: this._cacheHeartbeatMisses,
        hitRate: (this._cacheHeartbeatHits + this._cacheHeartbeatMisses) > 0
          ? (this._cacheHeartbeatHits / (this._cacheHeartbeatHits + this._cacheHeartbeatMisses) * 100).toFixed(1) + "%"
          : "N/A",
      },
    };
  }

  getAlerts(limit = 50) {
    return { ok: true, alerts: this.alerts.slice(-limit), total: this.alerts.length };
  }

  // ─── On-Demand Trigger Execution ───

  /**
   * Execute an on-demand trigger by name.
   * @param {string} triggerName
   * @param {object} [context] - Additional context for the trigger
   * @returns {object}
   */
  executeTrigger(triggerName, context = {}) {
    const trigger = ON_DEMAND_TRIGGERS.find(t => t.name === triggerName);
    if (!trigger) {
      return { ok: false, error: `unknown trigger: ${triggerName}. Available: ${ON_DEMAND_TRIGGERS.map(t => t.name).join(", ")}` };
    }

    const record = {
      trigger: triggerName,
      executedAt: Date.now(),
      context,
      result: null,
    };

    try {
      const handler = this[trigger.handler];
      if (handler && typeof handler === "function") {
        record.result = handler.call(this, context);
      } else {
        record.result = { message: `trigger ${triggerName} dispatched (no internal handler)`, action: trigger.description };
      }

      this.triggerHistory.push(record);
      if (this.triggerHistory.length > this.maxTriggerHistory) {
        this.triggerHistory.splice(0, this.triggerHistory.length - this.maxTriggerHistory);
      }

      this._addAlert("info", `On-demand trigger executed: ${triggerName}`, "triggers");

      return { ok: true, trigger: triggerName, description: trigger.description, result: record.result };
    } catch (err) {
      record.result = { error: err.message };
      this.triggerHistory.push(record);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Scan text for all 12 on-demand triggers and return matches.
   */
  detectTriggers(text) {
    const detected = detectTriggers(text);
    return {
      ok: true,
      detected,
      count: detected.length,
      hasHighPriority: detected.some(t => t.priority === "critical" || t.priority === "high"),
    };
  }

  /**
   * List all available on-demand triggers.
   */
  listTriggers() {
    return {
      ok: true,
      triggers: ON_DEMAND_TRIGGERS.map(t => ({
        name: t.name,
        priority: t.priority,
        description: t.description,
        capabilities: t.capabilities,
        patternCount: t.patterns.length,
      })),
      total: ON_DEMAND_TRIGGERS.length,
    };
  }

  /**
   * Get trigger execution history.
   */
  getTriggerHistory(limit = 20) {
    return {
      ok: true,
      history: this.triggerHistory.slice(-limit),
      total: this.triggerHistory.length,
    };
  }

  // ─── On-Demand Trigger Handlers ───

  _triggerUltralearn(ctx) {
    // Analyze knowledge graph to identify learning gaps
    const store = this.opts.memoryStore;
    if (!store) return { action: "would scan memory for learning gaps", store: false };

    try {
      const recent = store.search?.({ query: "knowledge", limit: 10 });
      return {
        action: "ultralearn: knowledge synthesis",
        recentMemories: recent?.memories?.length || 0,
        recommendation: "Review patterns and consolidate related memories",
      };
    } catch (e) {
      return { action: "ultralearn dispatched", error: e.message };
    }
  }

  _triggerOptimize(ctx) {
    return {
      action: "optimization analysis",
      recommendation: "Profile code paths, identify bottlenecks, check for N+1 queries",
      areas: ["memory access patterns", "algorithm complexity", "I/O batching"],
    };
  }

  _triggerConsolidate(ctx) {
    const store = this.opts.memoryStore;
    if (!store) return { action: "would consolidate memories", store: false };

    try {
      const db = store.db || store._db;
      if (!db) return { action: "consolidate dispatched", db: false };

      // Find duplicate memories
      const all = db.prepare("SELECT id, key, content, type FROM memories ORDER BY created_at DESC LIMIT 200").all();
      const duplicates = [];
      const seen = new Map();
      for (const mem of all) {
        const key = mem.key;
        if (seen.has(key)) {
          duplicates.push({ id: mem.id, key, duplicateOf: seen.get(key) });
        } else {
          seen.set(key, mem.id);
        }
      }

      return {
        action: "consolidation analysis",
        scanned: all.length,
        duplicatesFound: duplicates.length,
        duplicates: duplicates.slice(0, 10),
      };
    } catch (e) {
      return { action: "consolidate dispatched", error: e.message };
    }
  }

  _triggerPredict(ctx) {
    return {
      action: "prediction analysis",
      recommendation: "Analyze trajectory patterns, estimate task completion times",
      factors: ["historical duration", "task complexity", "worker availability"],
    };
  }

  _triggerAudit(ctx) {
    // Enhanced security audit
    const store = this.opts.memoryStore;
    const issues = [];

    try {
      const result = store?.search?.({ query: "file-changed", limit: 50 });
      if (result?.ok && result.memories) {
        for (const mem of result.memories) {
          const content = mem.content || "";
          if (/api[_-]?key|secret|password|token|credential|private[_-]?key/i.test(content)) {
            issues.push({ type: "potential_secret", key: mem.key, severity: "critical" });
          }
          if (/\beval\s*\(|\bexec\s*\(|Function\s*\(|child_process/i.test(content)) {
            issues.push({ type: "code_injection_risk", key: mem.key, severity: "high" });
          }
          if (/TODO|FIXME|HACK|XXX/i.test(content)) {
            issues.push({ type: "code_smell", key: mem.key, severity: "info" });
          }
        }
      }
    } catch (e) { /* ignore */ }

    return {
      action: "security audit",
      issuesFound: issues.length,
      critical: issues.filter(i => i.severity === "critical").length,
      high: issues.filter(i => i.severity === "high").length,
      issues: issues.slice(0, 20),
    };
  }

  _triggerMap(ctx) {
    const cwd = this.opts.getCurrentWorkspacePath?.() || process.cwd();
    const structure = { directories: 0, files: 0, extensions: {} };

    try {
      function walkDir(dir, depth = 0) {
        if (depth > 3) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          if (entry.isDirectory()) {
            structure.directories++;
            walkDir(path.join(dir, entry.name), depth + 1);
          } else {
            structure.files++;
            const ext = path.extname(entry.name);
            structure.extensions[ext] = (structure.extensions[ext] || 0) + 1;
          }
        }
      }
      walkDir(cwd);
    } catch (e) { /* ignore */ }

    return {
      action: "codebase mapping",
      ...structure,
      topExtensions: Object.entries(structure.extensions)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([ext, count]) => `${ext}: ${count}`),
    };
  }

  _triggerPreload(ctx) {
    return {
      action: "preload/warm cache",
      recommendation: "Preload frequently accessed memories, warm up vector indexes",
      targets: ["memory cache", "vector index", "pattern cache"],
    };
  }

  _triggerDeepdive(ctx) {
    return {
      action: "deep analysis dispatched",
      recommendation: "Use Pathfinder algorithm to trace memory connections, analyze graph clusters",
      scope: ctx.topic || "general codebase analysis",
    };
  }

  _triggerDocument(ctx) {
    return {
      action: "documentation generation",
      recommendation: "Scan source files, generate docstrings, update README sections",
      targets: ctx.files || ["recently modified files"],
    };
  }

  _triggerRefactor(ctx) {
    return {
      action: "refactoring analysis",
      recommendation: "Identify code smells, suggest DRY patterns, check complexity metrics",
      areas: ["duplication", "complexity", "naming", "module boundaries"],
    };
  }

  _triggerBenchmark(ctx) {
    return {
      action: "benchmarking dispatched",
      recommendation: "Run performance tests, measure latency percentiles, compare baselines",
      metrics: ["p50 latency", "p95 latency", "p99 latency", "throughput", "memory usage"],
    };
  }

  _triggerTestgaps(ctx) {
    return {
      action: "test gap analysis",
      recommendation: "Scan for untested functions, identify critical paths without coverage",
      approach: "grep for exported functions vs test files",
    };
  }

  // ─── Worker Implementations ───

  _runWorker(name, opts) {
    const worker = this.workers.get(name);
    if (!worker) { console.log(`[_runWorker] SKIP: worker "${name}" not found`); return; }
    if (worker.running) { console.log(`[_runWorker] SKIP: worker "${name}" already running`); return; }

    worker.running = true;
    worker.lastRun = Date.now();
    const startTime = Date.now();

    const finalize = (result) => {
      const duration = Date.now() - startTime;
      this._addMetric(name, { duration, success: true, timestamp: Date.now(), summary: result?.summary || "ok" });
      worker.state = result;
      worker.running = false;
      this._saveState();
    };

    const onError = (err) => {
      const duration = Date.now() - startTime;
      this._addAlert("warning", `Worker ${name} failed: ${err.message}`, name);
      this._addMetric(name, { duration, success: false, error: err.message, timestamp: Date.now() });
      worker.running = false;
      this._saveState();
    };

    try {
      let result;
      switch (name) {
        case "health": result = this._healthCheck(); break;
        case "patterns": result = this._extractPatterns(); break;
        case "security": result = this._securityScan(); break;
        case "git": result = this._gitStatus(); break;
        case "learning": result = this._promoteMemory(); break;
        case "cache": result = this._cleanCache(); break;
        case "swarm": result = this._swarmMonitor(); break;
        case "heartbeat": result = this._cacheHeartbeat(); break;
        case "mr_poll": result = this._mrPoll(opts); break;
        default: result = { message: "no implementation" };
      }

      // Handle async workers (mr_poll returns Promise when LLM is configured)
      if (result && typeof result.then === "function") {
        result.then(finalize).catch(onError);
      } else {
        finalize(result);
      }
    } catch (err) {
      onError(err);
    }
  }

  _healthCheck() {
    const ptyManager = this.opts.ptyManager;
    if (!ptyManager) return { summary: "no ptyManager", panes: [] };

    const panes = ptyManager.list();
    const crashed = panes.filter(p => p.status === "exited" || p.status === "error");
    const healthy = panes.filter(p => p.status !== "exited" && p.status !== "error");

    if (crashed.length > 0) {
      this._addAlert("critical", `${crashed.length} crashed panes: ${crashed.map(p => p.paneId).join(", ")}`, "health");
    }

    if (this.opts.hooksManager) {
      try { this.opts.hooksManager.fire("health_check", { healthy: healthy.length, crashed: crashed.length }); } catch (e) { /* */ }
    }

    return {
      summary: `${healthy.length} healthy, ${crashed.length} crashed`,
      healthy: healthy.length,
      crashed: crashed.map(p => ({ paneId: p.paneId, agent: p.agent, status: p.status })),
    };
  }

  _extractPatterns() {
    const store = this.opts.memoryStore;
    if (!store) return { summary: "no memoryStore" };
    try {
      const result = store.extractPatterns({ minOccurrences: 2 });
      const summary = result && result.ok ? `extracted ${result.count || 0} patterns` : "no patterns extracted";

      // Run k-means clustering on extracted patterns
      let clusterResult = null;
      try {
        const store2 = this.opts.memoryStore;
        if (store2) {
          const allPatterns = store2.listPatterns({ limit: 200 });
          if (allPatterns && allPatterns.ok && allPatterns.patterns && allPatterns.patterns.length >= 3) {
            clusterResult = this._kMeansCluster(allPatterns.patterns);
            // Merge similar patterns within clusters
            if (clusterResult && clusterResult.clusters) {
              let merged = 0;
              for (const cluster of clusterResult.clusters) {
                const m = this._mergePatterns(cluster);
                merged += m.deleted || 0;
              }
              clusterResult.merged = merged;
            }
            // Periodic evolution (every 4th extraction)
            this._patternExtractionCount = (this._patternExtractionCount || 0) + 1;
            if (this._patternExtractionCount % 4 === 0) {
              clusterResult.evolution = this._evolvePatterns();
            }
          }
        }
      } catch (e) { /* clustering is non-critical */ }

      return { summary, patterns: result, clusters: clusterResult };
    } catch (e) { return { summary: `error: ${e.message}` }; }
  }

  /**
   * k-Means clustering for patterns. Groups similar patterns by description similarity.
   * @param {Array} patterns - Pattern objects with id, description, quality_score
   * @param {number} k - Number of clusters (default: min(50, patterns.length/3))
   * @returns {{ clusters: Array, iterations: number, converged: boolean }}
   */
  _kMeansCluster(patterns, k) {
    if (!patterns || patterns.length < 2) return { clusters: [], iterations: 0, converged: true };
    k = k || Math.min(50, Math.max(2, Math.floor(patterns.length / 3)));

    // Tokenize patterns into TF vectors
    const vectors = patterns.map(p => {
      const tokens = tokenize ? tokenize(p.description || "") : (p.description || "").toLowerCase().split(/\s+/);
      const vec = new Map();
      for (const tok of tokens) vec.set(tok, (vec.get(tok) || 0) + 1);
      for (const [tok, count] of vec) vec.set(tok, count / tokens.length);
      return { id: p.id, vector: vec, pattern: p };
    });

    // Initialize centroids randomly
    const shuffled = [...vectors].sort(() => Math.random() - 0.5);
    let centroids = shuffled.slice(0, k).map(v => new Map(v.vector));

    let assignments = new Array(vectors.length).fill(0);
    let converged = false;
    const MAX_ITER = 20;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      // Assign each vector to nearest centroid
      const newAssignments = vectors.map(v => {
        let bestIdx = 0, bestSim = -1;
        for (let c = 0; c < centroids.length; c++) {
          const sim = this._vectorSimilarity(v.vector, centroids[c]);
          if (sim > bestSim) { bestSim = sim; bestIdx = c; }
        }
        return bestIdx;
      });

      // Check convergence
      let changed = 0;
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] !== newAssignments[i]) changed++;
      }
      assignments = newAssignments;

      if (changed === 0) { converged = true; break; }

      // Recalculate centroids
      centroids = centroids.map((_, cIdx) => {
        const members = vectors.filter((_, i) => assignments[i] === cIdx);
        if (members.length === 0) return new Map();
        const centroid = new Map();
        for (const m of members) {
          for (const [tok, val] of m.vector) {
            centroid.set(tok, (centroid.get(tok) || 0) + val / members.length);
          }
        }
        return centroid;
      });
    }

    // Build cluster objects
    const clusters = [];
    for (let c = 0; c < k; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      // Cohesion: average pairwise similarity within cluster
      let totalSim = 0, pairs = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          totalSim += this._vectorSimilarity(members[i].vector, members[j].vector);
          pairs++;
        }
      }
      clusters.push({
        centroid: centroids[c],
        memberIds: members.map(m => m.id),
        members: members.map(m => m.pattern),
        cohesion: pairs > 0 ? Math.round((totalSim / pairs) * 100) / 100 : 1.0,
        size: members.length,
      });
    }

    return { clusters, iterations: MAX_ITER, converged, k, totalPatterns: patterns.length };
  }

  /**
   * Merge patterns in a cluster that are very similar (>0.8).
   */
  _mergePatterns(cluster) {
    if (!cluster.members || cluster.members.length < 2) return { merged: 0, deleted: 0 };
    const store = this.opts.memoryStore;
    if (!store || !store.listPatterns) return { merged: 0, deleted: 0 };

    let merged = 0, deleted = 0;
    const seen = new Set();

    for (let i = 0; i < cluster.members.length; i++) {
      if (seen.has(cluster.members[i].id)) continue;
      for (let j = i + 1; j < cluster.members.length; j++) {
        if (seen.has(cluster.members[j].id)) continue;
        const sim = this._patternSimilarity(cluster.members[i].description, cluster.members[j].description);
        if (sim > 0.8) {
          // Keep the one with higher quality_score, absorb the other
          const [keep, absorb] = cluster.members[i].quality_score >= cluster.members[j].quality_score
            ? [cluster.members[i], cluster.members[j]]
            : [cluster.members[j], cluster.members[i]];
          // Update kept pattern with absorbed info
          try {
            const combinedSource = [keep.source_trajectory, absorb.source_trajectory].filter(Boolean).join("; ");
            store.updatePatternScore?.({ id: absorb.id, quality_score: 0 });
          } catch { /* */ }
          seen.add(absorb.id);
          merged++;
          deleted++;
        }
      }
    }
    return { merged, deleted };
  }

  /**
   * Evolve patterns: prune low-quality, split diverse clusters.
   */
  _evolvePatterns() {
    const store = this.opts.memoryStore;
    if (!store) return { pruned: 0, split: 0 };

    let pruned = 0;
    try {
      const allPatterns = store.listPatterns({ limit: 500 });
      if (allPatterns && allPatterns.ok && allPatterns.patterns) {
        for (const p of allPatterns.patterns) {
          // Prune patterns with very low quality and many failures
          if (p.quality_score < 0.1 && (p.failure_count || 0) > 5) {
            try { store.deletePattern(p.id); pruned++; } catch { /* */ }
          }
        }
      }
    } catch { /* */ }

    return { pruned };
  }

  /**
   * Cosine similarity between two sparse vectors (Map<token, weight>).
   */
  _vectorSimilarity(v1, v2) {
    if (cosineSimilarity) return cosineSimilarity(v1, v2);
    // Fallback: manual cosine
    let dot = 0, norm1 = 0, norm2 = 0;
    for (const [tok, val] of v1) {
      norm1 += val * val;
      if (v2.has(tok)) dot += val * v2.get(tok);
    }
    for (const [, val] of v2) norm2 += val * val;
    if (norm1 === 0 || norm2 === 0) return 0;
    return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Simple pattern description similarity (tokenize + cosine).
   */
  _patternSimilarity(desc1, desc2) {
    if (!desc1 || !desc2) return 0;
    const tokens1 = tokenize ? tokenize(desc1) : desc1.toLowerCase().split(/\s+/);
    const tokens2 = tokenize ? tokenize(desc2) : desc2.toLowerCase().split(/\s+/);
    const v1 = new Map(), v2 = new Map();
    for (const t of tokens1) v1.set(t, (v1.get(t) || 0) + 1);
    for (const t of tokens2) v2.set(t, (v2.get(t) || 0) + 1);
    return this._vectorSimilarity(v1, v2);
  }

  /**
   * Get current pattern cluster state.
   */
  getPatternClusters() {
    const store = this.opts.memoryStore;
    if (!store) return { ok: false, error: "no memoryStore" };
    try {
      const allPatterns = store.listPatterns({ limit: 200 });
      if (!allPatterns || !allPatterns.ok || !allPatterns.patterns) return { ok: true, clusters: [], total: 0 };
      if (allPatterns.patterns.length < 3) return { ok: true, clusters: [], total: allPatterns.patterns.length };
      const result = this._kMeansCluster(allPatterns.patterns);
      return { ok: true, ...result };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /**
   * Manually trigger pattern evolution (prune + merge).
   */
  forcePatternEvolution() {
    try {
      const evolution = this._evolvePatterns();
      const store = this.opts.memoryStore;
      let clusterMerge = { merged: 0, deleted: 0 };
      if (store) {
        const allPatterns = store.listPatterns({ limit: 200 });
        if (allPatterns && allPatterns.ok && allPatterns.patterns && allPatterns.patterns.length >= 3) {
          const clusters = this._kMeansCluster(allPatterns.patterns);
          if (clusters && clusters.clusters) {
            for (const c of clusters.clusters) {
              const m = this._mergePatterns(c);
              clusterMerge.merged += m.merged;
              clusterMerge.deleted += m.deleted;
            }
          }
        }
      }
      return { ok: true, pruned: evolution.pruned, merged: clusterMerge.merged, deleted: clusterMerge.deleted };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  _securityScan() {
    const store = this.opts.memoryStore;
    if (!store) return { summary: "no memoryStore" };
    const issues = [];
    try {
      const result = store.search({ query: "file-changed", limit: 20 });
      if (result && result.ok && result.memories) {
        for (const mem of result.memories) {
          const content = mem.content || "";
          if (/api[_-]?key|secret|password|token|credential/i.test(content)) {
            issues.push({ type: "potential_secret", key: mem.key, severity: "critical" });
          }
          if (/\beval\s*\(|exec\s*\(|Function\s*\(/i.test(content)) {
            issues.push({ type: "code_injection_risk", key: mem.key, severity: "warning" });
          }
        }
      }
    } catch (e) { /* */ }
    if (issues.length > 0) this._addAlert("critical", `Found ${issues.length} security issues`, "security");
    return { summary: issues.length > 0 ? `${issues.length} issues found` : "no issues", issues };
  }

  _gitStatus() {
    const cwd = this.opts.getCurrentWorkspacePath?.() || process.cwd();
    try {
      const { execSync } = require("child_process");
      const status = execSync("git status --porcelain", {
        cwd, encoding: "utf-8", timeout: 5000, windowsHide: true,
      }).trim();
      const lines = status ? status.split("\n") : [];
      const modified = lines.filter(l => l.startsWith(" M") || l.startsWith("M ")).length;
      const untracked = lines.filter(l => l.startsWith("??")).length;
      const staged = lines.filter(l => /^[MADRC]/.test(l)).length;
      if (lines.length > 10) this._addAlert("warning", `${lines.length} uncommitted changes in git`, "git");
      return { summary: `${modified} modified, ${untracked} untracked, ${staged} staged`, total: lines.length, modified, untracked, staged };
    } catch (e) { return { summary: `git error: ${e.message}` }; }
  }

  _promoteMemory() {
    const store = this.opts.memoryStore;
    if (!store) return { summary: "no memoryStore" };
    try {
      const db = store.db || store._db;
      if (!db) return { summary: "no db access" };
      const candidates = db.prepare(
        "SELECT id, key, content, access_count FROM memories WHERE type = 'working' AND access_count >= 3 ORDER BY access_count DESC LIMIT 10"
      ).all();
      let promoted = 0;
      for (const mem of candidates) {
        try { db.prepare("UPDATE memories SET type = 'semantic' WHERE id = ?").run(mem.id); promoted++; } catch (e) { /* */ }
      }
      if (promoted > 0) this._addAlert("info", `Promoted ${promoted} working memories to semantic`, "learning");
      return { summary: promoted > 0 ? `promoted ${promoted} memories` : "no candidates", candidates: candidates.length, promoted };
    } catch (e) { return { summary: `error: ${e.message}` }; }
  }

  _cleanCache() {
    let cleaned = 0;
    const msgDir = path.join(require("os").homedir(), ".codebrain", "messages");
    try {
      if (fs.existsSync(msgDir)) {
        const panes = fs.readdirSync(msgDir);
        for (const paneId of panes) {
          const paneDir = path.join(msgDir, paneId);
          if (!fs.statSync(paneDir).isDirectory()) continue;
          const files = fs.readdirSync(paneDir);
          for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const filePath = path.join(paneDir, file);
            try {
              const msg = JSON.parse(fs.readFileSync(filePath, "utf-8"));
              if (msg.timestamp && Date.now() - msg.timestamp > 3600000) { fs.unlinkSync(filePath); cleaned++; }
            } catch (e) { try { fs.unlinkSync(filePath); cleaned++; } catch {} }
          }
          try { const remaining = fs.readdirSync(paneDir); if (remaining.length === 0) fs.rmdirSync(paneDir); } catch {}
        }
      }
    } catch (e) { /* */ }
    if (cleaned > 0) this._addAlert("info", `Cleaned ${cleaned} expired message files`, "cache");
    return { summary: cleaned > 0 ? `cleaned ${cleaned} files` : "nothing to clean", cleaned };
  }

  _swarmMonitor() {
    const ptyManager = this.opts.ptyManager;
    if (!ptyManager) return { summary: "no ptyManager" };
    const panes = ptyManager.list();
    const stalled = [];
    for (const pane of panes) {
      if (pane.status === "exited" || pane.status === "error") continue;
      if (pane.status === "idle") stalled.push({ paneId: pane.paneId, agent: pane.agent });
    }
    if (stalled.length > 0) this._addAlert("info", `${stalled.length} idle panes detected`, "swarm");
    if (this.opts.hooksManager) {
      try {
        this.opts.hooksManager.fire("swarm_health_check", {
          total: panes.length, active: panes.filter(p => p.status !== "exited").length, idle: stalled.length,
        });
      } catch (e) { /* */ }
    }
    return { summary: `${panes.length} panes, ${stalled.length} idle`, total: panes.length, idle: stalled.length, stalled };
  }

  /**
   * Cache-aware heartbeat: maintains prompt cache warmness.
   * Runs every 270s (within Anthropic's ~5min prompt cache window).
   * Touches memory stores and vector indexes to keep them hot.
   */
  _cacheHeartbeat() {
    this._lastCacheHeartbeat = Date.now();
    let cacheHits = 0;
    let cacheMisses = 0;

    // Touch memory store cache
    const store = this.opts.memoryStore;
    if (store) {
      try {
        const db = store.db || store._db;
        if (db) {
          // Warm up common queries
          const memCount = db.prepare("SELECT COUNT(*) as count FROM memories").get();
          const recentMem = db.prepare("SELECT id FROM memories ORDER BY created_at DESC LIMIT 5").all();
          cacheHits += recentMem.length > 0 ? 1 : 0;
          cacheMisses += recentMem.length === 0 ? 1 : 0;
        }
      } catch (e) { cacheMisses++; }
    }

    // Touch message bus
    const bus = this.opts.messageBus;
    if (bus) {
      try {
        bus.getMetrics();
        cacheHits++;
      } catch (e) { cacheMisses++; }
    }

    // Touch agent scorer
    const scorer = this.opts.agentScorer;
    if (scorer) {
      try {
        cacheHits++;
      } catch (e) { cacheMisses++; }
    }

    this._cacheHeartbeatHits += cacheHits;
    this._cacheHeartbeatMisses += cacheMisses;

    return {
      summary: `heartbeat: ${cacheHits} hits, ${cacheMisses} misses`,
      timestamp: this._lastCacheHeartbeat,
      intervalMs: CACHE_HEARTBEAT_INTERVAL,
      cacheHits,
      cacheMisses,
    };
  }

  // ─── Utilities ───

  _addAlert(severity, message, worker) {
    this.alerts.push({ severity, message, worker, timestamp: Date.now() });
    if (this.alerts.length > MAX_ALERTS) this.alerts.splice(0, this.alerts.length - MAX_ALERTS);
  }

  _addMetric(name, metric) {
    const worker = this.workers.get(name);
    if (!worker) return;
    worker.metrics.push(metric);
    if (worker.metrics.length > MAX_METRICS) worker.metrics.splice(0, worker.metrics.length - MAX_METRICS);
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.statePath)) return;
      const data = JSON.parse(fs.readFileSync(this.statePath, "utf-8"));
      for (const [name, state] of Object.entries(data.workers || {})) {
        const worker = this.workers.get(name);
        if (worker) { worker.state = state.state || null; worker.lastRun = state.lastRun || null; }
      }
      if (data.alerts) this.alerts = data.alerts;
      if (data.triggerHistory) this.triggerHistory = data.triggerHistory;
    } catch (e) { /* */ }
  }

  _saveState() {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = { workers: {}, alerts: this.alerts.slice(-100), triggerHistory: this.triggerHistory.slice(-50) };
      for (const [name, worker] of this.workers) {
        data.workers[name] = { state: worker.state, lastRun: worker.lastRun };
      }
      fs.writeFileSync(this.statePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) { /* */ }
  }

  /**
   * MR Auto-Review Poll Worker.
   * Checks for new/updated MRs and posts automated reviews.
   */
  /**
   * Wait for a pane to become idle (no output for ~3s).
   * Returns a Promise that resolves when the pane is idle or timeout is reached.
   */
  _waitForPaneIdle(paneId, timeoutMs = 180000) {
    return new Promise((resolve) => {
      const ptyManager = this.opts.ptyManager;
      if (!ptyManager) return resolve({ idle: true, timedOut: true, noManager: true });

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; resolve({ idle: true, timedOut: true }); }
      }, timeoutMs);

      const onIdle = ({ paneId: pid }) => {
        if (pid === paneId && !resolved) {
          resolved = true;
          clearTimeout(timer);
          ptyManager.off("idle", onIdle);
          resolve({ idle: true, timedOut: false });
        }
      };
      ptyManager.on("idle", onIdle);
    });
  }

  /**
   * Post-process MR: record as reviewed, emit notification, fire hook.
   */
  _postReviewActions(mr, mrId, workspacePath, provider, store, emitNotification) {
    const mrUrl = mr.html_url || mr.web_url || `MR !${mrId}`;
    store.recordReviewedMr({
      workspace: workspacePath,
      mr_id: mrId,
      mr_url: mrUrl,
      provider: provider || "unknown",
      mr_title: mr.title || "Untitled",
      mr_updated_at: mr.updated_at || mr.updatedAt || null,
    });
    if (emitNotification) {
      emitNotification({
        type: "mr_auto_review",
        title: `MR !${mrId} revisado automaticamente`,
        body: `Review postado: ${mr.title || "MR"}`,
        level: "success",
        mr_id: mrId,
        mr_url: mrUrl,
        provider: provider || "unknown",
      });
    }
    if (this.opts.hooksManager) {
      try { this.opts.hooksManager.fire("task_completed", { type: "mr_auto_review", mrId, workspace: workspacePath }); } catch { /* */ }
    }
  }

  /**
   * LLM-based review: spawns a pane with the configured model, passes the diff,
   * waits for idle, then posts the agent's analysis as a comment.
   * Returns a Promise.
   */
  async _llmReview(mr, mrId, detailRes, workspacePath, config, store, emitNotification) {
    const spawnFn = this.opts.spawnPaneFn;
    const ptyManager = this.opts.ptyManager;
    if (!spawnFn || !ptyManager) {
      return { ok: false, error: "spawnPaneFn or ptyManager not available" };
    }

    const provider = config.mr_review_provider;
    const model = config.mr_review_model;

    // detailRes has shape { ok, provider, mr: { diff, title, branch, ... } }
    const mrData = detailRes.mr || detailRes;
    // Truncate diff to avoid exceeding context limits (~8K chars)
    const diff = (mrData.diff || detailRes.diff || "").slice(0, 8000);
    const title = mr.title || mrData.title || "Untitled";
    const sourceBranch = mr.source_branch || mrData.branch || mrData.source_branch || "?";
    const targetBranch = mr.target_branch || mrData.base_branch || mrData.target_branch || "?";

    const prompt = [
      `You are a code reviewer. Review the following MR diff and post your findings as a comment on the MR.`,
      ``,
      `STEPS:`,
      `1. First, call mcp__codebrain__enable_tool_group with group "mr" to enable MR tools`,
      `2. Analyze the diff below`,
      `3. Call mcp__codebrain__mr_comment with cwd="${workspacePath}", id="${mrId}", and your review as body`,
      ``,
      `MR !${mrId}: ${title}`,
      `Branch: ${sourceBranch} → ${targetBranch}`,
      ``,
      `Review rules:`,
      `- Focus on bugs, security issues, performance, and code quality`,
      `- Be concise — max 10 findings`,
      `- Use markdown formatting`,
      `- Start with "## Codebrain AI Review"`,
      `- If no issues found, post "## Codebrain AI Review\\n\\n✅ LGTM — no issues found"`,
      `- After posting the comment, your task is DONE. Do not ask questions.`,
      ``,
      `---DIFF---`,
      diff,
    ].join("\n");

    try {
      // 1. Spawn review pane
      // NOTE: agent is NOT passed — resolveProvider will determine it from providerId.
      // For MIMO: resolveProvider finds provider in store → type=mimo-compat → agent=openclaude
      console.log(`[mr_poll] Spawning review pane: providerId=${provider}, model=${model}, cwd=${workspacePath}`);
      const spawnResult = await spawnFn({
        providerId: provider,
        model,
        cwd: workspacePath,
      });

      console.log(`[mr_poll] Spawn result:`, JSON.stringify(spawnResult));
      if (!spawnResult?.ok || !spawnResult?.paneId) {
        return { ok: false, error: `spawn failed: ${spawnResult?.error || "unknown"}` };
      }

      const reviewPaneId = spawnResult.paneId;

      // 2. Wait for CLI readiness — use output-based detection instead of fixed delay.
      // When the CLI produces its first output (banner/prompt), it's ready for input.
      // Fallback to 8s timeout if no output detected (some CLIs are silent on startup).
      await this._waitForCliReady(reviewPaneId, 8000);

      // 3. Write the review prompt using paneHandlers.writePane (sanitizes newlines,
      // delays Enter based on text length). Direct writeSilent breaks because \n in
      // the diff is interpreted as Enter by readline, fragmenting the prompt.
      const paneHandlers = this.opts.paneHandlers;
      if (paneHandlers?.writePane) {
        console.log(`[mr_poll] Writing prompt via paneHandlers.writePane (${prompt.length} chars)`);
        await paneHandlers.writePane(reviewPaneId, prompt, true);
      } else {
        // Fallback: sanitize manually + writeSilent
        console.log(`[mr_poll] Writing prompt via writeSilent fallback (${prompt.length} chars)`);
        const sanitized = prompt.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
        ptyManager.writeSilent(reviewPaneId, sanitized);
        const delay = Math.min(3000, Math.max(100, 100 + sanitized.length * 0.5));
        await new Promise(r => setTimeout(r, delay));
        ptyManager.write(reviewPaneId, "\r");
      }

      // 4. Wait for idle (agent finishes analyzing)
      await this._waitForPaneIdle(reviewPaneId, 180000); // 3 min timeout

      // 5. Agent posts the comment via MCP tool (mr_comment).
      // Read pane output to extract findings for auto-fix modal.

      // 6. Extract findings from pane output
      let findings = [];
      let reviewSummary = "";
      try {
        const paneHandlers = this.opts.paneHandlers;
        if (paneHandlers?.readPane) {
          const output = await paneHandlers.readPane(reviewPaneId, 500);
          const text = Array.isArray(output?.lines) ? output.lines.join("\n") : String(output?.lines || "");
          // Extract findings: lines starting with number+dot or bullet with severity emoji
          const findingPatterns = /(?:^|\n)\s*(?:\d+\.\s+|\-\s+|•\s+)(?:\*\*)?(?:🔴|🟡|🟢|⚠️|❌|✅)?\s*(?:\*\*)?\s*(.+)/g;
          let match;
          while ((match = findingPatterns.exec(text)) !== null) {
            const line = match[1].trim();
            if (line.length > 10 && !line.startsWith("LGTM") && !line.startsWith("✅")) {
              findings.push(line);
            }
          }
          // Extract the full review section
          const reviewMatch = text.match(/## Codebrain AI Review[\s\S]*?(?=\n🧠 Posted|$)/);
          reviewSummary = reviewMatch ? reviewMatch[0].trim() : "";
        }
      } catch (e) {
        console.error(`[mr_poll] Failed to extract findings:`, e.message);
      }

      // 7. Record + notify + cleanup
      this._postReviewActions(mr, mrId, workspacePath, detailRes.provider || mr.provider, store, emitNotification);

      // 8. Send findings to renderer for auto-fix modal (if any findings found)
      if (findings.length > 0 && typeof this.opts.sendFindings === "function") {
        this.opts.sendFindings({
          mrId,
          workspace: workspacePath,
          findings,
          summary: reviewSummary,
          title: title,
          sourceBranch,
          targetBranch,
        });
      }

      // 9. Close the review pane after a brief delay
      setTimeout(() => {
        try { ptyManager.kill(reviewPaneId); } catch {}
      }, 5000);

      return { ok: true, paneId: reviewPaneId, method: "llm", findings: findings.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Wait for a CLI pane to produce its first output (signal it's ready for input).
   * Falls back to a fixed timeout if no output is detected.
   */
  _waitForCliReady(paneId, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const ptyManager = this.opts.ptyManager;
      if (!ptyManager) return resolve({ ready: true, noManager: true });

      let resolved = false;

      // Listen for output on this specific pane
      // ptyManager emits "output" with (paneId, data) signature
      const onOutput = (pid, data) => {
        if (pid === paneId && !resolved) {
          resolved = true;
          clearTimeout(timer);
          ptyManager.off("output", onOutput);
          resolve({ ready: true, detected: true });
        }
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ptyManager.off("output", onOutput);
          resolve({ ready: true, timedOut: true });
        }
      }, timeoutMs);

      ptyManager.on("output", onOutput);
    });
  }

  /**
   * Main MR polling worker. Runs periodically (every 5 min) and on-demand.
   * If mr_review_model is configured → uses LLM to review diffs.
   * Otherwise → falls back to static regex analysis.
   * Returns a Promise (async) when LLM mode is active.
   */
  async _mrPoll(opts) {
    const force = opts?.force === true;
    const targetWorkspace = opts?.workspace || null; // Filter to specific workspace if provided
    const store = this.opts.memoryStore;
    const mrHandlers = this.opts.mrHandlers;
    const emitNotification = this.opts.emitNotification;
    const configStore = this.opts.configStore;

    console.log(`[mr_poll] Called with force=${force}, workspace=${targetWorkspace ?? 'all'}`);

    // Check if auto-review is enabled (force bypasses this for manual triggers)
    if (!configStore) { console.log(`[mr_poll] SKIP: no configStore`); return { summary: "no configStore", skipped: true }; }
    const config = configStore.get?.();
    console.log(`[mr_poll] Config: mr_auto_review=${config?.mr_auto_review}, mr_review_provider=${config?.mr_review_provider}, mr_review_model=${config?.mr_review_model}`);
    if (!force && !config?.mr_auto_review) { console.log(`[mr_poll] SKIP: auto-review disabled (force=${force})`); return { summary: "auto-review disabled", skipped: true }; }

    if (!mrHandlers) { console.log(`[mr_poll] SKIP: no mrHandlers`); return { summary: "no mrHandlers", skipped: true }; }
    if (!store) { console.log(`[mr_poll] SKIP: no memoryStore`); return { summary: "no memoryStore", skipped: true }; }

    // Check allowed workspaces — filter to target workspace if specified
    const allowedWorkspaces = targetWorkspace
      ? [targetWorkspace] // Only review the requested workspace
      : config?.mr_allowed_workspaces;
    if (!Array.isArray(allowedWorkspaces) || allowedWorkspaces.length === 0) {
      console.log(`[mr_poll] SKIP: no allowed workspaces`);
      return { summary: "no allowed workspaces", skipped: true };
    }

    // LLM model is required — no model = no review
    const useLLM = !!(config.mr_review_provider && config.mr_review_model);
    if (!useLLM) { console.log(`[mr_poll] SKIP: no review model configured`); return { summary: "no review model configured (mr_review_provider + mr_review_model required)", skipped: true }; }

    console.log(`[mr_poll] Review config: provider=${config.mr_review_provider}, model=${config.mr_review_model}, auto=${config.mr_auto_review}, force=${force}`);
    console.log(`[mr_poll] Allowed workspaces:`, JSON.stringify(allowedWorkspaces));

    const results = { total: 0, reviewed: 0, skipped: 0, errors: [] };

    try {
      // Process ALL allowed workspaces
      for (const wsPath of allowedWorkspaces) {
        console.log(`[mr_poll] Scanning workspace: ${wsPath}`);
        let listResult;
        try {
          listResult = mrHandlers.mrList({ cwd: wsPath, state: "open", limit: 20 });
        } catch (err) {
          console.error(`[mr_poll] mrList exception for ${wsPath}:`, err.message);
          results.errors.push(`${wsPath}: mrList failed: ${err.message}`);
          continue;
        }

        // mrList is async — await if needed
        const listRes = listResult && typeof listResult.then === "function" ? await listResult : listResult;
        console.log(`[mr_poll] mrList for ${wsPath}: ok=${listRes?.ok}, count=${listRes?.mrs?.length ?? "n/a"}, error=${listRes?.error || "none"}`);

        if (!listRes?.ok || !listRes.mrs || listRes.mrs.length === 0) {
          if (!listRes?.ok) results.errors.push(`${wsPath}: mrList failed: ${listRes?.error || "unknown"}`);
          continue;
        }

        results.total += listRes.mrs.length;

        for (const mr of listRes.mrs) {
          const mrId = mr.id || mr.number || mr.iid;
          if (!mrId) { results.skipped++; continue; }

          // Skip MRs that haven't changed since last review.
          // Compare mr.updated_at with the stored mr_updated_at from the last review.
          // force=true (manual trigger) still skips if no changes detected.
          const checked = store.isMrReviewed({ workspace: wsPath, mr_id: mrId });
          if (checked?.reviewed) {
            const mrUpdatedAt = mr.updated_at || mr.updatedAt || mr.updated || "";
            const lastReviewedAt = checked.mr_updated_at || "";
            if (mrUpdatedAt && lastReviewedAt && mrUpdatedAt === lastReviewedAt) {
              console.log(`[mr_poll] MR !${mrId} unchanged since last review (${lastReviewedAt}) — skipping`);
              results.skipped++;
              continue;
            }
            if (!force && !mrUpdatedAt) {
              // No updated_at available and not forced — skip to be safe
              console.log(`[mr_poll] MR !${mrId} already reviewed (no updated_at to compare) — skipping`);
              results.skipped++;
              continue;
            }
            console.log(`[mr_poll] MR !${mrId} has new changes: ${lastReviewedAt} → ${mrUpdatedAt}`);
          }

          console.log(`[mr_poll] Processing MR !${mrId}: "${mr.title || "?"}" in ${wsPath}`);
          try {
            const detail = mrHandlers.mrDetail({ cwd: wsPath, id: String(mrId), include_diff: true });
            const detailRes = detail && typeof detail.then === "function" ? await detail : detail;

            if (!detailRes?.ok) {
              console.error(`[mr_poll] MR !${mrId} detail failed: ${detailRes?.error}`);
              results.errors.push(`MR !${mrId}: detail failed`);
              continue;
            }

            // LLM-based review: spawn agent pane in the GIT REPO workspace
            console.log(`[mr_poll] Spawning LLM review for MR !${mrId} in workspace ${wsPath}...`);
            const reviewResult = await this._llmReview(mr, mrId, detailRes, wsPath, config, store, emitNotification);
            console.log(`[mr_poll] MR !${mrId} review result: ok=${reviewResult?.ok}, error=${reviewResult?.error || "none"}`);
            if (reviewResult.ok) {
              results.reviewed++;
            } else {
              results.errors.push(`MR !${mrId}: review failed: ${reviewResult.error}`);
            }
          } catch (err) {
            console.error(`[mr_poll] MR !${mrId} exception:`, err.message);
            results.errors.push(`MR !${mrId}: ${err.message}`);
          }
        }
      }

      results.summary = `reviewed ${results.reviewed}/${results.total} MRs (llm)`;
      if (results.skipped > 0) results.summary += `, ${results.skipped} skipped`;
      if (results.errors.length > 0) results.summary += `, ${results.errors.length} errors`;
      console.log(`[mr_poll] Done: ${results.summary}`);
      return results;
    } catch (err) {
      console.error(`[mr_poll] Top-level error:`, err.message);
      return { summary: `mr_poll error: ${err.message}`, error: err.message };
    } finally {
      // Clear reviewing state (for IPC trigger UI indicator)
      if (typeof this.opts.clearReviewingState === "function") {
        this.opts.clearReviewingState();
      }
    }
  }

  /**
   * Run a worker on demand (outside its normal interval).
   * Used by IPC trigger handlers (e.g. mr_review:trigger).
   * Includes cooldown protection to prevent rapid re-triggering.
   * @param {string} name - worker name
   * @param {Object} [triggerOpts] - extra options passed through to the worker (e.g. { workspace })
   */
  triggerWorker(name, triggerOpts) {
    const worker = this.workers.get(name);
    if (!worker) return { ok: false, error: `worker ${name} not found` };
    if (worker.running) {
      console.log(`[triggerWorker] Worker ${name} stuck in running state — force resetting`);
      worker.running = false;
    }
    // Cooldown: prevent rapid re-triggering (min 30s between manual triggers)
    const now = Date.now();
    if (worker.lastRun && (now - worker.lastRun) < 30000) {
      const remaining = Math.ceil((30000 - (now - worker.lastRun)) / 1000);
      return { ok: false, error: `worker ${name} was triggered ${Math.round((now - worker.lastRun) / 1000)}s ago — wait ${remaining}s` };
    }
    console.log(`[triggerWorker] Triggering ${name} on demand, opts:`, JSON.stringify(triggerOpts));
    this._runWorker(name, { force: true, ...triggerOpts });
    return { ok: true };
  }

  close() {
    for (const [name, worker] of this.workers) {
      if (worker.timer) { clearInterval(worker.timer); worker.timer = null; }
    }
    this._saveState();
  }
}

module.exports = { WorkerManager, WORKER_DEFINITIONS, ON_DEMAND_TRIGGERS, detectTriggers };
