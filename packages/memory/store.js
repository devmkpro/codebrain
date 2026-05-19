"use strict";

const path = require("path");
const fs = require("fs");
const { KnowledgeGraph } = require("./knowledge-graph.js");
const { tokenize, buildTfIdf, cosineSimilarity } = require("./vector-store.js");

/**
 * Resolve better-sqlite3 with fallback to system Node.js native binary.
 *
 * When running inside the packaged Electron app via MCP stdio (CLI mode),
 * the default better-sqlite3 binary is compiled for Electron's ABI, which
 * doesn't match the system Node.js that Claude Code uses. This loader
 * tries the default first, then falls back to the system ABI binary
 * shipped in resources/native/ (copied by prebuild-native.mjs before
 * electron-builder recompiles for Electron).
 *
 * better-sqlite3 supports `nativeBinding` option per Database instance,
 * so we create a wrapper Database that always specifies the correct binary.
 */
function loadBetterSqlite3() {
  // Try default first (works in dev mode and when ABI matches)
  try {
    const DefaultDatabase = require("better-sqlite3");
    // Quick smoke test to ensure it actually works
    new DefaultDatabase(":memory:").close();
    return DefaultDatabase;
  } catch (err) {
    const msg = String(err.message || err);
    // Only fall back on ABI/compile mismatch errors
    const isAbiMismatch =
      msg.includes("NODE_MODULE_VERSION") ||
      msg.includes("was compiled against") ||
      msg.includes("not a valid Win32 application") ||
      msg.includes("is not a valid Win32 application") ||
      msg.includes("The specified module could not be found") ||
      msg.includes("ERR_DLOPEN_FAILED");
    if (!isAbiMismatch) {
      throw err;
    }
  }

  // ABI mismatch — find the system Node.js binary from resources/native/
  // In packaged mode: resources/native/ is at process.resourcesPath/native/
  // In dev mode: resources/native/ is at <project>/resources/native/
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "native", "better_sqlite3.node") : null,
    path.join(__dirname, "..", "..", "resources", "native", "better_sqlite3.node"),
  ].filter(Boolean);

  for (const bindingPath of candidates) {
    if (!fs.existsSync(bindingPath)) continue;
    try {
      const Database = require("better-sqlite3");
      // better-sqlite3 v12+ accepts { nativeBinding: string } which loads
      // the .node file from the given path instead of the compiled-for-Electron one
      new Database(":memory:", { nativeBinding: bindingPath }).close();

      // Return a wrapper that always uses the correct native binding
      function DatabaseWrapper(filename, options) {
        return new Database(filename, { ...options, nativeBinding: bindingPath });
      }
      DatabaseWrapper.prototype = Database.prototype;
      return DatabaseWrapper;
    } catch {
      continue;
    }
  }

  throw new Error(
    "better-sqlite3 ABI mismatch and no system Node.js binary found in resources/native/. " +
    "Run 'npm run prebuild-native' before building the app."
  );
}

const Database = loadBetterSqlite3();

/**
 * SQLite-backed shared memory store for CodeBrain multi-agent sessions.
 * Inspired by Ruflo's AgentDB/HybridBackend architecture.
 *
 * Memory types:
 *   - episodic:  specific events/experiences during a session
 *   - semantic:  general knowledge, facts, decisions
 *   - procedural: how-to knowledge, patterns that work
 *   - working:   temporary scratch space for current task
 *
 * @param {string} dbPath - Path to the SQLite database file
 */
function createMemoryStore(dbPath) {
  // Ensure parent directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // ── Schema ────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL DEFAULT 'working' CHECK(type IN ('episodic','semantic','procedural','working')),
      key          TEXT NOT NULL,
      content      TEXT NOT NULL,
      tags         TEXT DEFAULT '[]',
      agent_id     TEXT,
      workspace    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      access_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

    CREATE TABLE IF NOT EXISTS patterns (
      id                   TEXT PRIMARY KEY,
      pattern_type         TEXT NOT NULL,
      description          TEXT NOT NULL,
      source_trajectory    TEXT,
      quality_score        REAL DEFAULT 0.5,
      success_count        INTEGER DEFAULT 0,
      failure_count        INTEGER DEFAULT 0,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
    CREATE INDEX IF NOT EXISTS idx_patterns_quality ON patterns(quality_score);

    CREATE TABLE IF NOT EXISTS trajectories (
      id              TEXT PRIMARY KEY,
      session_id      TEXT,
      agent_id        TEXT,
      workspace       TEXT,
      task_type       TEXT,
      steps           TEXT NOT NULL DEFAULT '[]',
      outcome         TEXT NOT NULL DEFAULT 'unknown' CHECK(outcome IN ('success','failure','partial','unknown')),
      outcome_detail  TEXT,
      duration_ms     INTEGER,
      tool_calls      INTEGER DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_traj_session ON trajectories(session_id);
    CREATE INDEX IF NOT EXISTS idx_traj_agent ON trajectories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_traj_outcome ON trajectories(outcome);
    CREATE INDEX IF NOT EXISTS idx_traj_type ON trajectories(task_type);
    CREATE INDEX IF NOT EXISTS idx_traj_created ON trajectories(created_at);

    CREATE TABLE IF NOT EXISTS events (
      id           TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL DEFAULT 'agent',
      event_type   TEXT NOT NULL,
      payload      TEXT NOT NULL DEFAULT '{}',
      metadata     TEXT DEFAULT '{}',
      sequence     INTEGER NOT NULL,
      snapshot_id  TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

    CREATE TABLE IF NOT EXISTS event_snapshots (
      id           TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      state        TEXT NOT NULL DEFAULT '{}',
      sequence     INTEGER NOT NULL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate ON event_snapshots(aggregate_id);
  `);

  // Migration: add scope column if not already present (ALTER TABLE lacks IF NOT EXISTS)
  try {
    db.exec(`ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project','local','user'))`);
  } catch (e) {
    if (!String(e.message).includes("duplicate column")) throw e;
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`);

  // ── Knowledge Graph + Vector Store ────────────────────────────────────────
  let knowledgeGraph;
  try {
    knowledgeGraph = new KnowledgeGraph(db);
  } catch (e) {
    // If KnowledgeGraph fails to initialize, features degrade gracefully
    knowledgeGraph = null;
  }

  // ── Prepared Statements ───────────────────────────────────────────────────
  const stmts = {
    insert: db.prepare(`
      INSERT INTO memories (id, type, key, content, tags, agent_id, workspace, scope)
      VALUES (@id, @type, @key, @content, @tags, @agent_id, @workspace, @scope)
    `),
    update: db.prepare(`
      UPDATE memories SET content = @content, tags = @tags, updated_at = unixepoch()
      WHERE id = @id
    `),
    getById: db.prepare(`SELECT * FROM memories WHERE id = ?`),
    getByKey: db.prepare(`SELECT * FROM memories WHERE key = ? AND (workspace = ? OR workspace IS NULL) ORDER BY updated_at DESC`),
    searchKeyword: db.prepare(`
      SELECT * FROM memories
      WHERE (content LIKE @query OR key LIKE @query OR tags LIKE @query)
        AND (@type IS NULL OR type = @type)
        AND (@workspace IS NULL OR workspace = @workspace)
        AND (@scope IS NULL OR scope = @scope)
      ORDER BY updated_at DESC LIMIT @limit
    `),
    list: db.prepare(`
      SELECT * FROM memories
      WHERE (@type IS NULL OR type = @type)
        AND (@agent_id IS NULL OR agent_id = @agent_id)
        AND (@workspace IS NULL OR workspace = @workspace)
        AND (@scope IS NULL OR scope = @scope)
      ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
    `),
    deleteById: db.prepare(`DELETE FROM memories WHERE id = ?`),
    deleteByKey: db.prepare(`DELETE FROM memories WHERE key = ? AND (workspace = ? OR workspace IS NULL)`),
    incrementAccess: db.prepare(`UPDATE memories SET access_count = access_count + 1 WHERE id = ?`),
    stats: db.prepare(`
      SELECT type, COUNT(*) as count, SUM(LENGTH(content)) as total_bytes
      FROM memories
      WHERE (@workspace IS NULL OR workspace = @workspace)
      GROUP BY type
    `),
    totalCount: db.prepare(`
      SELECT COUNT(*) as total FROM memories
      WHERE (@workspace IS NULL OR workspace = @workspace)
    `),
    // Patterns
    insertPattern: db.prepare(`
      INSERT INTO patterns (id, pattern_type, description, source_trajectory, quality_score)
      VALUES (@id, @pattern_type, @description, @source_trajectory, @quality_score)
    `),
    listPatterns: db.prepare(`
      SELECT * FROM patterns
      WHERE (@pattern_type IS NULL OR pattern_type = @pattern_type)
      ORDER BY quality_score DESC, updated_at DESC LIMIT @limit
    `),
    updatePatternScore: db.prepare(`
      UPDATE patterns SET quality_score = @quality_score, success_count = success_count + 1, updated_at = unixepoch()
      WHERE id = @id
    `),
    deletePattern: db.prepare(`DELETE FROM patterns WHERE id = ?`),
    // Trajectories
    insertTrajectory: db.prepare(`
      INSERT INTO trajectories (id, session_id, agent_id, workspace, task_type, steps, outcome, outcome_detail, duration_ms, tool_calls)
      VALUES (@id, @session_id, @agent_id, @workspace, @task_type, @steps, @outcome, @outcome_detail, @duration_ms, @tool_calls)
    `),
    getTrajectory: db.prepare(`SELECT * FROM trajectories WHERE id = ?`),
    listTrajectories: db.prepare(`
      SELECT * FROM trajectories
      WHERE (@session_id IS NULL OR session_id = @session_id)
        AND (@agent_id IS NULL OR agent_id = @agent_id)
        AND (@workspace IS NULL OR workspace = @workspace)
        AND (@outcome IS NULL OR outcome = @outcome)
        AND (@task_type IS NULL OR task_type = @task_type)
      ORDER BY created_at DESC LIMIT @limit OFFSET @offset
    `),
    deleteTrajectory: db.prepare(`DELETE FROM trajectories WHERE id = ?`),
    trajectoryStats: db.prepare(`
      SELECT outcome, COUNT(*) as count, AVG(duration_ms) as avg_duration, AVG(tool_calls) as avg_tool_calls
      FROM trajectories
      WHERE (@workspace IS NULL OR workspace = @workspace)
      GROUP BY outcome
    `),
    successfulByType: db.prepare(`
      SELECT * FROM trajectories
      WHERE outcome = 'success' AND (@task_type IS NULL OR task_type = @task_type)
      ORDER BY created_at DESC LIMIT @limit
    `),
    // Events
    insertEvent: db.prepare(`
      INSERT INTO events (id, aggregate_id, aggregate_type, event_type, payload, metadata, sequence)
      VALUES (@id, @aggregate_id, @aggregate_type, @event_type, @payload, @metadata, @sequence)
    `),
    getEventsByAggregate: db.prepare(`SELECT * FROM events WHERE aggregate_id = ? AND sequence > ? ORDER BY sequence`),
    getEventsByType: db.prepare(`SELECT * FROM events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?`),
    getLatestSnapshot: db.prepare(`SELECT * FROM event_snapshots WHERE aggregate_id = ? ORDER BY sequence DESC LIMIT 1`),
    insertSnapshot: db.prepare(`
      INSERT INTO event_snapshots (id, aggregate_id, aggregate_type, state, sequence)
      VALUES (@id, @aggregate_id, @aggregate_type, @state, @sequence)
    `),
    eventCount: db.prepare(`SELECT COUNT(*) as count FROM events WHERE aggregate_id = ?`),
    pruneEvents: db.prepare(`DELETE FROM events WHERE aggregate_id = ? AND sequence <= ?`),
  };

  // ── ID Generator ──────────────────────────────────────────────────────────
  function genId() {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  function genPatternId() {
    return `pat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  function genEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  function genSnapshotId() {
    return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    /**
     * Write a memory entry. If `id` is provided and exists, updates it.
     * @param {{ type?: string, key: string, content: string, tags?: string[], agent_id?: string, workspace?: string, id?: string, scope?: 'project'|'local'|'user' }} opts
     * @returns {{ ok: boolean, id: string }}
     */
    write({ id, type = "working", key, content, tags = [], agent_id, workspace, scope = 'project' }) {
      if (!key || !content) return { ok: false, error: "key and content are required" };
      const tagsJson = JSON.stringify(tags);
      if (id) {
        const existing = stmts.getById.get(id);
        if (existing) {
          stmts.update.run({ id, content, tags: tagsJson });
          return { ok: true, id, updated: true };
        }
      }
      const newId = id || genId();
      stmts.insert.run({
        id: newId,
        type,
        key,
        content,
        tags: tagsJson,
        agent_id: agent_id || null,
        workspace: workspace || null,
        scope,
      });

      // Auto-update knowledge graph and vector store
      if (knowledgeGraph) {
        try {
          // Add node to graph
          knowledgeGraph.addNode(newId, { type, key, agent_id, workspace: workspace || null, scope });

          // Build and store TF-IDF vector
          const tokens = tokenize(`${key} ${content} ${(JSON.parse(tagsJson)).join(" ")}`);
          const vector = new Map();
          for (const tok of tokens) {
            vector.set(tok, (vector.get(tok) || 0) + 1);
          }
          // Normalize to TF
          for (const [tok, count] of vector) {
            vector.set(tok, count / tokens.length);
          }
          knowledgeGraph.storeVector(newId, vector);

          // Create temporal edges to 5 most recent memories of same type
          try {
            const recent = db.prepare(
              "SELECT id FROM memories WHERE type = ? AND id != ? ORDER BY created_at DESC LIMIT 5"
            ).all(type, newId);
            for (const r of recent) {
              knowledgeGraph.addEdge(newId, r.id, "temporal", 0.5);
            }
          } catch {}

          // Create similar edges using cosine similarity
          try {
            knowledgeGraph.createSimilarEdges(newId, 0.3, 5);
          } catch {}
        } catch {
          // Graph/vector errors should never block memory writes
        }
      }

      return { ok: true, id: newId, created: true };
    },

    /**
     * Read a memory by id or key.
     * @param {{ id?: string, key?: string, workspace?: string, scope?: 'project'|'local'|'user' }} opts
     */
    read({ id, key, workspace, scope }) {
      let row;
      if (id) {
        row = stmts.getById.get(id);
        if (scope && row && row.scope !== scope) {
            return { ok: false, error: "not found in specified scope" };
        }
      } else if (key) {
        // Simplified logic: getByKey is already workspace-aware which aligns with 'project' scope
        // For cross-scope reads, `search` is better. This keeps `read` targeted.
        const rows = stmts.getByKey.all(key, workspace || null);
        row = rows[0];
         if (scope && row && row.scope !== scope) {
            const allRows = stmts.getByKey.all(key, workspace || null);
            row = allRows.find(r => r.scope === scope);
        } else {
            row = rows[0];
        }
      } else {
        return { ok: false, error: "id or key is required" };
      }
      if (!row) return { ok: false, error: "not found" };
      stmts.incrementAccess.run(row.id);
      return { ok: true, memory: { ...row, tags: JSON.parse(row.tags || "[]") } };
    },

    /**
     * Search memories by keyword across content, key, and tags.
     * When scope is NOT specified, searches across all scopes.
     * @param {{ query: string, type?: string, workspace?: string, limit?: number, scope?: 'project'|'local'|'user' }} opts
     */
    search({ query, type, workspace, limit = 20, scope }) {
      if (!query) return { ok: false, error: "query is required" };
      const likeQuery = `%${query}%`;
      const rows = stmts.searchKeyword.all({
        query: likeQuery,
        type: type || null,
        workspace: workspace || null,
        limit,
        scope: scope || null,
      });

      let results = rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") }));

      // Graph-aware ranking: combinedScore = 0.7 * textScore + 0.3 * pageRank
      if (knowledgeGraph && results.length > 1) {
        try {
          const ranks = knowledgeGraph.pageRank();
          if (ranks && ranks.size > 0) {
            // Normalize PageRank scores to 0-1 range
            let maxRank = 0;
            for (const [, score] of ranks) {
              if (score > maxRank) maxRank = score;
            }
            if (maxRank > 0) {
              results = results.map((r, i) => {
                const textScore = 1 - (i / results.length); // higher position = higher text score
                const pageRank = (ranks.get(r.id) || 0) / maxRank;
                const combinedScore = 0.7 * textScore + 0.3 * pageRank;
                return { ...r, _combinedScore: Math.round(combinedScore * 1000) / 1000 };
              });
              results.sort((a, b) => (b._combinedScore || 0) - (a._combinedScore || 0));
            }
          }
        } catch {
          // Graph ranking failure → fall back to default text ordering
        }
      }

      return {
        ok: true,
        memories: results,
        count: results.length,
      };
    },

    /**
     * List memories with optional filters.
     * When scope is NOT specified, lists across all scopes.
     * @param {{ type?: string, agent_id?: string, workspace?: string, limit?: number, offset?: number, scope?: 'project'|'local'|'user' }} opts
     */
    list({ type, agent_id, workspace, limit = 50, offset = 0, scope } = {}) {
      const rows = stmts.list.all({
        type: type || null,
        agent_id: agent_id || null,
        workspace: workspace || null,
        limit,
        offset,
        scope: scope || null,
      });
      return {
        ok: true,
        memories: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") })),
        count: rows.length,
      };
    },

    /**
     * Delete a memory by id or key.
     * @param {{ id?: string, key?: string, workspace?: string }} opts
     */
    delete({ id, key, workspace }) {
      if (id) {
        const result = stmts.deleteById.run(id);
        return { ok: true, deleted: result.changes > 0 };
      }
      if (key) {
        const result = stmts.deleteByKey.run(key, workspace || null);
        return { ok: true, deleted: result.changes > 0 };
      }
      return { ok: false, error: "id or key is required" };
    },

    /**
     * Moves a memory to a different scope.
     * @param {{ id: string, targetScope: 'project'|'local'|'user' }} opts
     */
    memoryTransfer({ id, targetScope }) {
        if (!id || !targetScope) return { ok: false, error: "id and targetScope are required" };
        const result = db.prepare("UPDATE memories SET scope = ? WHERE id = ?").run(targetScope, id);
        return { ok: true, updated: result.changes > 0 };
    },

    /**
     * Get memory statistics.
     * @param {{ workspace?: string }} opts
     */
    stats({ workspace } = {}) {
      const rows = stmts.stats.all({ workspace: workspace || null });
      const total = stmts.totalCount.get({ workspace: workspace || null });
      const byType = {};
      for (const r of rows) {
        byType[r.type] = { count: r.count, totalBytes: r.total_bytes };
      }
      return { ok: true, total: total.total, byType };
    },

    // ── Pattern Management ────────────────────────────────────────────────────

    /**
     * Save a learned pattern.
     * @param {{ pattern_type: string, description: string, source_trajectory?: string, quality_score?: number }} opts
     */
    writePattern({ pattern_type, description, source_trajectory, quality_score = 0.5 }) {
      if (!pattern_type || !description) return { ok: false, error: "pattern_type and description are required" };
      const id = genPatternId();
      stmts.insertPattern.run({
        id,
        pattern_type,
        description,
        source_trajectory: source_trajectory || null,
        quality_score,
      });
      return { ok: true, id };
    },

    /**
     * List patterns.
     * @param {{ pattern_type?: string, limit?: number }} opts
     */
    listPatterns({ pattern_type, limit = 20 } = {}) {
      const rows = stmts.listPatterns.all({ pattern_type: pattern_type || null, limit });
      return { ok: true, patterns: rows, count: rows.length };
    },

    /**
     * Update pattern quality score after a successful use.
     * @param {{ id: string, quality_score: number }} opts
     */
    updatePatternScore({ id, quality_score }) {
      stmts.updatePatternScore.run({ id, quality_score });
      return { ok: true };
    },

    /**
     * Delete a pattern.
     * @param {{ id: string }} opts
     */
    deletePattern({ id }) {
      stmts.deletePattern.run(id);
      return { ok: true };
    },

    // ── Trajectory Tracking ──────────────────────────────────────────────────

    /**
     * Record a trajectory (sequence of actions for a task).
     * @param {{ session_id?: string, agent_id?: string, workspace?: string, task_type?: string, steps: Array, outcome: string, outcome_detail?: string, duration_ms?: number, tool_calls?: number }} opts
     */
    recordTrajectory({ session_id, agent_id, workspace, task_type, steps = [], outcome = "unknown", outcome_detail, duration_ms, tool_calls = 0 }) {
      const id = `traj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      stmts.insertTrajectory.run({
        id,
        session_id: session_id || null,
        agent_id: agent_id || null,
        workspace: workspace || null,
        task_type: task_type || null,
        steps: JSON.stringify(steps),
        outcome,
        outcome_detail: outcome_detail || null,
        duration_ms: duration_ms || null,
        tool_calls,
      });
      return { ok: true, id };
    },

    /**
     * Add a step to an existing trajectory.
     * @param {{ id: string, step: object }} opts
     */
    addTrajectoryStep({ id, step }) {
      const row = stmts.getTrajectory.get(id);
      if (!row) return { ok: false, error: "trajectory not found" };
      const steps = JSON.parse(row.steps || "[]");
      steps.push({ ...step, timestamp: Date.now() });
      db.prepare("UPDATE trajectories SET steps = ?, tool_calls = tool_calls + 1 WHERE id = ?")
        .run(JSON.stringify(steps), id);
      return { ok: true, stepsCount: steps.length };
    },

    /**
     * Update trajectory outcome.
     * @param {{ id: string, outcome: string, outcome_detail?: string, duration_ms?: number }} opts
     */
    updateTrajectory({ id, outcome, outcome_detail, duration_ms }) {
      const sets = ["outcome = @outcome"];
      const params = { id, outcome };
      if (outcome_detail) { sets.push("outcome_detail = @outcome_detail"); params.outcome_detail = outcome_detail; }
      if (duration_ms !== undefined) { sets.push("duration_ms = @duration_ms"); params.duration_ms = duration_ms; }
      db.prepare(`UPDATE trajectories SET ${sets.join(", ")} WHERE id = @id`).run(params);
      return { ok: true };
    },

    /**
     * List trajectories with filters.
     */
    listTrajectories({ session_id, agent_id, workspace, outcome, task_type, limit = 20, offset = 0 } = {}) {
      const rows = stmts.listTrajectories.all({
        session_id: session_id || null,
        agent_id: agent_id || null,
        workspace: workspace || null,
        outcome: outcome || null,
        task_type: task_type || null,
        limit,
        offset,
      });
      return {
        ok: true,
        trajectories: rows.map((r) => ({ ...r, steps: JSON.parse(r.steps || "[]") })),
        count: rows.length,
      };
    },

    /**
     * Get a single trajectory by ID.
     */
    getTrajectory({ id }) {
      const row = stmts.getTrajectory.get(id);
      if (!row) return { ok: false, error: "not found" };
      return { ok: true, trajectory: { ...row, steps: JSON.parse(row.steps || "[]") } };
    },

    /**
     * Get trajectory statistics.
     */
    trajectoryStats({ workspace } = {}) {
      const rows = stmts.trajectoryStats.all({ workspace: workspace || null });
      const byOutcome = {};
      for (const r of rows) {
        byOutcome[r.outcome] = { count: r.count, avgDurationMs: Math.round(r.avg_duration || 0), avgToolCalls: Math.round(r.avg_tool_calls || 0) };
      }
      return { ok: true, byOutcome };
    },

    /**
     * Get successful trajectories for pattern extraction.
     */
    getSuccessfulTrajectories({ task_type, limit = 10 } = {}) {
      const rows = stmts.successfulByType.all({ task_type: task_type || null, limit });
      return {
        ok: true,
        trajectories: rows.map((r) => ({ ...r, steps: JSON.parse(r.steps || "[]") })),
        count: rows.length,
      };
    },

    /**
     * Extract patterns from successful trajectories.
     * Analyzes step sequences to find common action patterns.
     */
    extractPatterns({ task_type, minOccurrences = 2, workspace } = {}) {
      const rows = stmts.successfulByType.all({ task_type: task_type || null, limit: 50 });
      if (rows.length < minOccurrences) return { ok: true, patterns: [], message: `Need at least ${minOccurrences} successful trajectories, found ${rows.length}` };

      // Group by action sequence signature
      const signatures = new Map();
      for (const row of rows) {
        const steps = JSON.parse(row.steps || "[]");
        const actions = steps.map((s) => s.action || s.tool || "unknown").join(" → ");
        if (!actions) continue;
        const existing = signatures.get(actions) || { actions, count: 0, examples: [], avgDuration: 0, totalDuration: 0 };
        existing.count++;
        existing.examples.push(row.id);
        existing.totalDuration += row.duration_ms || 0;
        signatures.set(actions, existing);
      }

      const patterns = [];
      for (const [, sig] of signatures) {
        if (sig.count >= minOccurrences) {
          // Auto-save as a pattern
          const patternResult = this.writePattern({
            pattern_type: task_type || "general",
            description: `Action sequence (${sig.count} occurrences): ${sig.actions}`,
            source_trajectory: sig.examples.slice(0, 3).join(","),
            quality_score: Math.min(1, sig.count / 10),
          });
          patterns.push({
            actions: sig.actions,
            occurrences: sig.count,
            avgDurationMs: Math.round(sig.totalDuration / sig.count),
            patternId: patternResult.id,
          });
        }
      }

      patterns.sort((a, b) => b.occurrences - a.occurrences);
      return { ok: true, patterns, analyzed: rows.length };
    },

    /**
     * Delete a trajectory.
     */
    deleteTrajectory({ id }) {
      stmts.deleteTrajectory.run(id);
      return { ok: true };
    },

    // ── Event Sourcing ───────────────────────────────────────────────────────

    /**
     * Store an event and automatically create snapshots.
     * @param {{ aggregate_id: string, aggregate_type?: string, event_type: string, payload: object, metadata?: object }} opts
     */
    eventStore({ aggregate_id, aggregate_type = 'agent', event_type, payload, metadata = {} }) {
        if (!aggregate_id || !event_type || !payload) {
            return { ok: false, error: "aggregate_id, event_type, and payload are required" };
        }
        const runInTx = db.transaction(() => {
            const { count } = stmts.eventCount.get(aggregate_id) || { count: 0 };
            const sequence = count + 1;
            const id = genEventId();

            stmts.insertEvent.run({
                id,
                aggregate_id,
                aggregate_type,
                event_type,
                payload: JSON.stringify(payload),
                metadata: JSON.stringify(metadata),
                sequence
            });

            if (sequence % 100 === 0) {
                this.eventSnapshot({ aggregate_id });
            }
            return { ok: true, id, sequence };
        });
        return runInTx();
    },

    /**
     * Replay events for an aggregate to reconstruct its state.
     * @param {{ aggregate_id: string, from_sequence?: number }} opts
     */
    eventReplay({ aggregate_id, from_sequence = 0 }) {
        const snapshot = stmts.getLatestSnapshot.get(aggregate_id);
        let startSequence = from_sequence;
        if (snapshot && snapshot.sequence > startSequence) {
            startSequence = snapshot.sequence;
        }

        const events = stmts.getEventsByAggregate.all(aggregate_id, startSequence);

        return {
            ok: true,
            snapshot: snapshot ? { ...snapshot, state: JSON.parse(snapshot.state || '{}') } : null,
            events: events.map(e => ({
                ...e,
                payload: JSON.parse(e.payload || '{}'),
                metadata: JSON.parse(e.metadata || '{}')
            }))
        };
    },

    /**
     * List events with filters.
     * @param {{ aggregate_id?: string, event_type?: string, limit?: number }} opts
     */
    eventList({ aggregate_id, event_type, limit = 50 } = {}) {
        let rows;
        if (aggregate_id) {
            rows = db.prepare("SELECT * FROM events WHERE aggregate_id = ? ORDER BY sequence DESC LIMIT ?").all(aggregate_id, limit);
        } else if (event_type) {
            rows = stmts.getEventsByType.all(event_type, limit);
        } else {
            rows = db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?").all(limit);
        }
        return {
            ok: true,
            events: rows.map(e => ({
                ...e,
                payload: JSON.parse(e.payload || '{}'),
                metadata: JSON.parse(e.metadata || '{}')
            })),
            count: rows.length
        };
    },

    /**
     * Force a snapshot of an aggregate's state.
     * @param {{ aggregate_id: string }} opts
     */
    eventSnapshot({ aggregate_id }) {
        const { snapshot, events } = this.eventReplay({ aggregate_id });
        if (!events.length && !snapshot) return { ok: false, error: "no events to snapshot" };

        let state = snapshot ? snapshot.state : {};
        let lastSequence = snapshot ? snapshot.sequence : 0;

        // Apply events to state
        for (const event of events) {
            state = { ...state, ...event.payload }; // Example reducer
            lastSequence = event.sequence;
        }

        const runInTx = db.transaction(() => {
            const id = genSnapshotId();
            const aggregate_type = events.length > 0 ? events[0].aggregate_type : (snapshot ? snapshot.aggregate_type : 'agent');
            stmts.insertSnapshot.run({
                id,
                aggregate_id,
                aggregate_type,
                state: JSON.stringify(state),
                sequence: lastSequence
            });
            stmts.pruneEvents.run(aggregate_id, lastSequence);
            return { ok: true, id, snapshotSequence: lastSequence };
        });

        return runInTx();
    },

    /**
     * Get event statistics.
     * @param {{ workspace?: string }} opts - Note: workspace is for potential future use.
     */
    eventStats({ workspace } = {}) {
        const total = db.prepare("SELECT COUNT(*) as count FROM events").get().count;
        const byAggregateType = db.prepare("SELECT aggregate_type, COUNT(*) as count FROM events GROUP BY aggregate_type").all();
        const byEventType = db.prepare("SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type").all();
        return {
            ok: true,
            total,
            byAggregateType: byAggregateType.reduce((acc, row) => ({ ...acc, [row.aggregate_type]: row.count }), {}),
            byEventType: byEventType.reduce((acc, row) => ({ ...acc, [row.event_type]: row.count }), {})
        };
    },

    /**
     * Close the database connection.
     */
    close() {
      if (knowledgeGraph) {
        try { knowledgeGraph.close(); } catch {}
      }
      db.close();
    },

    // ── Knowledge Graph Methods ───────────────────────────────────────────

    /**
     * Get a memory node and its graph neighbors.
     * @param {{ id: string }} opts
     */
    memoryGraph({ id }) {
      if (!knowledgeGraph) return { ok: false, error: "knowledge graph not available" };
      if (!id) return { ok: false, error: "id is required" };
      try {
        const graph = knowledgeGraph.getMemoryGraph(id);
        return { ok: true, ...graph };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    /**
     * Get PageRank scores for all memories.
     * @param {{ workspace?: string }} opts
     */
    memoryRank({ workspace } = {}) {
      if (!knowledgeGraph) return { ok: false, error: "knowledge graph not available" };
      try {
        const ranks = knowledgeGraph.pageRank();
        const ranked = [];
        for (const [memoryId, score] of ranks) {
          // Optionally filter by workspace
          if (workspace) {
            try {
              const row = stmts.getById.get(memoryId);
              if (row && row.workspace && row.workspace !== workspace) continue;
            } catch {}
          }
          ranked.push({ id: memoryId, score: Math.round(score * 10000) / 10000 });
        }
        ranked.sort((a, b) => b.score - a.score);
        return { ok: true, ranks: ranked, count: ranked.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    /**
     * Find memories similar to a given memory using TF-IDF cosine similarity.
     * @param {{ id: string, limit?: number }} opts
     */
    memorySimilar({ id, limit = 10 }) {
      if (!knowledgeGraph) return { ok: false, error: "knowledge graph not available" };
      if (!id) return { ok: false, error: "id is required" };
      try {
        const similar = knowledgeGraph.findSimilar(id, limit);
        return { ok: true, similar, count: similar.length };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };
}

module.exports = { createMemoryStore };
