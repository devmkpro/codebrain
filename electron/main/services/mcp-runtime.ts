import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const runtimePaths = require("../../packages/mcp/runtime-paths.js");

export interface StdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export const DEFAULT_MCP_PORT: number = runtimePaths.DEFAULT_MCP_PORT;

function firstExisting(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

/**
 * Resolve an entry point that ships with the app.
 *
 * `app.getAppPath()` is the repo root in dev and `<resources>/app.asar` when
 * packaged — Electron reads inside the asar transparently, both here and in a
 * child process started with ELECTRON_RUN_AS_NODE=1 (verified on all three
 * platforms), so the asar copy is the preferred target: it can resolve
 * `better-sqlite3` and `@lydell/node-pty` from app.asar.unpacked with the
 * correct ABI. The standalone esbuild bundle in resources/mcp-stdio has no
 * node_modules next to it, so its native modules never load — it stays as a
 * last-resort fallback for a plain-`node` runtime.
 */
function resolveEntry(relativeFromRoot: string, bundledFallback?: string): string | null {
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath;
  return firstExisting([
    path.join(appPath, relativeFromRoot),
    resourcesPath ? path.join(resourcesPath, "app.asar", relativeFromRoot) : null,
    resourcesPath ? path.join(resourcesPath, "app.asar.unpacked", relativeFromRoot) : null,
    bundledFallback ? path.join(appPath, bundledFallback) : null,
    bundledFallback && resourcesPath ? path.join(resourcesPath, bundledFallback) : null,
  ]);
}

/** Absolute path to the MCP stdio entry point. */
export function resolveStdioEntry(): string | null {
  return resolveEntry(
    path.join("packages", "mcp", "stdio.js"),
    path.join("resources", "mcp-stdio", "stdio.cjs")
  );
}

/** Absolute path to the headless daemon entry point (built by electron-vite). */
export function resolveDaemonEntry(): string | null {
  return resolveEntry(path.join("out", "main", "daemon.js"));
}

/**
 * The stdio MCP server config written into every integration file
 * (.mcp.json, ~/.claude.json, .vscode/mcp.json, …).
 *
 * Uses this install's own Electron binary as the Node runtime, so the config
 * keeps working on machines with no system Node.js — the #1 reason MCP failed
 * to connect on Linux — and native modules load with a matching ABI.
 */
export function buildStdioServerConfig(): StdioServerConfig {
  const entry = resolveStdioEntry();
  const electronBin = process.execPath;

  if (entry && electronBin && fs.existsSync(electronBin)) {
    return {
      command: electronBin,
      args: [entry],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  // Degraded fallback: system Node.js + the standalone bundle.
  const bundled = firstExisting([
    process.resourcesPath ? path.join(process.resourcesPath, "mcp-stdio", "stdio.cjs") : null,
    path.join(app.getAppPath(), "resources", "mcp-stdio", "stdio.cjs"),
  ]);
  return { command: "node", args: [bundled ?? entry ?? ""] };
}

/** True when `cfg` already matches what buildStdioServerConfig() would write. */
export function isStdioConfigCurrent(cfg: unknown): boolean {
  const desired = buildStdioServerConfig();
  const actual = cfg as Partial<StdioServerConfig> | undefined;
  if (!actual || actual.command !== desired.command) return false;
  if (!Array.isArray(actual.args) || actual.args[0] !== desired.args[0]) return false;
  const desiredRunAsNode = desired.env?.ELECTRON_RUN_AS_NODE;
  const actualRunAsNode = (actual.env as Record<string, string> | undefined)?.ELECTRON_RUN_AS_NODE;
  return desiredRunAsNode === actualRunAsNode;
}

// ── Headless daemon control ────────────────────────────────────────────────

export interface DaemonState {
  pid: number;
  port: number;
  runtime: string;
  entry: string;
  startedAt: string;
}

export function readDaemonState(): DaemonState | null {
  return runtimePaths.readDaemonState();
}

/** Health-probe whatever is listening (daemon or a running app). */
export async function findRunningEndpoint(): Promise<{ port: number; health: any } | null> {
  return runtimePaths.findRunningEndpoint();
}

/**
 * Start the headless MCP daemon detached from this process, so it survives
 * the app quitting. Returns null when the daemon entry can't be located.
 */
export function spawnDaemon(opts: { port?: number; workspace?: string } = {}): { pid: number } | null {
  const entry = resolveDaemonEntry();
  if (!entry) {
    console.warn("[mcp-runtime] Daemon entry not found — cannot start headless server");
    return null;
  }
  const args = [entry];
  if (opts.port) args.push("--port", String(opts.port));
  if (opts.workspace) args.push("--workspace", opts.workspace);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CODEBRAIN_MANAGED_SIGNALS: "1",
      CODEBRAIN_DATA_DIR: runtimePaths.CODEBRAIN_DIR,
      ELECTRON_RUN_AS_NODE: "1",
    },
  });
  child.unref();
  console.log(`[mcp-runtime] Headless MCP daemon started (pid ${child.pid})`);
  return { pid: child.pid! };
}

/**
 * Ask a running daemon to exit so the app can take over the canonical port.
 * Resolves true once the port is free (or was never held by a daemon).
 */
export async function stopDaemon(timeoutMs = 5000): Promise<boolean> {
  const state = readDaemonState();
  if (!state || !runtimePaths.isDaemonProcessAlive(state)) {
    runtimePaths.clearDaemonState();
    return true;
  }

  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    runtimePaths.clearDaemonState();
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    if (!runtimePaths.isDaemonProcessAlive(state)) {
      runtimePaths.clearDaemonState();
      console.log(`[mcp-runtime] Daemon (pid ${state.pid}) stopped — app takes over port ${state.port}`);
      return true;
    }
  }

  // Still alive after SIGTERM — force it, the port must be free for the app.
  try {
    process.kill(state.pid, "SIGKILL");
  } catch {}
  runtimePaths.clearDaemonState();
  return true;
}
