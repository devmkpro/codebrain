/**
 * Feature 8: Per-pane token tracking with SQLite persistence.
 * Stores token usage per pane so costs survive app restarts.
 */

import Database from "better-sqlite3";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import log from "electron-log/main.js";

export interface TokenRow {
  paneId: string;
  workspacePath: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  firstSeen: number;
  lastSeen: number;
}

const DB_PATH = path.join(os.homedir(), ".codebrain", "token-tracker.db");

export class TokenTracker {
  private db: Database.Database;
  private insertStmt!: Database.Statement;
  private aggByPaneStmt!: Database.Statement;
  private aggByWorkspaceStmt!: Database.Statement;

  constructor(dbPath = DB_PATH) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pane_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pane_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL DEFAULT '',
        ts INTEGER NOT NULL,
        input INTEGER NOT NULL DEFAULT 0,
        output INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0,
        cache_write INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_pane_tokens_pane_id ON pane_tokens(pane_id);
      CREATE INDEX IF NOT EXISTS idx_pane_tokens_workspace ON pane_tokens(workspace_path, ts);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO pane_tokens (pane_id, workspace_path, ts, input, output, cache_read, cache_write, cost_usd)
      VALUES (@paneId, @workspacePath, @ts, @input, @output, @cacheRead, @cacheWrite, @costUsd)
    `);

    this.aggByPaneStmt = this.db.prepare(`
      SELECT
        pane_id,
        workspace_path,
        SUM(input) as inputTokens,
        SUM(output) as outputTokens,
        SUM(cache_read) as cacheRead,
        SUM(cache_write) as cacheWrite,
        SUM(cost_usd) as costUsd,
        MIN(ts) as firstSeen,
        MAX(ts) as lastSeen
      FROM pane_tokens
      WHERE pane_id = @paneId
      GROUP BY pane_id
    `);

    this.aggByWorkspaceStmt = this.db.prepare(`
      SELECT
        pane_id,
        workspace_path,
        SUM(input) as inputTokens,
        SUM(output) as outputTokens,
        SUM(cache_read) as cacheRead,
        SUM(cache_write) as cacheWrite,
        SUM(cost_usd) as costUsd,
        MIN(ts) as firstSeen,
        MAX(ts) as lastSeen
      FROM pane_tokens
      WHERE workspace_path = @workspacePath AND ts >= @sinceMs
      GROUP BY pane_id
    `);

    log.info("[token-tracker] initialized at", dbPath);
  }

  recordTokens(
    paneId: string,
    input: number,
    output: number,
    cacheRead = 0,
    cacheWrite = 0,
    costUsd = 0,
    workspacePath = ""
  ): void {
    try {
      this.insertStmt.run({ paneId, workspacePath, ts: Date.now(), input, output, cacheRead, cacheWrite, costUsd });
    } catch (e: any) {
      log.warn("[token-tracker] recordTokens error:", e.message);
    }
  }

  aggregateByPane(paneId: string): TokenRow | null {
    try {
      const row = this.aggByPaneStmt.get({ paneId }) as any;
      if (!row) return null;
      return {
        paneId: row.pane_id,
        workspacePath: row.workspace_path,
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        cacheRead: row.cacheRead ?? 0,
        cacheWrite: row.cacheWrite ?? 0,
        costUsd: row.costUsd ?? 0,
        firstSeen: row.firstSeen ?? 0,
        lastSeen: row.lastSeen ?? 0,
      };
    } catch (e: any) {
      log.warn("[token-tracker] aggregateByPane error:", e.message);
      return null;
    }
  }

  aggregateByWorkspace(workspacePath: string, sinceMs = 0): TokenRow[] {
    try {
      const rows = this.aggByWorkspaceStmt.all({ workspacePath, sinceMs }) as any[];
      return rows.map((row) => ({
        paneId: row.pane_id,
        workspacePath: row.workspace_path,
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        cacheRead: row.cacheRead ?? 0,
        cacheWrite: row.cacheWrite ?? 0,
        costUsd: row.costUsd ?? 0,
        firstSeen: row.firstSeen ?? 0,
        lastSeen: row.lastSeen ?? 0,
      }));
    } catch (e: any) {
      log.warn("[token-tracker] aggregateByWorkspace error:", e.message);
      return [];
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch { /* ignore */ }
  }
}

// Singleton
let _instance: TokenTracker | null = null;
export function getTokenTracker(): TokenTracker {
  if (!_instance) _instance = new TokenTracker();
  return _instance;
}
