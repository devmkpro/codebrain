"use strict";

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

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
  `);

  // ── Prepared Statements ───────────────────────────────────────────────────
  const stmts = {
    insert: db.prepare(`
      INSERT INTO memories (id, type, key, content, tags, agent_id, workspace)
      VALUES (@id, @type, @key, @content, @tags, @agent_id, @workspace)
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
      ORDER BY updated_at DESC LIMIT @limit
    `),
    list: db.prepare(`
      SELECT * FROM memories
      WHERE (@type IS NULL OR type = @type)
        AND (@agent_id IS NULL OR agent_id = @agent_id)
        AND (@workspace IS NULL OR workspace = @workspace)
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
  };

  // ── ID Generator ──────────────────────────────────────────────────────────
  function genId() {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  function genPatternId() {
    return `pat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    /**
     * Write a memory entry. If `id` is provided and exists, updates it.
     * @param {{ type?: string, key: string, content: string, tags?: string[], agent_id?: string, workspace?: string, id?: string }} opts
     * @returns {{ ok: boolean, id: string }}
     */
    write({ id, type = "working", key, content, tags = [], agent_id, workspace }) {
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
      });
      return { ok: true, id: newId, created: true };
    },

    /**
     * Read a memory by id or key.
     * @param {{ id?: string, key?: string, workspace?: string }} opts
     */
    read({ id, key, workspace }) {
      let row;
      if (id) {
        row = stmts.getById.get(id);
      } else if (key) {
        const rows = stmts.getByKey.all(key, workspace || null);
        row = rows[0];
      } else {
        return { ok: false, error: "id or key is required" };
      }
      if (!row) return { ok: false, error: "not found" };
      stmts.incrementAccess.run(row.id);
      return { ok: true, memory: { ...row, tags: JSON.parse(row.tags || "[]") } };
    },

    /**
     * Search memories by keyword across content, key, and tags.
     * @param {{ query: string, type?: string, workspace?: string, limit?: number }} opts
     */
    search({ query, type, workspace, limit = 20 }) {
      if (!query) return { ok: false, error: "query is required" };
      const likeQuery = `%${query}%`;
      const rows = stmts.searchKeyword.all({
        query: likeQuery,
        type: type || null,
        workspace: workspace || null,
        limit,
      });
      return {
        ok: true,
        memories: rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") })),
        count: rows.length,
      };
    },

    /**
     * List memories with optional filters.
     * @param {{ type?: string, agent_id?: string, workspace?: string, limit?: number, offset?: number }} opts
     */
    list({ type, agent_id, workspace, limit = 50, offset = 0 } = {}) {
      const rows = stmts.list.all({
        type: type || null,
        agent_id: agent_id || null,
        workspace: workspace || null,
        limit,
        offset,
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

    /**
     * Close the database connection.
     */
    close() {
      db.close();
    },
  };
}

module.exports = { createMemoryStore };
