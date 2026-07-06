/**
 * register-tokens.ts
 * IPC handlers for reading real token counts from Claude Code session files.
 * Session files live in ~/.claude/projects/<workspace-hash>/<session>.jsonl
 * Each line can contain: usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_write_input_tokens }
 */

import { ipcMain } from "electron";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import type { AppContext } from "../context";

// ── Cost table (per 1M tokens, USD) — mirrors cost-tracker.js ───────────────
const MODEL_COSTS: Record<string, { input: number; output: number; cache_read?: number; cache_write?: number }> = {
  // Anthropic Claude
  "claude-opus-4-8": { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 1.25 },
  "claude-opus-4-7": { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 1.25 },
  "claude-opus-4-6": { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 1.25 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 0.375 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 0.125 },
  // aliases used in session files
  "claude-4.8-opus": { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 1.25 },
  "claude-4.7-opus": { input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 1.25 },
  "claude-4.6-sonnet": { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 0.375 },
  "claude-4.5-haiku": { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 0.125 },
  // Gemini
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  // Fallback
  "default": { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 0.375 },
};

function getCosts(model?: string) {
  if (!model) return MODEL_COSTS["default"];
  // Try exact match
  if (MODEL_COSTS[model]) return MODEL_COSTS[model];
  // Try prefix match
  for (const key of Object.keys(MODEL_COSTS)) {
    if (model.startsWith(key) || key.startsWith(model)) return MODEL_COSTS[key];
  }
  return MODEL_COSTS["default"];
}

export interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
}

function calcCostUsd(counts: Omit<TokenCounts, "cost_usd">, model?: string): number {
  const costs = getCosts(model);
  const PER_M = 1_000_000;
  return (
    (counts.input / PER_M) * costs.input +
    (counts.output / PER_M) * costs.output +
    (counts.cache_read / PER_M) * (costs.cache_read ?? 0) +
    (counts.cache_write / PER_M) * (costs.cache_write ?? 0)
  );
}

// ── Session file discovery ───────────────────────────────────────────────────

/**
 * Returns the ~/.claude/projects directory.
 */
function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Lists all JSONL session files for a given workspace path.
 * Claude Code encodes the workspace path as a URL-safe slug in the directory name.
 */
function findSessionFiles(workspacePath: string): string[] {
  const projectsDir = claudeProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  // Claude uses the workspace path encoded: replaces / with - and trims leading -
  const encoded = workspacePath.replace(/[/\\:]/g, "-").replace(/^-+/, "");

  const results: string[] = [];
  try {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      // Match either exact or contains (Claude may add prefix/suffix)
      if (dir === encoded || dir.includes(encoded) || encoded.includes(dir.replace(/^-/, ""))) {
        const fullDir = path.join(projectsDir, dir);
        try {
          const files = fs.readdirSync(fullDir).filter(f => f.endsWith(".jsonl"));
          for (const file of files) {
            results.push(path.join(fullDir, file));
          }
        } catch {}
      }
    }
  } catch {}
  return results;
}

/**
 * Read tokens from a single JSONL session file.
 */
async function readSessionTokens(filePath: string): Promise<{ counts: Omit<TokenCounts, "cost_usd">; model?: string }> {
  const counts = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let model: string | undefined;

  try {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        // Capture model from message entries
        if (obj.message?.model) model = obj.message.model;
        if (obj.model) model = obj.model;
        // Sum usage
        const usage = obj.message?.usage ?? obj.usage;
        if (usage) {
          counts.input += usage.input_tokens ?? 0;
          counts.output += usage.output_tokens ?? 0;
          counts.cache_read += usage.cache_read_input_tokens ?? 0;
          counts.cache_write += usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens ?? 0;
        }
      } catch {}
    }
    stream.destroy();
  } catch {}

  return { counts, model };
}

/**
 * Get a pane's workspace path from the pane config or current workspace.
 */
function getPaneWorkspace(ctx: AppContext, paneId: string): string {
  const cfg = ctx.paneConfigs.get(paneId);
  return cfg?.cwd ?? ctx.currentWorkspacePath ?? os.homedir();
}

/**
 * Get the Claude session ID associated with a pane (stored in paneConfigs or registry).
 */
function getPaneSessionId(ctx: AppContext, paneId: string): string | undefined {
  const cfg = ctx.paneConfigs.get(paneId);
  return (cfg as any)?.claudeSessionId;
}

// ── Aggregate tokens from session files ─────────────────────────────────────

async function aggregateTokensForWorkspace(
  workspacePath: string,
  sessionIdFilter?: string,
): Promise<TokenCounts> {
  const sessionFiles = findSessionFiles(workspacePath);
  const totals = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let model: string | undefined;

  for (const file of sessionFiles) {
    // If sessionIdFilter provided, only include matching session file
    if (sessionIdFilter) {
      const fileName = path.basename(file, ".jsonl");
      if (!fileName.includes(sessionIdFilter) && sessionIdFilter !== fileName) continue;
    }
    const { counts, model: m } = await readSessionTokens(file);
    totals.input += counts.input;
    totals.output += counts.output;
    totals.cache_read += counts.cache_read;
    totals.cache_write += counts.cache_write;
    if (m && !model) model = m;
  }

  const cost_usd = calcCostUsd(totals, model);
  return { ...totals, cost_usd };
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

export function registerTokenHandlers(ctx: AppContext): void {
  /**
   * tokens:byPane — returns token counts + USD cost for a single pane
   */
  ipcMain.handle("tokens:byPane", async (_event, { paneId }: { paneId: string }) => {
    try {
      const workspacePath = getPaneWorkspace(ctx, paneId);
      const sessionId = getPaneSessionId(ctx, paneId);
      const data = await aggregateTokensForWorkspace(workspacePath, sessionId);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  /**
   * tokens:byMission — aggregates tokens across all paneIds for a mission
   */
  ipcMain.handle(
    "tokens:byMission",
    async (_event, { missionId: _missionId, paneIds }: { missionId: string; paneIds: string[] }) => {
      try {
        const totals = { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0 };

        for (const paneId of paneIds) {
          const workspacePath = getPaneWorkspace(ctx, paneId);
          const sessionId = getPaneSessionId(ctx, paneId);
          const data = await aggregateTokensForWorkspace(workspacePath, sessionId);
          totals.input += data.input;
          totals.output += data.output;
          totals.cache_read += data.cache_read;
          totals.cache_write += data.cache_write;
          totals.cost_usd += data.cost_usd;
        }

        return { ok: true, data: totals };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
