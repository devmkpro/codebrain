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

    CREATE TABLE IF NOT EXISTS session_history (
      id           TEXT PRIMARY KEY,
      pane_id      TEXT,
      label        TEXT,
      agent        TEXT,
      model        TEXT,
      provider_id  TEXT,
      workspace    TEXT,
      started_at   INTEGER,
      ended_at     INTEGER,
      duration_ms  INTEGER,
      exit_code    INTEGER,
      output_preview TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_history_workspace ON session_history(workspace);
    CREATE INDEX IF NOT EXISTS idx_session_history_ended ON session_history(ended_at);

    CREATE TABLE IF NOT EXISTS handoffs (
      id             TEXT PRIMARY KEY,
      pane_id        TEXT NOT NULL,
      summary        TEXT,
      status         TEXT CHECK(status IN ('done','blocked','error')),
      artifacts      TEXT,
      submitted_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      workspace      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_handoffs_pane ON handoffs(pane_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_workspace ON handoffs(workspace);
    CREATE INDEX IF NOT EXISTS idx_handoffs_submitted ON handoffs(submitted_at);

    CREATE TABLE IF NOT EXISTS agents (
      id           TEXT PRIMARY KEY,
      pane_id      TEXT UNIQUE,
      label        TEXT,
      role         TEXT,
      model        TEXT,
      provider_id  TEXT,
      status       TEXT DEFAULT 'active',
      spawned_at   INTEGER,
      exited_at    INTEGER,
      workspace    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace);

    CREATE TABLE IF NOT EXISTS agent_messages (
      id           TEXT PRIMARY KEY,
      from_pane    TEXT,
      to_pane      TEXT,
      content      TEXT,
      type         TEXT,
      task_id      TEXT,
      parent_id    TEXT,
      read         INTEGER DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      workspace    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_msgs_to ON agent_messages(to_pane);
    CREATE INDEX IF NOT EXISTS idx_agent_msgs_from ON agent_messages(from_pane);
    CREATE INDEX IF NOT EXISTS idx_agent_msgs_workspace ON agent_messages(workspace);
    CREATE INDEX IF NOT EXISTS idx_agent_msgs_created ON agent_messages(created_at);
  `);

  // ── Task Tree (MiMo-inspired hierarchical task system) ────────────────────
  // Supports T1, T1.1, T1.2 tree-structured tasks with event audit trail.
  // Unlike the in-memory todo_manager, this is SQLite-backed and persistent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_tree (
      id            TEXT NOT NULL,
      session_id    TEXT,
      parent_id     TEXT,
      description   TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','in_progress','blocked','done','abandoned')),
      owner         TEXT,
      blocked_by    TEXT,
      workspace     TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at  INTEGER,
      PRIMARY KEY (id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_tree_session ON task_tree(session_id);
    CREATE INDEX IF NOT EXISTS idx_task_tree_status ON task_tree(status);
    CREATE INDEX IF NOT EXISTS idx_task_tree_parent ON task_tree(parent_id);
    CREATE INDEX IF NOT EXISTS idx_task_tree_workspace ON task_tree(workspace);

    CREATE TABLE IF NOT EXISTS task_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      data        TEXT,
      workspace   TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_events_created ON task_events(created_at);
  `);

  // ── FTS5 Full-Text Search (MiMo-inspired) ────────────────────────────────
  // Provides BM25-ranked search over memories, replacing the old LIKE-based search.
  // Content-synced with the memories table via triggers.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        key, content, tags, type, workspace, scope,
        content='memories', content_rowid='rowid',
        tokenize='porter unicode61'
      );

      -- Sync triggers: keep memory_fts in sync with memories table
      CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, key, content, tags, type, workspace, scope)
        VALUES (new.rowid, new.key, new.content, new.tags, new.type, new.workspace, new.scope);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, content, tags, type, workspace, scope)
        VALUES ('delete', old.rowid, old.key, old.content, old.tags, old.type, old.workspace, old.scope);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, key, content, tags, type, workspace, scope)
        VALUES ('delete', old.rowid, old.key, old.content, old.tags, old.type, old.workspace, old.scope);
        INSERT INTO memory_fts(rowid, key, content, tags, type, workspace, scope)
        VALUES (new.rowid, new.key, new.content, new.tags, new.type, new.workspace, new.scope);
      END;
    `);
  } catch (e) {
    // FTS5 not available in this SQLite build — degrade gracefully to LIKE-based search
    if (!String(e.message || e).includes("not supported")) {
      console.warn("[memory] FTS5 setup warning:", e.message);
    }
  }

  // Check if FTS5 is available (used by search() to choose strategy)
  let fts5Available = false;
  try {
    db.prepare("SELECT * FROM memory_fts LIMIT 0").all();
    fts5Available = true;
  } catch { fts5Available = false; }

  // Migration: add scope column if not already present (ALTER TABLE lacks IF NOT EXISTS)
  try {
    db.exec(`ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project','local','user'))`);
  } catch (e) {
    if (!String(e.message).includes("duplicate column")) throw e;
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`);

  // FTS5 rebuild: populate from existing memories on first run (or after upgrade)
  if (fts5Available) {
    try {
      const ftsCount = db.prepare("SELECT COUNT(*) as c FROM memory_fts").get();
      const memCount = db.prepare("SELECT COUNT(*) as c FROM memories").get();
      if (ftsCount.c < memCount.c) {
        db.exec(`INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`);
      }
    } catch {}
  }

  // ── FTS5 Query Builder (from MiMo-Code) ────────────────────────────────────
  // Converts free-form user queries into safe FTS5 MATCH expressions.
  // Uses OR-join (not AND) for better recall on multi-word queries.
  // Unicode regex includes CJK letters for international recall.
  function buildFtsQuery(raw) {
    const tokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map(t => t.trim()).filter(Boolean) ?? [];
    if (tokens.length === 0) return null;
    return tokens.map(t => `"${t.replaceAll('"', '')}"`).join(' OR ');
  }

  // ── Kanban Tasks Table ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT DEFAULT '',
      column_name  TEXT NOT NULL DEFAULT 'inbox' CHECK(column_name IN ('inbox','assigned','in_progress','review','done')),
      assigned_to  TEXT,
      priority     TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
      result       TEXT,
      workspace    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_kanban_column ON kanban_tasks(column_name);
    CREATE INDEX IF NOT EXISTS idx_kanban_assigned ON kanban_tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_kanban_workspace ON kanban_tasks(workspace);
  `);

  // ── Missions Table ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      summary      TEXT DEFAULT '',
      worktreePath TEXT,
      status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','abandoned')),
      workspace    TEXT,
      metadata     TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
    CREATE INDEX IF NOT EXISTS idx_missions_workspace ON missions(workspace);
  `);

  // ── Notifications Table ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      level       TEXT NOT NULL DEFAULT 'info',
      mr_id       INTEGER,
      mr_url      TEXT,
      provider    TEXT,
      read        INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
    CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
  `);

  // ── Reviewed MRs Table (auto-review tracking) ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviewed_mrs (
      id            TEXT PRIMARY KEY,
      workspace     TEXT NOT NULL,
      mr_id         INTEGER NOT NULL,
      mr_url        TEXT,
      provider      TEXT,
      mr_title      TEXT,
      mr_updated_at TEXT,
      reviewed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(workspace, mr_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reviewed_mrs_workspace ON reviewed_mrs(workspace);
    CREATE INDEX IF NOT EXISTS idx_reviewed_mrs_reviewed ON reviewed_mrs(reviewed_at DESC);
  `);

  // Migration: ensure agents.pane_id has UNIQUE constraint (table may pre-exist without it)
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_pane_unique ON agents(pane_id)`);
  } catch (e) {
    // If pane_id column doesn't exist yet, the table was just created with UNIQUE — fine
    if (!String(e.message).includes("no such table")) throw e;
  }

  // ── Actor Registry (MiMo-inspired — persistent pane/worker state) ─────────
  // Tracks every spawned pane with status, hierarchy, turn count, and stuck detection.
  // Unlike the in-memory paneConfigs Map, this survives restarts and allows cancel cascade.
  db.exec(`
    CREATE TABLE IF NOT EXISTS actor_registry (
      pane_id         TEXT PRIMARY KEY,
      parent_pane_id  TEXT,
      agent           TEXT,
      label           TEXT,
      description     TEXT,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','running','idle','cancelled','stuck')),
      last_outcome    TEXT CHECK(last_outcome IN ('success','partial','failed','blocked','cancelled') OR last_outcome IS NULL),
      turn_count      INTEGER NOT NULL DEFAULT 0,
      last_turn_time  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_error      TEXT,
      workspace       TEXT,
      cwd             TEXT,
      provider_id     TEXT,
      model           TEXT,
      time_created    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      time_updated    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      time_completed  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_actor_status ON actor_registry(status);
    CREATE INDEX IF NOT EXISTS idx_actor_parent ON actor_registry(parent_pane_id);
    CREATE INDEX IF NOT EXISTS idx_actor_workspace ON actor_registry(workspace);
    CREATE INDEX IF NOT EXISTS idx_actor_last_turn ON actor_registry(last_turn_time);
  `);

  // Orphan recovery: on store init, mark all pending/running as failed (process restarted)
  try {
    const now = Date.now();
    db.prepare(`
      UPDATE actor_registry
      SET status = 'idle', last_outcome = 'failed',
          last_error = 'orphaned: process restarted',
          time_updated = ?, time_completed = ?
      WHERE status IN ('pending', 'running')
    `).run(now, now);
  } catch {}

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
    // Session history
    insertSessionHistory: db.prepare(`
      INSERT INTO session_history (id, pane_id, label, agent, model, provider_id, workspace, started_at, ended_at, duration_ms, exit_code, output_preview)
      VALUES (@id, @pane_id, @label, @agent, @model, @provider_id, @workspace, @started_at, @ended_at, @duration_ms, @exit_code, @output_preview)
    `),
    listSessionHistory: db.prepare(`
      SELECT * FROM session_history
      WHERE (@workspace IS NULL OR workspace = @workspace)
      ORDER BY ended_at DESC LIMIT @limit OFFSET @offset
    `),
    getSessionHistory: db.prepare(`SELECT * FROM session_history WHERE id = ?`),
    deleteSessionHistory: db.prepare(`DELETE FROM session_history WHERE id = ?`),
    clearSessionHistory: db.prepare(`DELETE FROM session_history WHERE (@workspace IS NULL OR workspace = @workspace)`),
    // Handoffs
    insertHandoff: db.prepare(`
      INSERT OR REPLACE INTO handoffs (id, pane_id, summary, status, artifacts, submitted_at, workspace)
      VALUES (@id, @pane_id, @summary, @status, @artifacts, @submitted_at, @workspace)
    `),
    getHandoffByPane: db.prepare(`SELECT * FROM handoffs WHERE pane_id = ? ORDER BY submitted_at DESC LIMIT 1`),
    listHandoffs: db.prepare(`
      SELECT * FROM handoffs
      WHERE (@workspace IS NULL OR workspace = @workspace)
      ORDER BY submitted_at DESC LIMIT @limit
    `),
    clearHandoffs: db.prepare(`DELETE FROM handoffs WHERE (@workspace IS NULL OR workspace = @workspace)`),
    // Agents
    upsertAgent: db.prepare(`
      INSERT INTO agents (id, pane_id, label, role, model, provider_id, status, spawned_at, workspace)
      VALUES (@id, @pane_id, @label, @role, @model, @provider_id, @status, @spawned_at, @workspace)
      ON CONFLICT(pane_id) DO UPDATE SET
        label = excluded.label, role = excluded.role, model = excluded.model,
        provider_id = excluded.provider_id, status = excluded.status
    `),
    updateAgentStatus: db.prepare(`UPDATE agents SET status = ?, exited_at = ? WHERE pane_id = ?`),
    listAgents: db.prepare(`
      SELECT * FROM agents
      WHERE (@workspace IS NULL OR workspace = @workspace)
      ORDER BY spawned_at DESC LIMIT @limit
    `),
    getAgentByPane: db.prepare(`SELECT * FROM agents WHERE pane_id = ?`),
    // Agent Messages
    insertAgentMessage: db.prepare(`
      INSERT INTO agent_messages (id, from_pane, to_pane, content, type, task_id, parent_id, workspace)
      VALUES (@id, @from_pane, @to_pane, @content, @type, @task_id, @parent_id, @workspace)
    `),
    getAgentMessages: db.prepare(`
      SELECT * FROM agent_messages
      WHERE to_pane = @to_pane
        AND (@workspace IS NULL OR workspace = @workspace)
        AND (@unread_only = 0 OR read = 0)
      ORDER BY created_at DESC LIMIT @limit
    `),
    markMessageRead: db.prepare(`UPDATE agent_messages SET read = 1 WHERE id = ?`),
    // Notifications
    insertNotification: db.prepare(`
      INSERT INTO notifications (id, type, title, body, level, mr_id, mr_url, provider, read)
      VALUES (@id, @type, @title, @body, @level, @mr_id, @mr_url, @provider, 0)
    `),
    listNotifications: db.prepare(`
      SELECT * FROM notifications ORDER BY created_at DESC LIMIT @limit
    `),
    unreadNotificationCount: db.prepare(`SELECT COUNT(*) as count FROM notifications WHERE read = 0`),
    markNotificationRead: db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`),
    markAllNotificationsRead: db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`),
    deleteNotification: db.prepare(`DELETE FROM notifications WHERE id = ?`),
    clearNotifications: db.prepare(`DELETE FROM notifications`),
    // Reviewed MRs
    insertReviewedMr: db.prepare(`
      INSERT INTO reviewed_mrs (id, workspace, mr_id, mr_url, provider, mr_title, mr_updated_at)
      VALUES (@id, @workspace, @mr_id, @mr_url, @provider, @mr_title, @mr_updated_at)
      ON CONFLICT(workspace, mr_id) DO UPDATE SET
        mr_updated_at = excluded.mr_updated_at,
        mr_title = excluded.mr_title,
        reviewed_at = unixepoch()
    `),
    isMrReviewed: db.prepare(`SELECT mr_updated_at, reviewed_at FROM reviewed_mrs WHERE workspace = ? AND mr_id = ?`),
    listReviewedMrs: db.prepare(`SELECT * FROM reviewed_mrs WHERE workspace = ? ORDER BY reviewed_at DESC LIMIT ?`),
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
  function genHandoffId() {
    return `hoff_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  function genAgentId() {
    return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
     * Uses FTS5 with BM25 ranking when available, falls back to LIKE-based search.
     * Relative floor filtering: drops results below 15% of top BM25 score.
     * When scope is NOT specified, searches across all scopes.
     * @param {{ query: string, type?: string, workspace?: string, limit?: number, scope?: 'project'|'local'|'user' }} opts
     */
    search({ query, type, workspace, limit = 20, scope }) {
      if (!query) return { ok: false, error: "query is required" };

      let results;

      if (fts5Available) {
        // ── FTS5 + BM25 ranking (MiMo-inspired) ──────────────────────────
        const ftsQuery = buildFtsQuery(query);
        if (!ftsQuery) return { ok: true, memories: [], count: 0 };

        const FLOOR_RATIO = 0.15; // Relative floor: keep results within 15% of top score
        const fetchLimit = Math.min(limit * 3, 60); // Over-fetch 3x for floor filtering

        try {
          // Build dynamic WHERE clause for optional filters
          const conditions = [];
          const params = [ftsQuery];
          if (type) { conditions.push("m.type = ?"); params.push(type); }
          if (workspace) { conditions.push("m.workspace = ?"); params.push(workspace); }
          if (scope) { conditions.push("m.scope = ?"); params.push(scope); }
          const whereClause = conditions.length > 0 ? "AND " + conditions.join(" AND ") : "";

          params.push(fetchLimit);
          const rows = db.prepare(`
            SELECT m.*, snippet(memory_fts, 1, '<<', '>>', '...', 32) AS _snippet,
                   bm25(memory_fts) AS _bm25_score
            FROM memory_fts
            JOIN memories m ON m.rowid = memory_fts.rowid
            WHERE memory_fts MATCH ?
            ${whereClause}
            ORDER BY bm25(memory_fts)
            LIMIT ?
          `).all(...params);

          if (rows.length > 0) {
            // BM25: lower = better. Negate so higher = better for caller.
            const mapped = rows.map(r => ({
              ...r,
              tags: JSON.parse(r.tags || "[]"),
              _score: -r._bm25_score,
              _snippet: r._snippet,
            }));

            // Relative floor: keep only results within 15% of top score
            const topScore = mapped[0]._score;
            const cutoff = topScore * FLOOR_RATIO;
            results = mapped
              .filter((r, i) => i === 0 || r._score >= cutoff)
              .slice(0, limit);
          } else {
            results = [];
          }
        } catch (e) {
          // FTS5 query failed (e.g., syntax error in query) — fall back to LIKE
          console.warn("[memory] FTS5 search failed, falling back to LIKE:", e.message);
          results = null; // Signal to use LIKE fallback
        }
      }

      // ── LIKE-based fallback (original behavior) ──────────────────────────
      if (!results) {
        const likeQuery = `%${query}%`;
        const rows = stmts.searchKeyword.all({
          query: likeQuery,
          type: type || null,
          workspace: workspace || null,
          limit,
          scope: scope || null,
        });
        results = rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") }));

        // Graph-aware ranking: combinedScore = 0.7 * textScore + 0.3 * pageRank
        if (knowledgeGraph && results.length > 1) {
          try {
            const ranks = knowledgeGraph.pageRank();
            if (ranks && ranks.size > 0) {
              let maxRank = 0;
              for (const [, score] of ranks) {
                if (score > maxRank) maxRank = score;
              }
              if (maxRank > 0) {
                results = results.map((r, i) => {
                  const textScore = 1 - (i / results.length);
                  const pageRank = (ranks.get(r.id) || 0) / maxRank;
                  const combinedScore = 0.7 * textScore + 0.3 * pageRank;
                  return { ...r, _combinedScore: Math.round(combinedScore * 1000) / 1000 };
                });
                results.sort((a, b) => (b._combinedScore || 0) - (a._combinedScore || 0));
              }
            }
          } catch {}
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

    // ── Session History ─────────────────────────────────────────────────────

    /**
     * Save a session history entry.
     */
    saveSessionHistory({ pane_id, label, agent, model, provider_id, workspace, started_at, ended_at, duration_ms, exit_code, output_preview }) {
      const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      stmts.insertSessionHistory.run({
        id,
        pane_id: pane_id || null,
        label: label || null,
        agent: agent || null,
        model: model || null,
        provider_id: provider_id || null,
        workspace: workspace || null,
        started_at: started_at || null,
        ended_at: ended_at || Date.now(),
        duration_ms: duration_ms || null,
        exit_code: exit_code !== undefined ? exit_code : null,
        output_preview: output_preview || null,
      });
      return { ok: true, id };
    },

    /**
     * List session history entries.
     */
    listSessionHistory({ workspace, limit = 50, offset = 0 } = {}) {
      const rows = stmts.listSessionHistory.all({
        workspace: workspace || null,
        limit,
        offset,
      });
      return { ok: true, sessions: rows, count: rows.length };
    },

    /**
     * Get a single session history entry.
     */
    getSessionHistory({ id }) {
      const row = stmts.getSessionHistory.get(id);
      if (!row) return { ok: false, error: "not found" };
      return { ok: true, session: row };
    },

    /**
     * Delete a session history entry.
     */
    deleteSessionHistory({ id }) {
      stmts.deleteSessionHistory.run(id);
      return { ok: true };
    },

    /**
     * Clear session history.
     */
    clearSessionHistory({ workspace } = {}) {
      stmts.clearSessionHistory.run({ workspace: workspace || null });
      return { ok: true };
    },

    // ── Handoff Pattern ─────────────────────────────────────────────────────

    /**
     * Submit a handoff result from a worker pane.
     * @param {{ paneId: string, summary: string, status: string, artifacts?: string[], workspace?: string }} opts
     */
    submitHandoff({ paneId, summary, status, artifacts, workspace }) {
      if (!paneId || !summary || !status) return { ok: false, error: "paneId, summary, and status are required" };
      if (!["done", "blocked", "error"].includes(status)) return { ok: false, error: "status must be done|blocked|error" };
      const id = genHandoffId();
      stmts.insertHandoff.run({
        id,
        pane_id: paneId,
        summary,
        status,
        artifacts: JSON.stringify(artifacts || []),
        submitted_at: Date.now(),
        workspace: workspace || null,
      });
      return { ok: true, id };
    },

    /**
     * Get the latest handoff for a pane.
     * @param {{ paneId: string }} opts
     */
    getHandoff({ paneId }) {
      if (!paneId) return { ok: false, error: "paneId is required" };
      const row = stmts.getHandoffByPane.get(paneId);
      if (!row) return { ok: false, error: "no handoff found" };
      return { ok: true, handoff: { ...row, artifacts: JSON.parse(row.artifacts || "[]") } };
    },

    /**
     * List handoffs, optionally filtered by workspace.
     * @param {{ workspace?: string, limit?: number, paneIds?: string[] }} opts
     */
    listHandoffs({ workspace, limit = 50, paneIds } = {}) {
      let rows;
      if (paneIds && paneIds.length > 0) {
        // Get latest handoff for each requested paneId
        rows = [];
        for (const pid of paneIds) {
          const row = stmts.getHandoffByPane.get(pid);
          if (row) rows.push(row);
        }
      } else {
        rows = stmts.listHandoffs.all({ workspace: workspace || null, limit });
      }
      return {
        ok: true,
        handoffs: rows.map(r => ({ ...r, artifacts: JSON.parse(r.artifacts || "[]") })),
        count: rows.length,
      };
    },

    /**
     * Clear handoffs for a workspace (or all).
     * @param {{ workspace?: string }} opts
     */
    clearHandoffs({ workspace } = {}) {
      stmts.clearHandoffs.run({ workspace: workspace || null });
      return { ok: true };
    },

    // ── Agent Registry ───────────────────────────────────────────────────────

    /**
     * Upsert an agent record (insert or update on pane_id conflict).
     * @param {{ paneId: string, label?: string, role?: string, model?: string, providerId?: string, status?: string, workspace?: string }} opts
     */
    upsertAgent({ paneId, label, role, model, providerId, status = "active", workspace }) {
      if (!paneId) return { ok: false, error: "paneId is required" };
      stmts.upsertAgent.run({
        id: genAgentId(),
        pane_id: paneId,
        label: label || null,
        role: role || "worker",
        model: model || null,
        provider_id: providerId || null,
        status,
        spawned_at: Date.now(),
        workspace: workspace || null,
      });
      return { ok: true };
    },

    /**
     * Update an agent's status (e.g. 'exited', 'active', 'busy').
     * @param {{ paneId: string, status: string }} opts
     */
    updateAgentStatus({ paneId, status }) {
      if (!paneId || !status) return { ok: false, error: "paneId and status are required" };
      const exitedAt = status === "exited" ? Date.now() : null;
      stmts.updateAgentStatus.run(status, exitedAt, paneId);
      return { ok: true };
    },

    /**
     * List agents, optionally filtered by workspace.
     * @param {{ workspace?: string, limit?: number }} opts
     */
    listAgents({ workspace, limit = 50 } = {}) {
      const rows = stmts.listAgents.all({ workspace: workspace || null, limit });
      return { ok: true, agents: rows, count: rows.length };
    },

    /**
     * Get an agent by pane ID.
     * @param {{ paneId: string }} opts
     */
    getAgent({ paneId }) {
      if (!paneId) return { ok: false, error: "paneId is required" };
      const row = stmts.getAgentByPane.get(paneId);
      if (!row) return { ok: false, error: "not found" };
      return { ok: true, agent: row };
    },

    // ── Agent Messages ───────────────────────────────────────────────────────

    /**
     * Save an agent message to the database.
     * @param {{ fromPane: string, toPane: string, content: string, type?: string, taskId?: string, parentId?: string, workspace?: string }} opts
     */
    saveAgentMessage({ fromPane, toPane, content, type, taskId, parentId, workspace }) {
      if (!fromPane || !toPane || !content) return { ok: false, error: "fromPane, toPane, and content are required" };
      const id = `amsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      stmts.insertAgentMessage.run({
        id,
        from_pane: fromPane,
        to_pane: toPane,
        content,
        type: type || "update",
        task_id: taskId || null,
        parent_id: parentId || null,
        workspace: workspace || null,
      });
      return { ok: true, id };
    },

    /**
     * Get messages for a pane.
     * @param {{ paneId: string, unreadOnly?: boolean, workspace?: string, limit?: number }} opts
     */
    getAgentMessages({ paneId, unreadOnly = false, workspace, limit = 50 } = {}) {
      if (!paneId) return { ok: false, error: "paneId is required" };
      const rows = stmts.getAgentMessages.all({
        to_pane: paneId,
        workspace: workspace || null,
        unread_only: unreadOnly ? 1 : 0,
        limit,
      });
      return { ok: true, messages: rows, count: rows.length };
    },

    /**
     * Mark a message as read.
     * @param {{ id: string }} opts
     */
    markMessageRead({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      stmts.markMessageRead.run(id);
      return { ok: true };
    },

    // ── Kanban Tasks ─────────────────────────────────────────────────────────

    /**
     * Create a kanban task.
     * @param {{ title: string, description?: string, column?: string, priority?: string, assigned_to?: string, workspace?: string }} opts
     */
    createKanbanTask({ title, description = "", column = "inbox", priority = "normal", assigned_to, workspace }) {
      if (!title) return { ok: false, error: "title is required" };
      const validColumns = ["inbox", "assigned", "in_progress", "review", "done"];
      if (!validColumns.includes(column)) return { ok: false, error: `column must be one of: ${validColumns.join(", ")}` };
      const id = `ktask_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      db.prepare(`
        INSERT INTO kanban_tasks (id, title, description, column_name, priority, assigned_to, workspace)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, description, column, priority, assigned_to || null, workspace || null);
      return { ok: true, id, column };
    },

    /**
     * Move a kanban task to a different column.
     * @param {{ id: string, column: string }} opts
     */
    moveKanbanTask({ id, column }) {
      if (!id || !column) return { ok: false, error: "id and column are required" };
      const validColumns = ["inbox", "assigned", "in_progress", "review", "done"];
      if (!validColumns.includes(column)) return { ok: false, error: `column must be one of: ${validColumns.join(", ")}` };
      const completedAt = column === "done" ? Math.floor(Date.now() / 1000) : null;
      const result = db.prepare(
        `UPDATE kanban_tasks SET column_name = ?, updated_at = unixepoch(), completed_at = ? WHERE id = ?`
      ).run(column, completedAt, id);
      if (result.changes === 0) return { ok: false, error: "task not found" };
      return { ok: true, column };
    },

    /**
     * List kanban tasks with optional filters.
     * @param {{ column?: string, assigned_to?: string, workspace?: string, limit?: number }} opts
     */
    listKanbanTasks({ column, assigned_to, workspace, limit = 50 } = {}) {
      let query = "SELECT * FROM kanban_tasks WHERE 1=1";
      const params = [];
      if (column) { query += " AND column_name = ?"; params.push(column); }
      if (assigned_to) { query += " AND assigned_to = ?"; params.push(assigned_to); }
      if (workspace) { query += " AND workspace = ?"; params.push(workspace); }
      query += " ORDER BY updated_at DESC LIMIT ?";
      params.push(limit);
      const rows = db.prepare(query).all(...params);
      return { ok: true, tasks: rows, count: rows.length };
    },

    /**
     * Complete a kanban task with optional result.
     * @param {{ id: string, result?: string }} opts
     */
    completeKanbanTask({ id, result: taskResult }) {
      if (!id) return { ok: false, error: "id is required" };
      const res = db.prepare(
        `UPDATE kanban_tasks SET column_name = 'done', result = ?, updated_at = unixepoch(), completed_at = unixepoch() WHERE id = ?`
      ).run(taskResult || null, id);
      if (res.changes === 0) return { ok: false, error: "task not found" };
      return { ok: true, column: "done" };
    },

    /**
     * Assign a kanban task to a pane/agent.
     * @param {{ id: string, paneId: string }} opts
     */
    assignKanbanTask({ id, paneId }) {
      if (!id || !paneId) return { ok: false, error: "id and paneId are required" };
      const res = db.prepare(
        `UPDATE kanban_tasks SET assigned_to = ?, column_name = 'assigned', updated_at = unixepoch() WHERE id = ?`
      ).run(paneId, id);
      if (res.changes === 0) return { ok: false, error: "task not found" };
      return { ok: true, assigned_to: paneId };
    },

    /**
     * Delete a kanban task.
     * @param {{ id: string }} opts
     */
    deleteKanbanTask({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      const res = db.prepare("DELETE FROM kanban_tasks WHERE id = ?").run(id);
      return { ok: true, deleted: res.changes > 0 };
    },

    // ── Mission Methods ───────────────────────────────────────────────────

    /**
     * Create a mission.
     * @param {{ title: string, summary?: string, worktreePath?: string, workspace?: string }} opts
     */
    createMission({ title, summary = "", worktreePath, workspace }) {
      if (!title) return { ok: false, error: "title is required" };
      const id = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      db.prepare(`
        INSERT INTO missions (id, title, summary, worktreePath, workspace)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, title, summary, worktreePath || null, workspace || null);
      return { ok: true, id };
    },

    /**
     * Get a mission by ID.
     * @param {{ id: string }} opts
     */
    getMission({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      const row = db.prepare("SELECT * FROM missions WHERE id = ?").get(id);
      if (!row) return { ok: false, error: "mission not found" };
      return { ok: true, mission: row };
    },

    /**
     * List missions with optional filters.
     * @param {{ status?: string, workspace?: string, limit?: number }} opts
     */
    listMissions({ status, workspace, limit = 50 } = {}) {
      let query = "SELECT * FROM missions WHERE 1=1";
      const params = [];
      if (status) { query += " AND status = ?"; params.push(status); }
      if (workspace) { query += " AND workspace = ?"; params.push(workspace); }
      query += " ORDER BY updated_at DESC LIMIT ?";
      params.push(limit);
      const rows = db.prepare(query).all(...params);
      return { ok: true, missions: rows, count: rows.length };
    },

    /**
     * Update a mission.
     * @param {{ id: string, updates: { title?: string, summary?: string, worktreePath?: string, status?: string, metadata?: string } }} opts
     */
    updateMission({ id, updates }) {
      if (!id) return { ok: false, error: "id is required" };
      if (!updates || Object.keys(updates).length === 0) return { ok: false, error: "updates required" };
      const validStatuses = ["active", "paused", "completed", "abandoned"];
      if (updates.status && !validStatuses.includes(updates.status)) {
        return { ok: false, error: `status must be one of: ${validStatuses.join(", ")}` };
      }
      const sets = [];
      const params = [];
      for (const [key, val] of Object.entries(updates)) {
        if (["title", "summary", "worktreePath", "status", "metadata"].includes(key)) {
          sets.push(`${key === "worktreePath" ? "worktreePath" : key} = ?`);
          params.push(val);
        }
      }
      if (sets.length === 0) return { ok: false, error: "no valid fields to update" };
      sets.push("updated_at = unixepoch()");
      params.push(id);
      const result = db.prepare(`UPDATE missions SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      if (result.changes === 0) return { ok: false, error: "mission not found" };
      return { ok: true };
    },

    /**
     * Delete a mission.
     * @param {{ id: string }} opts
     */
    deleteMission({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      const res = db.prepare("DELETE FROM missions WHERE id = ?").run(id);
      return { ok: true, deleted: res.changes > 0 };
    },

    // ── Notifications ─────────────────────────────────────────────────────────

    /**
     * Create a new notification.
     * @param {{ type: string, title: string, body?: string, level?: string, mr_id?: number, mr_url?: string, provider?: string }} opts
     * @returns {{ ok: boolean, id: string }}
     */
    createNotification({ type, title, body, level, mr_id, mr_url, provider }) {
      if (!type || !title) return { ok: false, error: "type and title are required" };
      const id = genId();
      stmts.insertNotification.run({
        id, type, title, body: body || null, level: level || "info",
        mr_id: mr_id || null, mr_url: mr_url || null, provider: provider || null,
      });
      return { ok: true, id };
    },

    /**
     * List notifications, most recent first.
     * @param {{ limit?: number }} opts
     */
    listNotifications({ limit = 50 } = {}) {
      const rows = stmts.listNotifications.all({ limit });
      return { ok: true, notifications: rows, count: rows.length };
    },

    /**
     * Get unread notification count.
     */
    unreadNotificationCount() {
      const row = stmts.unreadNotificationCount.get();
      return { ok: true, count: row ? row.count : 0 };
    },

    /**
     * Mark a notification as read.
     * @param {{ id: string }} opts
     */
    markNotificationRead({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      stmts.markNotificationRead.run(id);
      return { ok: true };
    },

    /**
     * Mark all notifications as read.
     */
    markAllNotificationsRead() {
      stmts.markAllNotificationsRead.run();
      return { ok: true };
    },

    /**
     * Delete a notification.
     * @param {{ id: string }} opts
     */
    deleteNotification({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      stmts.deleteNotification.run(id);
      return { ok: true };
    },

    /**
     * Clear all notifications.
     */
    clearNotifications() {
      stmts.clearNotifications.run();
      return { ok: true };
    },

    // ── Reviewed MRs (auto-review tracking) ──────────────────────────────

    /**
     * Record that an MR was reviewed.
     */
    recordReviewedMr({ workspace, mr_id, mr_url, provider, mr_title, mr_updated_at }) {
      if (!workspace || !mr_id) return { ok: false, error: "workspace and mr_id are required" };
      const id = genId();
      stmts.insertReviewedMr.run({
        id, workspace, mr_id, mr_url: mr_url || null,
        provider: provider || null, mr_title: mr_title || null,
        mr_updated_at: mr_updated_at || null,
      });
      return { ok: true, id };
    },

    /**
     * Check if an MR has already been reviewed in a workspace.
     */
    isMrReviewed({ workspace, mr_id }) {
      const row = stmts.isMrReviewed.get(workspace, mr_id);
      return { ok: true, reviewed: !!row, mr_updated_at: row?.mr_updated_at || null };
    },

    /**
     * List reviewed MRs for a workspace.
     */
    listReviewedMrs({ workspace, limit = 50 } = {}) {
      const rows = stmts.listReviewedMrs.all(workspace, limit);
      return { ok: true, mrs: rows };
    },

    /**
     * Get the raw better-sqlite3 Database instance.
     * Used by services that need direct SQL access (e.g., OAuth token storage).
     */
    get db() { return db; },

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

    // ── Actor Registry API (MiMo-inspired) ────────────────────────────────────

    /**
     * Register a pane in the actor registry. Called on pane spawn.
     */
    actorRegister({ paneId, parentPaneId, agent, label, description, workspace, cwd, providerId, model }) {
      try {
        const now = Date.now();
        db.prepare(`
          INSERT OR REPLACE INTO actor_registry
            (pane_id, parent_pane_id, agent, label, description, status, workspace, cwd, provider_id, model, time_created, time_updated, last_turn_time)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
        `).run(paneId, parentPaneId || null, agent || null, label || null, description || null,
               workspace || null, cwd || null, providerId || null, model || null, now, now, now);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Update actor status. Called on pane state changes.
     */
    actorUpdateStatus({ paneId, status, lastOutcome, lastError }) {
      try {
        const now = Date.now();
        const isTerminal = status === 'idle' && lastOutcome !== undefined;
        db.prepare(`
          UPDATE actor_registry
          SET status = ?, last_outcome = ?, last_error = ?,
              time_updated = ?, time_completed = ?
          WHERE pane_id = ?
        `).run(status, lastOutcome || null, lastError || null,
               now, isTerminal ? now : null, paneId);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Increment turn count + update last_turn_time. Called when pane produces output.
     */
    actorUpdateTurn({ paneId }) {
      try {
        const now = Date.now();
        db.prepare(`
          UPDATE actor_registry
          SET turn_count = turn_count + 1, last_turn_time = ?, status = 'running', time_updated = ?
          WHERE pane_id = ?
        `).run(now, now, paneId);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Get a single actor by paneId.
     */
    actorGet({ paneId }) {
      try {
        const row = db.prepare(`SELECT * FROM actor_registry WHERE pane_id = ?`).get(paneId);
        return { ok: true, actor: row || null };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * List actors. Optionally filter by workspace, status, or parentPaneId.
     */
    actorList({ workspace, status, parentPaneId, includeTerminal = false } = {}) {
      try {
        const conds = [];
        const params = [];
        if (workspace) { conds.push('workspace = ?'); params.push(workspace); }
        if (status) { conds.push('status = ?'); params.push(status); }
        if (parentPaneId !== undefined) { conds.push('parent_pane_id = ?'); params.push(parentPaneId || null); }
        if (!includeTerminal) {
          conds.push("(status != 'idle' OR last_outcome IS NULL)");
        }
        const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
        const rows = db.prepare(`SELECT * FROM actor_registry ${where} ORDER BY time_created DESC`).all(...params);
        return { ok: true, actors: rows };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Get children of a given pane (for cancel cascade).
     */
    actorListChildren({ parentPaneId }) {
      try {
        const rows = db.prepare(`SELECT * FROM actor_registry WHERE parent_pane_id = ?`).all(parentPaneId);
        return { ok: true, actors: rows };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Detect stuck actors (running but no turn for > thresholdMs).
     */
    actorDetectStuck({ thresholdMs = 5 * 60 * 1000 } = {}) {
      try {
        const cutoff = Date.now() - thresholdMs;
        const rows = db.prepare(`
          SELECT * FROM actor_registry
          WHERE status = 'running' AND last_turn_time <= ?
        `).all(cutoff);
        return { ok: true, stuck: rows };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Render a summary of active actors for agent system prompt injection.
     */
    actorRenderForAgent({ workspace } = {}) {
      try {
        const params = workspace ? [workspace] : [];
        const where = workspace ? "WHERE workspace = ? AND status IN ('pending','running')" : "WHERE status IN ('pending','running')";
        const rows = db.prepare(`SELECT * FROM actor_registry ${where} ORDER BY time_created DESC`).all(...params);
        if (rows.length === 0) return { ok: true, text: '' };
        const now = Date.now();
        const lines = ['## Active Workers'];
        lines.push('');
        lines.push(`You have ${rows.length} active worker(s) in this session.`);
        lines.push('');
        for (const r of rows) {
          const idleMs = now - r.last_turn_time;
          const idleStr = idleMs < 60000 ? `${Math.floor(idleMs/1000)}s` : `${Math.floor(idleMs/60000)}m`;
          const parentInfo = r.parent_pane_id ? ` (child of ${r.parent_pane_id.slice(0,8)})` : '';
          lines.push(`- pane_id: ${r.pane_id} — ${r.label || r.agent || 'worker'} [${r.status}, last activity ${idleStr} ago]${parentInfo}`);
          if (r.description) lines.push(`  task: ${r.description}`);
        }
        return { ok: true, text: lines.join('\n') };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ── Stuck Detection Scanner (MiMo-inspired) ─────────────────────────────
    // Periodically scans for actors stuck in 'running' state with no recent turns.
    // Threshold: 5 minutes (configurable). Marks stuck actors and fires callback.
    _stuckScanner: null,
    _onStuckDetected: null,

    /**
     * Start the stuck detection scanner. Runs every intervalMs.
     * @param {number} intervalMs - Scan interval (default: 60000 = 60s)
     * @param {function} onStuck - Callback when stuck actors found: (stuckActors) => void
     */
    actorStartStuckScanner(intervalMs = 60000, onStuck = null) {
      const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      if (this._stuckScanner) clearInterval(this._stuckScanner);
      this._onStuckDetected = onStuck;
      this._stuckScanner = setInterval(() => {
        try {
          const cutoff = Date.now() - STUCK_THRESHOLD_MS;
          const stuckActors = db.prepare(`
            SELECT * FROM actor_registry
            WHERE status = 'running' AND last_turn_time <= ?
          `).all(cutoff);

          for (const actor of stuckActors) {
            const stuckDuration = Date.now() - actor.last_turn_time;
            const stuckSec = Math.floor(stuckDuration / 1000);
            db.prepare(`
              UPDATE actor_registry
              SET status = 'stuck', last_error = ?, time_updated = ?
              WHERE pane_id = ?
            `).run(`stuck: no activity for ${stuckSec}s`, Date.now(), actor.pane_id);
          }

          if (stuckActors.length > 0 && this._onStuckDetected) {
            this._onStuckDetected(stuckActors.map(a => ({
              ...a,
              stuckDuration: Date.now() - a.last_turn_time,
            })));
          }
        } catch (e) {
          // Scanner errors should never crash the app
        }
      }, intervalMs);
    },

    /**
     * Stop the stuck detection scanner.
     */
    actorStopStuckScanner() {
      if (this._stuckScanner) {
        clearInterval(this._stuckScanner);
        this._stuckScanner = null;
      }
    },

    // ── Repeated-Step Detection (MiMo-inspired) ──────────────────────────────
    // Tracks tool call signatures per pane. If 3 consecutive identical signatures
    // are detected, the agent is considered to be in a loop.
    _stepHistory: new Map(), // paneId → [{signature, timestamp}]

    /**
     * Record a tool call step and check for repeated patterns.
     * @param {{ paneId: string, toolName: string, toolInput: any }} opts
     * @returns {{ isLooping: boolean, signature?: string, count?: number }}
     */
    recordStep({ paneId, toolName, toolInput }) {
      if (!paneId || !toolName) return { isLooping: false };

      // Stable stringify with sorted keys for deterministic comparison
      function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        const keys = Object.keys(value).sort();
        return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
      }

      const sig = `tool:${toolName}:${stableStringify(toolInput || {})}`;
      const history = this._stepHistory.get(paneId) || [];
      history.push({ signature: sig, timestamp: Date.now() });
      if (history.length > 10) history.shift(); // Keep last 10 steps
      this._stepHistory.set(paneId, history);

      // Check for 3 consecutive identical signatures
      const REPEATED_THRESHOLD = 3;
      const recent = history.slice(-REPEATED_THRESHOLD);
      if (recent.length === REPEATED_THRESHOLD && recent.every(s => s.signature === recent[0].signature)) {
        return { isLooping: true, signature: toolName, count: REPEATED_THRESHOLD };
      }
      return { isLooping: false };
    },

    /**
     * Clear step history for a pane (called when pane exits).
     * @param {{ paneId: string }} opts
     */
    clearStepHistory({ paneId }) {
      if (paneId) this._stepHistory.delete(paneId);
    },

    // ── Task Tree CRUD (MiMo-inspired) ───────────────────────────────────────

    /**
     * Create a task in the tree. IDs follow hierarchical pattern: T1, T1.1, T1.2.
     * @param {{ id: string, description: string, parentId?: string, sessionId?: string, owner?: string, workspace?: string }} opts
     */
    taskTreeCreate({ id, description, parentId, sessionId, owner, workspace }) {
      if (!id || !description) return { ok: false, error: "id and description are required" };
      // Validate ID format: T followed by digits, optionally dot-separated
      if (!/^T\d+(\.\d+)*$/.test(id)) return { ok: false, error: "id must match pattern T1, T1.1, T1.2, etc." };
      // Validate parent exists if specified
      if (parentId) {
        const parent = db.prepare("SELECT id FROM task_tree WHERE id = ?").get(parentId);
        if (!parent) return { ok: false, error: `parent task ${parentId} not found` };
      }
      try {
        const now = Math.floor(Date.now() / 1000);
        db.prepare(`
          INSERT INTO task_tree (id, description, parent_id, session_id, owner, workspace, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, description, parentId || null, sessionId || null, owner || null, workspace || null, now, now);
        // Log event
        this._logTaskEvent(id, "created", { description, parentId, owner }, workspace);
        return { ok: true, id };
      } catch (e) {
        if (String(e.message).includes("UNIQUE")) return { ok: false, error: `task ${id} already exists` };
        return { ok: false, error: e.message };
      }
    },

    /**
     * Update task status with terminal state protection.
     * @param {{ id: string, status: string, owner?: string, workspace?: string }} opts
     */
    taskTreeUpdate({ id, status, owner, workspace }) {
      if (!id || !status) return { ok: false, error: "id and status are required" };
      const validStatuses = ["open", "in_progress", "blocked", "done", "abandoned"];
      if (!validStatuses.includes(status)) return { ok: false, error: `status must be one of: ${validStatuses.join(", ")}` };
      const row = db.prepare("SELECT * FROM task_tree WHERE id = ?").get(id);
      if (!row) return { ok: false, error: `task ${id} not found` };
      // Terminal state protection: can't restart done/abandoned tasks
      if ((row.status === "done" || row.status === "abandoned") && (status === "in_progress" || status === "open")) {
        return { ok: false, error: `cannot restart task ${id} — terminal state: ${row.status}` };
      }
      try {
        const now = Math.floor(Date.now() / 1000);
        const completedAt = (status === "done" || status === "abandoned") ? now : null;
        const sets = ["status = ?", "updated_at = ?"];
        const params = [status, now];
        if (owner !== undefined) { sets.push("owner = ?"); params.push(owner); }
        if (completedAt) { sets.push("completed_at = ?"); params.push(completedAt); }
        params.push(id);
        db.prepare(`UPDATE task_tree SET ${sets.join(", ")} WHERE id = ?`).run(...params);
        this._logTaskEvent(id, status === "done" ? "done" : status === "abandoned" ? "abandoned" : "updated", { status, owner }, workspace || row.workspace);
        return { ok: true, id, status };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * List tasks with optional filters. Returns flat list sorted by id.
     * @param {{ sessionId?: string, status?: string, workspace?: string, parentId?: string }} opts
     */
    taskTreeList({ sessionId, status, workspace, parentId } = {}) {
      try {
        const conds = [];
        const params = [];
        if (sessionId) { conds.push("session_id = ?"); params.push(sessionId); }
        if (status) { conds.push("status = ?"); params.push(status); }
        if (workspace) { conds.push("workspace = ?"); params.push(workspace); }
        if (parentId !== undefined) { conds.push("parent_id = ?"); params.push(parentId || null); }
        const where = conds.length > 0 ? "WHERE " + conds.join(" AND ") : "";
        const rows = db.prepare(`SELECT * FROM task_tree ${where} ORDER BY id ASC`).all(...params);
        return { ok: true, tasks: rows, count: rows.length };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Get a single task by ID.
     */
    taskTreeGet({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      const row = db.prepare("SELECT * FROM task_tree WHERE id = ?").get(id);
      if (!row) return { ok: false, error: "not found" };
      // Get children
      const children = db.prepare("SELECT id, status FROM task_tree WHERE parent_id = ? ORDER BY id").all(id);
      // Get events
      const events = db.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT 20").all(id);
      return { ok: true, task: row, children, events };
    },

    /**
     * Delete a task and its children (cascade).
     */
    taskTreeDelete({ id }) {
      if (!id) return { ok: false, error: "id is required" };
      try {
        // Delete children first
        db.prepare("DELETE FROM task_events WHERE task_id IN (SELECT id FROM task_tree WHERE parent_id = ?)").run(id);
        db.prepare("DELETE FROM task_tree WHERE parent_id = ?").run(id);
        // Delete events for this task
        db.prepare("DELETE FROM task_events WHERE task_id = ?").run(id);
        // Delete task
        const result = db.prepare("DELETE FROM task_tree WHERE id = ?").run(id);
        return { ok: true, deleted: result.changes > 0 };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Get incomplete tasks for gate logic (warn before stopping).
     * Returns tasks that are not done/abandoned.
     * @param {{ workspace?: string }} opts
     */
    taskTreeGate({ workspace } = {}) {
      try {
        const conds = ["status NOT IN ('done', 'abandoned')"];
        const params = [];
        if (workspace) { conds.push("workspace = ?"); params.push(workspace); }
        const rows = db.prepare(`SELECT id, description, status, owner FROM task_tree WHERE ${conds.join(" AND ")} ORDER BY id`).all(...params);
        if (rows.length === 0) return { ok: true, hasIncomplete: false, tasks: [] };
        // Build re-entry text (MiMo pattern)
        const lines = [`You still have ${rows.length} incomplete task(s):`];
        for (const t of rows) {
          lines.push(`- ${t.id}: ${t.description} [${t.status}]${t.owner ? ` (${t.owner})` : ""}`);
        }
        return { ok: true, hasIncomplete: true, tasks: rows, reentryText: lines.join("\n") };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /** @private Log a task event */
    _logTaskEvent(taskId, kind, data, workspace) {
      try {
        db.prepare(`INSERT INTO task_events (task_id, kind, data, workspace) VALUES (?, ?, ?, ?)`)
          .run(taskId, kind, JSON.stringify(data || {}), workspace || null);
      } catch {}
    },

    // ── Auto-Dream / Auto-Distill (MiMo-inspired) ───────────────────────────

    /**
     * Auto-Dream: Consolidate scattered working memories into coherent semantic summaries.
     * Groups working memories by key prefix, creates consolidated semantic entries.
     * @param {{ workspace?: string, maxAge?: number }} opts
     */
    autoDream({ workspace, maxAge = 7 * 24 * 60 * 60 } = {}) {
      try {
        const cutoff = Math.floor(Date.now() / 1000) - maxAge;
        const ws = workspace || null;
        // Get working memories older than 1 day (ripe for consolidation)
        const dayCutoff = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
        const conds = ["type = 'working'", "created_at < ?"];
        const params = [dayCutoff];
        if (ws) { conds.push("workspace = ?"); params.push(ws); }
        const working = db.prepare(`SELECT * FROM memories WHERE ${conds.join(" AND ")} ORDER BY key, created_at`).all(...params);
        if (working.length < 3) return { ok: true, consolidated: 0, message: "Not enough working memories to consolidate" };

        // Group by key prefix (before last dash)
        const groups = new Map();
        for (const mem of working) {
          const prefix = mem.key.replace(/-[^-]*$/, "") || mem.key;
          const group = groups.get(prefix) || [];
          group.push(mem);
          groups.set(prefix, group);
        }

        let consolidated = 0;
        for (const [prefix, memories] of groups) {
          if (memories.length < 2) continue;
          // Build consolidated content
          const summary = memories.map(m => `- [${m.key}] ${m.content.slice(0, 200)}`).join("\n");
          const allTags = new Set();
          for (const m of memories) {
            try { JSON.parse(m.tags || "[]").forEach(t => allTags.add(t)); } catch {}
          }
          allTags.add("auto-dream");
          allTags.add("consolidated");

          // Create semantic memory
          const id = `mem_dream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const now = Math.floor(Date.now() / 1000);
          db.prepare(`
            INSERT INTO memories (id, type, key, content, tags, agent_id, workspace, scope, created_at, updated_at)
            VALUES (?, 'semantic', ?, ?, ?, 'auto-dream', ?, 'project', ?, ?)
          `).run(id, `dream:${prefix}`, summary, JSON.stringify([...allTags]), ws, now, now);

          // Delete the original working memories
          for (const m of memories) {
            db.prepare("DELETE FROM memories WHERE id = ?").run(m.id);
          }
          consolidated++;
        }

        return { ok: true, consolidated, groupsAnalyzed: groups.size };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    /**
     * Auto-Distill: Extract repeated workflow patterns from successful trajectories.
     * Scans trajectories for common action sequences and creates pattern entries.
     * @param {{ minOccurrences?: number, workspace?: string }} opts
     */
    autoDistill({ minOccurrences = 2, workspace } = {}) {
      try {
        const ws = workspace || null;
        // Get successful trajectories
        const conds = ["outcome = 'success'"];
        const params = [];
        if (ws) { conds.push("workspace = ?"); params.push(ws); }
        params.push(50); // limit
        const rows = db.prepare(`SELECT * FROM trajectories WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params);
        if (rows.length < minOccurrences) return { ok: true, distilled: 0, message: `Need ${minOccurrences}+ successful trajectories, found ${rows.length}` };

        // Extract action sequence signatures
        const signatures = new Map();
        for (const row of rows) {
          const steps = JSON.parse(row.steps || "[]");
          const actions = steps.map(s => s.action || s.tool || "unknown").join(" → ");
          if (!actions) continue;
          const sig = signatures.get(actions) || { actions, count: 0, taskTypes: new Set(), examples: [] };
          sig.count++;
          if (row.task_type) sig.taskTypes.add(row.task_type);
          sig.examples.push(row.id);
          signatures.set(actions, sig);
        }

        let distilled = 0;
        for (const [, sig] of signatures) {
          if (sig.count < minOccurrences) continue;
          // Check if pattern already exists
          const existing = db.prepare("SELECT id FROM patterns WHERE description LIKE ?").get(`%${sig.actions.slice(0, 50)}%`);
          if (existing) continue; // Already distilled

          const id = `pat_distill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          db.prepare(`
            INSERT INTO patterns (id, pattern_type, description, source_trajectory, quality_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
          `).run(id, [...sig.taskTypes][0] || "general",
            `Distilled workflow (${sig.count} occurrences): ${sig.actions}`,
            sig.examples.slice(0, 3).join(","),
            Math.min(1, sig.count / 10));
          distilled++;
        }

        return { ok: true, distilled, trajectoriesAnalyzed: rows.length };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // ── Context Pressure Levels (MiMo-inspired) ─────────────────────────────
    // Since Codebrain uses CLI agents (not direct API), we track proxy signals
    // to estimate context pressure: activity duration, output volume, tool calls.
    // Levels: 0=safe, 1=moderate, 2=high, 3=critical
    _paneActivity: new Map(), // paneId → { startTime, outputChars, toolCalls }

    /**
     * Record pane activity for pressure tracking.
     * Call this when a pane produces output or makes a tool call.
     * @param {{ paneId: string, outputChars?: number, toolCall?: boolean }} opts
     */
    recordActivity({ paneId, outputChars = 0, toolCall = false }) {
      if (!paneId) return;
      const now = Date.now();
      let activity = this._paneActivity.get(paneId);
      if (!activity) {
        activity = { startTime: now, outputChars: 0, toolCalls: 0 };
        this._paneActivity.set(paneId, activity);
      }
      activity.outputChars += outputChars;
      if (toolCall) activity.toolCalls++;
      activity.lastUpdate = now;
    },

    /**
     * Get context pressure level for a pane.
     * Uses proxy signals since CLI agents manage their own context windows.
     * @param {{ paneId: string }} opts
     * @returns {{ ok: boolean, level?: number, label?: string, details?: object }}
     */
    getPressureLevel({ paneId }) {
      if (!paneId) return { ok: false, error: "paneId required" };
      const activity = this._paneActivity.get(paneId);
      if (!activity) return { ok: true, level: 0, label: "safe", details: { duration: 0, outputChars: 0, toolCalls: 0 } };

      const durationMin = (Date.now() - activity.startTime) / 60000;
      const { outputChars, toolCalls } = activity;

      // Pressure heuristics based on activity signals
      let level = 0;
      if (durationMin > 10 || outputChars > 300000 || toolCalls > 50) {
        level = 3; // Critical
      } else if (durationMin > 5 || outputChars > 150000 || toolCalls > 25) {
        level = 2; // High
      } else if (durationMin > 2 || outputChars > 50000 || toolCalls > 10) {
        level = 1; // Moderate
      }

      const labels = ["safe", "moderate", "high", "critical"];
      return {
        ok: true,
        level,
        label: labels[level],
        details: {
          durationMin: Math.round(durationMin * 10) / 10,
          outputChars,
          toolCalls,
          startedAt: activity.startTime,
        },
      };
    },

    /**
     * Get pressure levels for all active panes.
     * @returns {{ ok: boolean, panes?: Array }}
     */
    getAllPressureLevels() {
      const panes = [];
      for (const [paneId, activity] of this._paneActivity) {
        const result = this.getPressureLevel({ paneId });
        if (result.ok) panes.push({ paneId, ...result });
      }
      panes.sort((a, b) => b.level - a.level); // Highest pressure first
      return { ok: true, panes, count: panes.length };
    },

    /**
     * Clear pressure tracking for a pane (call on pane exit).
     * @param {{ paneId: string }} opts
     */
    clearPressureTracking({ paneId }) {
      if (paneId) this._paneActivity.delete(paneId);
    },

    // ── Memory Auto-Pruning (MiMo-inspired) ─────────────────────────────────
    // Periodically prunes stale working memories to prevent unbounded growth.
    // Rules:
    //   1. Delete working memories older than 7 days
    //   2. Delete orphaned file-changed entries for files that no longer exist
    //   3. Cap total working memories at 500 (oldest first)

    /**
     * Run memory auto-pruning. Safe to call periodically (idempotent).
     * @param {{ maxWorkingAge?: number, maxWorkingCount?: number }} opts
     * @returns {{ ok: boolean, pruned?: number, details?: object }}
     */
    autoPrune({ maxWorkingAge = 7 * 24 * 60 * 60, maxWorkingCount = 500 } = {}) {
      try {
        let pruned = 0;
        const details = { stale: 0, excess: 0, orphans: 0 };
        const cutoff = Math.floor(Date.now() / 1000) - maxWorkingAge;

        // 1. Delete stale working memories (>7 days old)
        const staleResult = db.prepare(`
          DELETE FROM memories WHERE type = 'working' AND created_at < ?
        `).run(cutoff);
        details.stale = staleResult.changes;
        pruned += staleResult.changes;

        // 2. Delete orphaned file-changed entries
        try {
          const fileChanged = db.prepare(`
            SELECT id, key, content FROM memories
            WHERE key LIKE 'file-changed-%' AND type = 'working'
          `).all();
          for (const mem of fileChanged) {
            const relPath = mem.key.replace('file-changed-', '');
            const ws = mem.workspace;
            if (ws) {
              const absPath = path.join(ws, relPath);
              if (!fs.existsSync(absPath)) {
                db.prepare("DELETE FROM memories WHERE id = ?").run(mem.id);
                details.orphans++;
                pruned++;
              }
            }
          }
        } catch {}

        // 3. Cap working memories at maxWorkingCount
        const countRow = db.prepare(`SELECT COUNT(*) as c FROM memories WHERE type = 'working'`).get();
        if (countRow.c > maxWorkingCount) {
          const excess = countRow.c - maxWorkingCount;
          db.prepare(`
            DELETE FROM memories WHERE id IN (
              SELECT id FROM memories WHERE type = 'working'
              ORDER BY updated_at ASC LIMIT ?
            )
          `).run(excess);
          details.excess = excess;
          pruned += excess;
        }

        return { ok: true, pruned, details };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };
}

module.exports = { createMemoryStore };
