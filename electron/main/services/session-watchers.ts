import log from "electron-log/main.js";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type { AppContext } from "../context";

// ── Types ──────────────────────────────────────────────────────────────────

interface PaneInfo {
  paneId: string;
  agent: string;
  cwd: string;
  workspacePath?: string;
  spawnedAt: number;
}

interface CapturedSession {
  paneId: string;
  session: {
    provider: string;
    id: string;
    capturedAt: number;
    confidence: "high" | "medium" | "low";
    source: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const MATCH_WINDOW_MS = 5 * 60_000; // 5 minutes

function canonicalPath(p: string): string {
  try { return fs.realpathSync.native(p); }
  catch { return path.resolve(p); }
}

function samePath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

function isSameOrChildPath(parent: string, child: string): boolean {
  const rel = path.relative(canonicalPath(parent), canonicalPath(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

async function firstJsonLine(file: string): Promise<any | null> {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(file, "r");
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < 64 * 1024) {
      const buf = Buffer.alloc(4096);
      const read = await handle.read(buf, 0, buf.length, offset);
      if (read.bytesRead <= 0) break;
      const slice = buf.subarray(0, read.bytesRead);
      const newline = slice.indexOf(10);
      if (newline >= 0) { chunks.push(slice.subarray(0, newline)); break; }
      chunks.push(slice);
      offset += read.bytesRead;
    }
    const line = Buffer.concat(chunks).toString("utf8").trim();
    if (!line) return null;
    return JSON.parse(line);
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

// ── BaseSessionWatcher ─────────────────────────────────────────────────────

class BaseSessionWatcher {
  readonly agent: string;
  private onCapture: (capture: CapturedSession) => void;
  protected panes = new Map<string, PaneInfo>();
  protected captured = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(agent: string, onCapture: (capture: CapturedSession) => void) {
    this.agent = agent;
    this.onCapture = onCapture;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.scan().catch(() => {}); }, 2000);
    (this.timer as any).unref?.();
    this.scan().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.panes.clear();
    this.captured.clear();
  }

  registerPane(pane: PaneInfo) {
    if (pane.agent !== this.agent) return;
    this.panes.set(pane.paneId, pane);
    this.scan().catch(() => {});
  }

  unregisterPane(paneId: string) {
    this.panes.delete(paneId);
  }

  protected newestSpawn(): number {
    return Math.max(0, ...[...this.panes.values()].map((p) => p.spawnedAt));
  }

  protected emitCapture(capture: CapturedSession) {
    this.onCapture(capture);
  }

  private async scan() {
    if (this.scanning || this.panes.size === 0) return;
    this.scanning = true;
    try { await this.scanOnce(); }
    finally { this.scanning = false; }
  }

  // Override in subclasses
  protected async scanOnce() {}
}

// ── CodexSessionWatcher ────────────────────────────────────────────────────

class CodexSessionWatcher extends BaseSessionWatcher {
  private root = path.join(os.homedir(), ".codex", "sessions");

  constructor(onCapture: (c: CapturedSession) => void) {
    super("codex", onCapture);
  }

  private async recentFiles(): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string, depth: number) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (depth < 4) await walk(full, depth + 1); continue; }
        if (!entry.name.endsWith(".jsonl")) continue;
        const st = await fsp.stat(full).catch(() => null);
        if (!st) continue;
        const newestSpawn = this.newestSpawn();
        if (newestSpawn && st.mtimeMs < newestSpawn - 10_000) continue;
        files.push(full);
      }
    };
    await walk(this.root, 0);
    return files;
  }

  private async readMeta(file: string) {
    const first = await firstJsonLine(file);
    const payload = first?.payload;
    if (!payload || typeof payload !== "object") return null;
    const p = payload;
    if (typeof p.id !== "string" || typeof p.cwd !== "string" || typeof p.timestamp !== "string") return null;
    const parsedTime = Date.parse(p.timestamp);
    if (!Number.isFinite(parsedTime)) return null;
    const st = await fsp.stat(file).catch(() => null);
    if (!st) return null;
    return { id: p.id, cwd: p.cwd, timestamp: parsedTime, file, mtimeMs: st.mtimeMs };
  }

  protected async scanOnce() {
    const candidates: Awaited<ReturnType<typeof this.readMeta>>[] = [];
    for (const file of await this.recentFiles()) {
      const meta = await this.readMeta(file);
      if (meta && !this.captured.has(meta.id)) candidates.push(meta);
    }
    for (const pane of this.panes.values()) {
      const matches = candidates.filter((c) => {
        if (!c) return false;
        if (!samePath(c.cwd, pane.cwd)) return false;
        if (c.timestamp < pane.spawnedAt - 5000) return false;
        if (c.timestamp - pane.spawnedAt > MATCH_WINDOW_MS) return false;
        return true;
      });
      if (matches.length !== 1) continue;
      const match = matches[0]!;
      const matchingPanes = [...this.panes.values()].filter(
        (other) => samePath(other.cwd, match.cwd) && match.timestamp >= other.spawnedAt - 5000 && match.timestamp - other.spawnedAt <= MATCH_WINDOW_MS
      );
      if (matchingPanes.length !== 1) continue;
      this.captured.add(match.id);
      this.emitCapture({ paneId: pane.paneId, session: { provider: "codex", id: match.id, capturedAt: Date.now(), confidence: "high", source: "session-file" } });
    }
  }
}

// ── GeminiSessionWatcher ───────────────────────────────────────────────────

class GeminiSessionWatcher extends BaseSessionWatcher {
  private root = path.join(os.homedir(), ".gemini", "tmp");

  constructor(onCapture: (c: CapturedSession) => void) {
    super("gemini", onCapture);
  }

  private async projectDirs() {
    const dirs: { projectRoot: string; chatsDir: string }[] = [];
    let entries;
    try { entries = await fsp.readdir(this.root, { withFileTypes: true }); }
    catch { return dirs; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.root, entry.name);
      const raw = await fsp.readFile(path.join(dir, ".project_root"), "utf8").catch(() => null);
      if (!raw?.trim()) continue;
      dirs.push({ projectRoot: raw.trim(), chatsDir: path.join(dir, "chats") });
    }
    return dirs;
  }

  private async readMeta(file: string, projectRoot: string) {
    const first = await firstJsonLine(file);
    if (!first) return null;
    if (typeof first.sessionId !== "string" || typeof first.startTime !== "string") return null;
    const startTime = Date.parse(first.startTime);
    if (!Number.isFinite(startTime)) return null;
    const st = await fsp.stat(file).catch(() => null);
    if (!st) return null;
    return { id: first.sessionId, projectRoot, startTime, file, mtimeMs: st.mtimeMs };
  }

  protected async scanOnce() {
    const newestSpawn = this.newestSpawn();
    const candidates: NonNullable<Awaited<ReturnType<typeof this.readMeta>>>[] = [];
    for (const project of await this.projectDirs()) {
      let files;
      try { files = await fsp.readdir(project.chatsDir); }
      catch { continue; }
      for (const name of files) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(project.chatsDir, name);
        const st = await fsp.stat(file).catch(() => null);
        if (!st || (newestSpawn && st.mtimeMs < newestSpawn - 10_000)) continue;
        const meta = await this.readMeta(file, project.projectRoot);
        if (meta && !this.captured.has(meta.id)) candidates.push(meta);
      }
    }
    for (const pane of this.panes.values()) {
      const matches = candidates.filter((c) => {
        if (!isSameOrChildPath(c.projectRoot, pane.cwd) && !isSameOrChildPath(c.projectRoot, pane.workspacePath || "")) return false;
        if (c.startTime < pane.spawnedAt - 5000) return false;
        if (c.startTime - pane.spawnedAt > MATCH_WINDOW_MS) return false;
        return true;
      });
      if (matches.length !== 1) continue;
      const match = matches[0];
      const matchingPanes = [...this.panes.values()].filter(
        (other) => (isSameOrChildPath(match.projectRoot, other.cwd) || isSameOrChildPath(match.projectRoot, other.workspacePath || "")) && match.startTime >= other.spawnedAt - 5000 && match.startTime - other.spawnedAt <= MATCH_WINDOW_MS
      );
      if (matchingPanes.length !== 1) continue;
      this.captured.add(match.id);
      this.emitCapture({ paneId: pane.paneId, session: { provider: "gemini", id: match.id, capturedAt: Date.now(), confidence: "high", source: "session-file" } });
    }
  }
}

// ── KimiSessionWatcher ─────────────────────────────────────────────────────

function kimiProjectHash(workDir: string): string {
  return crypto.createHash("md5").update(workDir).digest("hex");
}

class KimiSessionWatcher extends BaseSessionWatcher {
  private root = path.join(os.homedir(), ".kimi", "sessions");

  constructor(onCapture: (c: CapturedSession) => void) {
    super("kimi", onCapture);
  }

  private async recentSessionsForWorkDir(workDir: string, newestSpawn: number) {
    const dir = path.join(this.root, kimiProjectHash(workDir));
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return []; }
    const sessions: { id: string; timestamp: number; mtimeMs: number }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (this.captured.has(id)) continue;
      const sessionDir = path.join(dir, id);
      const stats = await Promise.all([
        fsp.stat(path.join(sessionDir, "state.json")).catch(() => null),
        fsp.stat(path.join(sessionDir, "wire.jsonl")).catch(() => null),
        fsp.stat(path.join(sessionDir, "context.jsonl")).catch(() => null),
        fsp.stat(sessionDir).catch(() => null),
      ]);
      const mtimeMs = Math.max(0, ...stats.filter(Boolean).map((s) => s!.mtimeMs));
      if (!mtimeMs || (newestSpawn && mtimeMs < newestSpawn - 10_000)) continue;
      sessions.push({ id, timestamp: mtimeMs, mtimeMs });
    }
    return sessions;
  }

  protected async scanOnce() {
    const newestSpawn = this.newestSpawn();
    const candidatesByPane = new Map<string, Awaited<ReturnType<typeof this.recentSessionsForWorkDir>>>();
    for (const pane of this.panes.values()) {
      candidatesByPane.set(pane.paneId, await this.recentSessionsForWorkDir(pane.cwd, newestSpawn));
    }
    for (const pane of this.panes.values()) {
      const matches = (candidatesByPane.get(pane.paneId) ?? []).filter((c) => {
        if (c.timestamp < pane.spawnedAt - 5000) return false;
        if (c.timestamp - pane.spawnedAt > MATCH_WINDOW_MS) return false;
        return true;
      });
      if (matches.length !== 1) continue;
      const match = matches[0];
      const matchingPanes = [...this.panes.values()].filter((other) => {
        const otherMatches = candidatesByPane.get(other.paneId) ?? [];
        return otherMatches.some((c) => c.id === match.id && c.timestamp >= other.spawnedAt - 5000 && c.timestamp - other.spawnedAt <= MATCH_WINDOW_MS);
      });
      if (matchingPanes.length !== 1) continue;
      this.captured.add(match.id);
      this.emitCapture({ paneId: pane.paneId, session: { provider: "kimi", id: match.id, capturedAt: Date.now(), confidence: "high", source: "session-file" } });
    }
  }
}

// ── CursorSessionWatcher ───────────────────────────────────────────────────

function encodeCursorProjectKey(cwd: string): string {
  return canonicalPath(cwd).replace(/^\/+/, "").replace(/[\/\\]/g, "-");
}

class CursorSessionWatcher extends BaseSessionWatcher {
  private projectsRoot = path.join(os.homedir(), ".cursor", "projects");

  constructor(onCapture: (c: CapturedSession) => void) {
    super("cursor", onCapture);
  }

  private async listForCwd(cwd: string) {
    const projectKey = encodeCursorProjectKey(cwd);
    const transcriptsDir = path.join(this.projectsRoot, projectKey, "agent-transcripts");
    if (!fs.existsSync(transcriptsDir)) return [];
    let entries;
    try { entries = await fsp.readdir(transcriptsDir, { withFileTypes: true }); }
    catch { return []; }
    const out: { id: string; cwd: string; timestamp: number }[] = [];
    for (const entry of entries) {
      if (!entry.name) continue;
      const full = path.join(transcriptsDir, entry.name);
      const st = await fsp.stat(full).catch(() => null);
      if (!st) continue;
      out.push({ id: entry.name, cwd, timestamp: st.mtimeMs });
    }
    return out;
  }

  protected async scanOnce() {
    for (const pane of this.panes.values()) {
      const candidates = (await this.listForCwd(pane.cwd)).filter((c) => !this.captured.has(c.id));
      const matches = candidates.filter(
        (c) => samePath(c.cwd, pane.cwd) && c.timestamp >= pane.spawnedAt - 5000 && c.timestamp - pane.spawnedAt <= MATCH_WINDOW_MS
      );
      if (matches.length !== 1) continue;
      const match = matches[0];
      this.captured.add(match.id);
      this.emitCapture({ paneId: pane.paneId, session: { provider: "cursor", id: match.id, capturedAt: Date.now(), confidence: "high", source: "session-file" } });
    }
  }
}

// ── CopilotSessionWatcher ──────────────────────────────────────────────────

class CopilotSessionWatcher extends BaseSessionWatcher {
  private dbPath = path.join(os.homedir(), ".copilot", "session-store.db");

  constructor(onCapture: (c: CapturedSession) => void) {
    super("copilot", onCapture);
  }

  private readSessions() {
    if (!fs.existsSync(this.dbPath)) return [];
    let db: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require("better-sqlite3");
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      const newestSpawn = this.newestSpawn();
      const cutoff = newestSpawn > 0 ? newestSpawn - 10_000 : 0;
      const rows = db.prepare(`SELECT id, cwd, updated_at FROM sessions WHERE updated_at >= ?`).all(new Date(cutoff).toISOString());
      const out: { id: string; cwd: string; updatedAt: number }[] = [];
      for (const row of rows as any[]) {
        if (!row.id || !row.cwd) continue;
        const ts = Date.parse(row.updated_at);
        if (!Number.isFinite(ts)) continue;
        out.push({ id: row.id, cwd: row.cwd, updatedAt: ts });
      }
      return out;
    } catch { return []; }
    finally { try { db?.close(); } catch {} }
  }

  protected async scanOnce() {
    const rows = this.readSessions().filter((row) => !this.captured.has(row.id));
    for (const pane of this.panes.values()) {
      const matches = rows.filter(
        (row) => samePath(row.cwd, pane.cwd) && row.updatedAt >= pane.spawnedAt - 5000 && row.updatedAt - pane.spawnedAt <= MATCH_WINDOW_MS
      );
      if (matches.length !== 1) continue;
      const match = matches[0];
      this.captured.add(match.id);
      this.emitCapture({ paneId: pane.paneId, session: { provider: "copilot", id: match.id, capturedAt: Date.now(), confidence: "high", source: "session-file" } });
    }
  }
}

// ── SessionWatcherManager ──────────────────────────────────────────────────

export interface SessionWatcherManager {
  registerPane(pane: PaneInfo): void;
  unregisterPane(paneId: string): void;
  start(): void;
  stop(): void;
}

/**
 * Creates the session watcher manager that monitors CLI session files and
 * captures transcripts into Codebrain's shared memory.
 */
export function createSessionWatchers(ctx: AppContext): SessionWatcherManager {
  const watchers: BaseSessionWatcher[] = [];

  function onCapture(capture: CapturedSession) {
    try {
      const store = ctx.memoryStore;
      if (!store) return;
      const workspace = ctx.currentWorkspacePath || capture.session.id;
      store.write({
        type: "episodic",
        key: `session-capture-${capture.session.provider}-${capture.session.id}`,
        content: `CLI session captured for pane ${capture.paneId}\nProvider: ${capture.session.provider}\nSession ID: ${capture.session.id}\nConfidence: ${capture.session.confidence}\nSource: ${capture.session.source}`,
        tags: ["session-capture", capture.session.provider, "auto"],
        agent_id: "session-watcher",
        workspace,
      });
      log.info(`[SessionWatcher] Captured ${capture.session.provider} session ${capture.session.id} → pane ${capture.paneId}`);
    } catch (err) {
      log.warn(`[SessionWatcher] Failed to record capture: ${err}`);
    }
  }

  watchers.push(
    new CodexSessionWatcher(onCapture),
    new GeminiSessionWatcher(onCapture),
    new KimiSessionWatcher(onCapture),
    new CursorSessionWatcher(onCapture),
    new CopilotSessionWatcher(onCapture),
  );

  return {
    registerPane(pane: PaneInfo) {
      for (const w of watchers) w.registerPane(pane);
    },
    unregisterPane(paneId: string) {
      for (const w of watchers) w.unregisterPane(paneId);
    },
    start() {
      for (const w of watchers) w.start();
    },
    stop() {
      for (const w of watchers) w.stop();
    },
  };
}
