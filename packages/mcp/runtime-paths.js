"use strict";

/**
 * Shared runtime paths + endpoint discovery for the Codebrain MCP server.
 *
 * Plain CommonJS with **no Electron dependency** — this module is loaded by:
 *   - the Electron main process (via electron/main/services/mcp-runtime.ts)
 *   - the headless daemon (out/main/daemon.js, run with ELECTRON_RUN_AS_NODE=1)
 *   - the stdio entry point (packages/mcp/stdio.js), spawned by Claude Code / VS Code
 *
 * State lives in ~/.codebrain:
 *   mcp-port     → plain text port of the endpoint that is currently listening
 *   daemon.json  → { pid, port, runtime, entry, startedAt } for the headless daemon
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const DEFAULT_MCP_PORT = 61010;
const CODEBRAIN_DIR = path.join(os.homedir(), ".codebrain");
const MCP_PORT_FILE = path.join(CODEBRAIN_DIR, "mcp-port");
const DAEMON_STATE_FILE = path.join(CODEBRAIN_DIR, "daemon.json");
const DAEMON_LOG_FILE = path.join(CODEBRAIN_DIR, "logs", "daemon.log");

function ensureCodebrainDir() {
  try {
    fs.mkdirSync(CODEBRAIN_DIR, { recursive: true });
  } catch {}
  return CODEBRAIN_DIR;
}

// ── Port file ──────────────────────────────────────────────────────────────

function readPortFile() {
  try {
    const raw = fs.readFileSync(MCP_PORT_FILE, "utf-8").trim();
    const port = parseInt(raw, 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function writePortFile(port) {
  try {
    ensureCodebrainDir();
    fs.writeFileSync(MCP_PORT_FILE, String(port), "utf-8");
  } catch {}
}

// ── Daemon state ───────────────────────────────────────────────────────────

function readDaemonState() {
  try {
    const state = JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, "utf-8"));
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

function writeDaemonState(state) {
  try {
    ensureCodebrainDir();
    fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function clearDaemonState() {
  try {
    fs.unlinkSync(DAEMON_STATE_FILE);
  } catch {}
}

/** True when the recorded daemon pid is still alive (signal 0 = existence probe). */
function isDaemonProcessAlive(state) {
  const pid = state?.pid;
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = process exists but is owned by another user — still alive.
    return err.code === "EPERM";
  }
}

// ── Endpoint probing ───────────────────────────────────────────────────────

/**
 * GET /health on a candidate port.
 * Resolves with the parsed health payload, or null when nothing answers.
 */
function probePort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) return done(null);
          try {
            done(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch {
            done(null);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      done(null);
    });
    req.on("error", () => done(null));
  });
}

/**
 * Find the MCP endpoint that is currently listening, if any.
 *
 * Order: the port recorded in ~/.codebrain/mcp-port, then the daemon's
 * recorded port, then the canonical default and its fallback neighbours
 * (server.js walks +1..+3 when the preferred port is taken).
 *
 * @returns {Promise<{ port: number, health: object } | null>}
 */
async function findRunningEndpoint({ timeoutMs = 800 } = {}) {
  const candidates = [];
  const filePort = readPortFile();
  if (filePort) candidates.push(filePort);
  const daemonPort = readDaemonState()?.port;
  if (daemonPort) candidates.push(daemonPort);
  for (let i = 0; i <= 3; i++) candidates.push(DEFAULT_MCP_PORT + i);

  const seen = new Set();
  for (const port of candidates) {
    if (seen.has(port)) continue;
    seen.add(port);
    const health = await probePort(port, timeoutMs);
    if (health?.ok) return { port, health };
  }
  return null;
}

// ── Entry point resolution (no Electron APIs) ──────────────────────────────

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

/**
 * Locate the Electron executable that ships this install.
 *
 * Used by the stdio proxy to spawn the daemon when nothing is listening.
 * Checks, in order: an explicit env override, the recorded daemon runtime,
 * the current process (already Electron), and the install layout relative
 * to this file.
 */
function resolveElectronBinary() {
  const candidates = [process.env.CODEBRAIN_ELECTRON_BIN, readDaemonState()?.runtime];

  // Already running under Electron (main process or ELECTRON_RUN_AS_NODE).
  if (process.versions?.electron) candidates.push(process.execPath);

  // Installed layout: <install>/resources/{app.asar,mcp-stdio}/... → <install>/<binary>
  const here = __dirname;
  const resourcesIdx = here.lastIndexOf(`${path.sep}resources${path.sep}`);
  if (resourcesIdx !== -1) {
    const installDir = here.slice(0, resourcesIdx);
    const names =
      process.platform === "win32"
        ? ["Codebrain.exe", "codebrain.exe"]
        : process.platform === "darwin"
          ? ["Codebrain", "codebrain"]
          : ["codebrain", "Codebrain"];
    for (const name of names) candidates.push(path.join(installDir, name));
    // macOS: <install>/Codebrain.app/Contents/{Resources,MacOS}
    candidates.push(path.join(installDir, "MacOS", "Codebrain"));
  }

  return firstExisting(candidates);
}

/**
 * Absolute path to a packages/mcp/* entry point, resolved from this module's
 * own location. Works from source, from inside app.asar, and from the esbuild
 * bundle in resources/mcp-stdio (which falls back to the asar copy).
 */
function resolveMcpEntry(fileName) {
  const local = path.join(__dirname, fileName);
  if (fs.existsSync(local)) return local;

  // Bundled at <install>/resources/mcp-stdio/stdio.cjs → look inside the asar.
  const resourcesIdx = __dirname.lastIndexOf(`${path.sep}resources${path.sep}`);
  if (resourcesIdx !== -1) {
    const resourcesDir = __dirname.slice(0, resourcesIdx) + path.sep + "resources";
    return firstExisting([
      path.join(resourcesDir, "app.asar", "packages", "mcp", fileName),
      path.join(resourcesDir, "app.asar.unpacked", "packages", "mcp", fileName),
    ]);
  }
  return null;
}

/** Absolute path to the headless daemon entry (out/main/daemon.js). */
function resolveDaemonEntry() {
  const roots = [];
  // packages/mcp/... → repo root or asar root is two levels up.
  roots.push(path.resolve(__dirname, "..", ".."));

  const resourcesIdx = __dirname.lastIndexOf(`${path.sep}resources${path.sep}`);
  if (resourcesIdx !== -1) {
    const resourcesDir = __dirname.slice(0, resourcesIdx) + path.sep + "resources";
    roots.push(path.join(resourcesDir, "app.asar"));
    roots.push(path.join(resourcesDir, "app.asar.unpacked"));
  }

  return firstExisting(roots.map((root) => path.join(root, "out", "main", "daemon.js")));
}

module.exports = {
  DEFAULT_MCP_PORT,
  CODEBRAIN_DIR,
  MCP_PORT_FILE,
  DAEMON_STATE_FILE,
  DAEMON_LOG_FILE,
  ensureCodebrainDir,
  readPortFile,
  writePortFile,
  readDaemonState,
  writeDaemonState,
  clearDaemonState,
  isDaemonProcessAlive,
  probePort,
  findRunningEndpoint,
  resolveElectronBinary,
  resolveMcpEntry,
  resolveDaemonEntry,
  firstExisting,
};
