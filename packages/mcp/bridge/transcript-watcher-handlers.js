"use strict";

/**
 * Transcript Watcher Handlers — Observability for CLI agent sessions.
 *
 * Tails JSONL transcripts produced by Claude Code CLI and Codex CLI to:
 *   1. Record per-message token usage in the shared memory store (token_usage table)
 *   2. Detect active session IDs for potential --resume capability
 *   3. Broadcast token updates (onRecorded callback)
 *
 * Ported from Overclock sidecar: ClaudeTranscriptWatcher.js + CodexTranscriptWatcher.js.
 * Adapted to Codebrain's CommonJS + memoryStore architecture.
 *
 * Source JSONL locations:
 *   Claude Code: ~/.claude/projects/<workspace-slug>/*.jsonl
 *                Recursive: <sessionId>/subagents/.../agent-*.jsonl
 *   Codex CLI:   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ─── Claude Code Transcript Watcher ─────────────────────────────────────────

/**
 * Watch Claude Code JSONL transcripts for token usage.
 *
 * Transcripts live in ~/.claude/projects/<workspace-slug>/*.jsonl where slug is the
 * workspace path with /, \, : → "-" (e.g. "/Users/x" → "-Users-x", "C:\Users\x" → "C--Users-x").
 *
 * Each line is a JSON object. Lines with type="assistant" and .message.usage carry the burn.
 * Usage fields: input_tokens, output_tokens, cache_read_input_tokens,
 *   cache_creation.ephemeral_5m_input_tokens, cache_creation.ephemeral_1h_input_tokens.
 *
 * Dedup by message.id (upsert ON CONFLICT). Streaming rewrites the same message per content block.
 */
class ClaudeTranscriptWatcher {
  /**
   * @param {Object} opts
   * @param {Object} opts.memoryStore - Codebrain memory store (has recordTokenUsage)
   * @param {Function} opts.lookupPane - ({ slug, firstSeenAt, sessionId }) => paneId | null
   * @param {Function} opts.onRecorded - Called when ≥1 usage line recorded
   * @param {Function} [opts.onSessionDetected] - (paneId, sessionId) 1x/session
   * @param {Function} [opts.extraProjectsRoots] - () => string[] for multi-account
   */
  constructor(opts = {}) {
    this.memoryStore = opts.memoryStore;
    this.lookupPane = opts.lookupPane || (() => null);
    this.onRecorded = opts.onRecorded || (() => {});
    this.onSessionDetected = opts.onSessionDetected || (() => {});
    this.extraProjectsRoots = opts.extraProjectsRoots || (() => []);

    this.watchers = [];
    this.watchedDirs = new Set();
    this.pendingDirs = new Set();
    this.offsets = new Map();       // file → byte offset
    this.ingestTail = new Map();    // file → Promise (serial queue)
    this.sessionPane = new Map();   // sessionId → paneId
    this.freshSessions = new Set(); // sessions from spawn (don't skip in seed)
    this.slugToWorkspace = new Map();
  }

  /**
   * Convert workspace path to Claude's project slug.
   * POSIX: "/Users/x" → "-Users-x"
   * Windows: "C:\Users\x" → "C--Users-x"
   */
  pathToSlug(workspacePath) {
    return workspacePath.replaceAll(/[/\\:]/g, "-");
  }

  /**
   * Mark a session as "fresh" (spawned now, don't skip in seed).
   * Call BEFORE start().
   */
  expectFreshSession(sessionId) {
    if (sessionId) this.freshSessions.add(sessionId);
  }

  /**
   * Start watching transcripts for a workspace. Idempotent.
   * @param {string} workspacePath - Absolute workspace path
   * @param {string} [configDir] - CLAUDE_CONFIG_DIR override
   */
  async start(workspacePath, configDir) {
    if (!workspacePath || workspacePath.startsWith("ssh://")) return;

    let extras = [];
    try { extras = this.extraProjectsRoots(); } catch {}

    const baseDir = configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    const roots = [...new Set([
      path.join(baseDir, "projects"),
      path.join(os.homedir(), ".claude", "projects"),
      ...extras,
    ])];

    this.slugToWorkspace.set(this.pathToSlug(workspacePath), workspacePath);
    await Promise.all(roots.map((root) => this.startRoot(root, workspacePath)));

    // Catch-up for fresh sessions
    for (const root of roots) {
      this.scheduleFreshCatchUp(path.join(root, this.pathToSlug(workspacePath)));
    }
  }

  scheduleFreshCatchUp(dir) {
    for (const id of this.freshSessions) {
      const file = path.join(dir, `${id}.jsonl`);
      for (const delay of [2_000, 8_000, 20_000, 45_000]) {
        setTimeout(() => { this.ingestFile(file).catch(() => {}); }, delay);
      }
    }
  }

  async startRoot(projectsRoot, workspacePath) {
    const slug = this.pathToSlug(workspacePath);
    const dir = path.join(projectsRoot, slug);

    if (this.watchedDirs.has(dir)) return;

    let exists = false;
    try { await fs.promises.stat(dir); exists = true; } catch { exists = false; }

    if (!exists) {
      if (this.pendingDirs.has(dir)) return;
      this.pendingDirs.add(dir);
      try {
        const watcher = fs.watch(projectsRoot, (_event, filename) => {
          if (filename && filename === slug) {
            this.pendingDirs.delete(dir);
            this.startRoot(projectsRoot, workspacePath).catch(() => {});
          }
        });
        this.watchers.push(watcher);
      } catch {
        this.pendingDirs.delete(dir);
      }
      return;
    }

    this.watchedDirs.add(dir);

    // Watch recursive (catches subagents/ paths)
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename);
        if (!this.isTrackedTranscript(rel)) return;
        this.ingestFile(path.join(dir, rel)).catch(() => {});
      });
      this.watchers.push(watcher);
    } catch {}

    // Seed offsets (skip historical content)
    const catchUp = [];
    try {
      const entries = await fs.promises.readdir(dir, { recursive: true });
      const toSeed = [];
      for (const rel of entries) {
        const r = String(rel);
        if (!this.isTrackedTranscript(r)) continue;
        const full = path.join(dir, r);
        const base = r.split("/").pop() || "";
        if (this.freshSessions.has(base.replace(/\.jsonl$/, ""))) {
          catchUp.push(full);
          continue;
        }
        if (this.offsets.has(full)) continue;
        toSeed.push(full);
      }

      const CONC = 64;
      let next = 0;
      const worker = async () => {
        while (next < toSeed.length) {
          const full = toSeed[next++];
          try {
            const st = await fs.promises.stat(full);
            if (!this.offsets.has(full)) this.offsets.set(full, st.size);
          } catch {}
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONC, toSeed.length) }, worker));
    } catch {}

    for (const f of catchUp) this.ingestFile(f).catch(() => {});
  }

  /** Accept only top-level .jsonl and subagent agent-*.jsonl files. */
  isTrackedTranscript(rel) {
    if (!rel.endsWith(".jsonl")) return false;
    const base = rel.split("/").pop() || "";
    if (rel.includes("/subagents/")) return base.startsWith("agent-");
    return !rel.includes("/");
  }

  /** Serialize ingests per file (prevents double-read on concurrent fs.watch events). */
  ingestFile(file) {
    const next = (this.ingestTail.get(file) || Promise.resolve())
      .then(() => this.doIngestFile(file))
      .catch(() => {});
    this.ingestTail.set(file, next);
    return next;
  }

  async doIngestFile(file) {
    let buf;
    try { buf = await fs.promises.readFile(file); } catch { return; }

    const prevOffset = this.offsets.get(file) || 0;
    if (prevOffset >= buf.length) return;

    const slice = buf.toString("utf8", prevOffset);
    this.offsets.set(file, buf.length);

    // Resolve dir root and workspace
    let dir = null;
    for (const d of this.watchedDirs) {
      if (file.startsWith(d + "/") || file.startsWith(d + path.sep)) { dir = d; break; }
    }
    if (!dir) return;

    const slug = dir.split(path.sep).pop() || dir.split("/").pop() || "";
    const workspacePath = this.slugToWorkspace.get(slug);
    if (!workspacePath) return;

    const rel = file.slice(dir.length + 1);
    const isSubagent = rel.includes("/subagents/") || rel.includes("\\subagents\\");
    const sessionId = isSubagent
      ? (rel.split(path.sep)[0] || rel.split("/")[0] || "unknown")
      : (rel.replace(".jsonl", "") || "unknown");

    if (!isSubagent) this.freshSessions.delete(sessionId);

    if (!this.sessionPane.has(sessionId)) {
      const resolvedPane = this.lookupPane({ slug, firstSeenAt: Date.now(), sessionId });
      this.sessionPane.set(sessionId, resolvedPane);
      if (resolvedPane && !isSubagent) {
        this.onSessionDetected(resolvedPane, sessionId);
      }
    }

    const paneId = this.sessionPane.get(sessionId) || null;
    let recorded = 0;

    for (const line of slice.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (!obj || typeof obj !== "object") continue;

      const o = obj;
      if (o.type !== "assistant") continue;

      const msg = o.message;
      const usage = msg?.usage;
      if (!usage) continue;

      const model = msg?.model || "claude-unknown";
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;

      const cc = usage.cache_creation;
      const legacyWrite = usage.cache_creation_input_tokens || 0;
      const cacheWrite5m = cc ? (cc.ephemeral_5m_input_tokens || 0) : 0;
      const cacheWrite1h = cc ? (cc.ephemeral_1h_input_tokens || 0) : legacyWrite;

      if (inputTokens + outputTokens + cacheReadTokens + cacheWrite5m + cacheWrite1h === 0) continue;

      const messageId = msg?.id || o.requestId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const agentName = paneId ? `pane:${paneId}` : "claude-cli-pane";

      try {
        this.memoryStore.recordTokenUsage({
          model,
          session_id: sessionId,
          task_id: null,
          agent_name: agentName,
          message_id: messageId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_write_5m_tokens: cacheWrite5m,
          cache_write_1h_tokens: cacheWrite1h,
        });
        recorded += 1;
      } catch {}
    }

    if (recorded > 0) this.onRecorded();
  }

  stop() {
    for (const w of this.watchers) { try { w.close(); } catch {} }
    this.watchers = [];
    this.offsets.clear();
    this.ingestTail.clear();
    this.watchedDirs.clear();
    this.pendingDirs.clear();
    this.sessionPane.clear();
    this.slugToWorkspace.clear();
    this.freshSessions.clear();
  }

  /** Return watcher status for diagnostics. */
  getStatus() {
    return {
      watchedDirs: [...this.watchedDirs],
      activeWatchers: this.watchers.length,
      trackedOffsets: this.offsets.size,
      sessionPanes: Object.fromEntries(this.sessionPane),
      freshSessions: [...this.freshSessions],
    };
  }
}

// ─── Codex CLI Transcript Watcher ───────────────────────────────────────────

/**
 * Watch Codex CLI JSONL rollouts for token usage.
 *
 * Rollouts live in ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 * Each rollout is one session, organized by DATE (not workspace slug).
 * Usage comes from type:"event_msg" with payload.type:"token_count".
 *
 * Fields: input_tokens (fresh), cached_input_tokens, output_tokens.
 * Model from turn_context events. CWD from session_meta.
 */
const UUID_RE = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

class CodexTranscriptWatcher {
  /**
   * @param {Object} opts
   * @param {Object} opts.memoryStore - Codebrain memory store
   * @param {Function} opts.lookupPane - ({ cwd, firstSeenAt }) => paneId | null
   * @param {Function} opts.onRecorded - Called when ≥1 usage line recorded
   * @param {Function} [opts.onSessionDetected] - (paneId, sessionId)
   * @param {Function} [opts.sessionsRoots] - () => string[] for multi-account
   */
  constructor(opts = {}) {
    this.memoryStore = opts.memoryStore;
    this.lookupPane = opts.lookupPane || (() => null);
    this.onRecorded = opts.onRecorded || (() => {});
    this.onSessionDetected = opts.onSessionDetected || (() => {});
    this.sessionsRoots = opts.sessionsRoots || (() => [path.join(os.homedir(), ".codex", "sessions")]);

    this.watchers = [];
    this.watchedRoots = new Set();
    this.pendingRoots = new Set();
    this.offsets = new Map();
    this.meta = new Map(); // file → { sessionId, cwd, model, paneId, resolved, lastSig }
  }

  async start() {
    let roots = [];
    try { roots = this.sessionsRoots(); } catch {
      roots = [path.join(os.homedir(), ".codex", "sessions")];
    }
    await Promise.all(roots.map((root) => this.startRoot(root)));
  }

  async startRoot(root) {
    if (this.watchedRoots.has(root)) return;

    let exists = false;
    try { await fs.promises.stat(root); exists = true; } catch { exists = false; }

    if (!exists) {
      if (this.pendingRoots.has(root)) return;
      this.pendingRoots.add(root);
      const parent = path.join(root, "..");
      try {
        const watcher = fs.watch(parent, (_event, filename) => {
          if (filename === "sessions") {
            this.pendingRoots.delete(root);
            this.startRoot(root).catch(() => {});
          }
        });
        this.watchers.push(watcher);
      } catch {
        this.pendingRoots.delete(root);
      }
      return;
    }

    this.watchedRoots.add(root);

    // Seed offsets (skip historical)
    try {
      const entries = await fs.promises.readdir(root, { recursive: true });
      for (const rel of entries) {
        if (!rel.endsWith(".jsonl") || !rel.includes("rollout-")) continue;
        const full = path.join(root, rel);
        try {
          const st = await fs.promises.stat(full);
          this.offsets.set(full, st.size);
        } catch {}
      }
    } catch {}

    // Watch recursive
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename);
        if (!rel.endsWith(".jsonl") || !rel.includes("rollout-")) return;
        this.ingestFile(path.join(root, rel)).catch(() => {});
      });
      this.watchers.push(watcher);
    } catch {}
  }

  /** Read first 64KB to extract cwd (session_meta) and model (turn_context). */
  async readHeadMeta(file) {
    let cwd = null;
    let model = "gpt-unknown";
    try {
      const fh = await fs.promises.open(file, "r");
      try {
        const buf = Buffer.alloc(64 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const head = buf.toString("utf8", 0, bytesRead);
        for (const line of head.split("\n")) {
          if (!line.trim()) continue;
          let o;
          try { o = JSON.parse(line); } catch { continue; }
          const p = o.payload;
          if (o.type === "session_meta" && p && typeof p.cwd === "string") cwd = p.cwd;
          if (o.type === "turn_context" && p && typeof p.model === "string") { model = p.model; break; }
        }
      } finally {
        await fh.close();
      }
    } catch {}
    return { cwd, model };
  }

  async ingestFile(file) {
    let buf;
    try { buf = await fs.promises.readFile(file); } catch { return; }

    const prevOffset = this.offsets.get(file) || 0;
    if (prevOffset >= buf.length) return;

    let m = this.meta.get(file);
    if (!m) {
      const sessionId = file.match(UUID_RE)?.[1] || path.basename(file, ".jsonl") || "unknown";
      const head = await this.readHeadMeta(file);
      m = { sessionId, cwd: head.cwd, model: head.model, paneId: null, resolved: false, lastSig: null };
      this.meta.set(file, m);
    }

    const slice = buf.toString("utf8", prevOffset);
    this.offsets.set(file, buf.length);

    if (!m.cwd) return; // no cwd → can't resolve workspace

    if (!m.resolved) {
      m.paneId = this.lookupPane({ cwd: m.cwd, firstSeenAt: Date.now() });
      m.resolved = true;
      if (m.paneId) this.onSessionDetected(m.paneId, m.sessionId);
    }

    let recorded = 0;
    for (const line of slice.split("\n")) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }

      const p = o.payload;
      if (!p) continue;

      if (o.type === "turn_context" && typeof p.model === "string") m.model = p.model;

      if (o.type !== "event_msg" || p.type !== "token_count") continue;

      const info = p.info;
      const lu = info?.last_token_usage || info?.total_token_usage;
      if (!lu) continue;

      const inputRaw = lu.input_tokens || 0;
      const cached = lu.cached_input_tokens || 0;
      const output = lu.output_tokens || 0;
      const freshIn = Math.max(0, inputRaw - cached);

      if (freshIn + output + cached === 0) continue;

      // Dedup: same signature as last time → skip
      const sig = `${inputRaw}:${cached}:${output}`;
      if (sig === m.lastSig) continue;
      m.lastSig = sig;

      const agentName = m.paneId ? `pane:${m.paneId}` : "codex-cli-pane";

      try {
        this.memoryStore.recordTokenUsage({
          model: m.model,
          session_id: m.sessionId,
          task_id: null,
          agent_name: agentName,
          input_tokens: freshIn,
          output_tokens: output,
          cache_read_tokens: cached,
          cache_write_5m_tokens: 0,
          cache_write_1h_tokens: 0,
        });
        recorded += 1;
      } catch {}
    }

    if (recorded > 0) this.onRecorded();
  }

  stop() {
    for (const w of this.watchers) { try { w.close(); } catch {} }
    this.watchers = [];
    this.offsets.clear();
    this.watchedRoots.clear();
    this.pendingRoots.clear();
    this.meta.clear();
  }

  getStatus() {
    return {
      watchedRoots: [...this.watchedRoots],
      activeWatchers: this.watchers.length,
      trackedOffsets: this.offsets.size,
      trackedSessions: this.meta.size,
    };
  }
}

// ─── Bridge Handlers (MCP integration) ─────────────────────────────────────

/**
 * Creates transcript watcher handlers for the MCP bridge.
 *
 * @param {Object} opts
 * @param {Object} opts.memoryStore - Codebrain memory store
 * @param {Object} opts.ptyManager - PtyManager instance
 * @param {Function} [opts.getCurrentWorkspacePath] - () => string
 */
function createTranscriptWatcherHandlers(opts) {
  const { memoryStore, ptyManager } = opts;
  if (!memoryStore) {
    return {
      transcriptWatcherStart: async () => ({ ok: false, error: "memory store not available" }),
      transcriptWatcherStop: async () => ({ ok: false, error: "memory store not available" }),
      transcriptWatcherStatus: async () => ({ ok: false, error: "memory store not available" }),
      transcriptWatcherTokenSummary: async () => ({ ok: false, error: "memory store not available" }),
    };
  }

  let claudeWatcher = null;
  let codexWatcher = null;
  let started = false;

  /** Resolve pane by slug + time window (matches pane spawned within ±30s). */
  function lookupPaneBySlug({ slug, firstSeenAt }) {
    if (!ptyManager) return null;
    const panes = ptyManager.list();
    for (const p of panes) {
      const wsPath = p.workspacePath || p.cwd || "";
      if (!wsPath) continue;
      // Use same slug algorithm
      const paneSlug = wsPath.replaceAll(/[/\\:]/g, "-");
      if (paneSlug === slug) return p.paneId;
    }
    return null;
  }

  /** Resolve pane by cwd match. */
  function lookupPaneByCwd({ cwd }) {
    if (!ptyManager || !cwd) return null;
    const panes = ptyManager.list();
    for (const p of panes) {
      const wsPath = p.workspacePath || p.cwd || "";
      if (wsPath && path.resolve(wsPath) === path.resolve(cwd)) return p.paneId;
    }
    return null;
  }

  return {
    /**
     * Start transcript watchers for the current workspace.
     * Idempotent — calling again is a no-op if already started.
     */
    async transcriptWatcherStart({ workspace, configDir } = {}) {
      const ws = workspace || opts.getCurrentWorkspacePath?.() || process.cwd();

      if (!claudeWatcher) {
        claudeWatcher = new ClaudeTranscriptWatcher({
          memoryStore,
          lookupPane: lookupPaneBySlug,
          onRecorded: () => {
            // Fire hook for UI update (tokens badge, cost display)
            if (opts.hooksManager) {
              try { opts.hooksManager.fire("tokens_updated", {}); } catch {}
            }
          },
        });
      }

      if (!codexWatcher) {
        codexWatcher = new CodexTranscriptWatcher({
          memoryStore,
          lookupPane: lookupPaneByCwd,
          onRecorded: () => {
            if (opts.hooksManager) {
              try { opts.hooksManager.fire("tokens_updated", {}); } catch {}
            }
          },
        });
      }

      try {
        await claudeWatcher.start(ws, configDir);
      } catch (e) {
        console.warn("[transcript-watcher] Claude watcher start failed:", e.message);
      }

      try {
        await codexWatcher.start();
      } catch (e) {
        console.warn("[transcript-watcher] Codex watcher start failed:", e.message);
      }

      started = true;
      return {
        ok: true,
        data: {
          claude: claudeWatcher.getStatus(),
          codex: codexWatcher.getStatus(),
        },
      };
    },

    /**
     * Stop all transcript watchers.
     */
    async transcriptWatcherStop() {
      if (claudeWatcher) { claudeWatcher.stop(); claudeWatcher = null; }
      if (codexWatcher) { codexWatcher.stop(); codexWatcher = null; }
      started = false;
      return { ok: true };
    },

    /**
     * Get watcher status and diagnostics.
     */
    async transcriptWatcherStatus() {
      return {
        ok: true,
        data: {
          started,
          claude: claudeWatcher ? claudeWatcher.getStatus() : null,
          codex: codexWatcher ? codexWatcher.getStatus() : null,
        },
      };
    },

    /**
     * Get token usage summary from the store.
     */
    async transcriptWatcherTokenSummary({ sessionId, agentName, since } = {}) {
      return memoryStore.getTokenUsageSummary({ sessionId, agentName, since });
    },
  };
}

module.exports = { createTranscriptWatcherHandlers, ClaudeTranscriptWatcher, CodexTranscriptWatcher };
