"use strict";

/**
 * Remote Spawn Handlers — SSH:// spawn routing for remote hosts.
 *
 * Parses workspace refs like ssh://host/path, probes the remote host for agent CLIs,
 * and hard-fails when the CLI is absent. Validates host aliases (no shell-meta injection).
 * Probes use `ssh -o BatchMode=yes` so password-only hosts fail fast.
 *
 * Ported from Overclock sidecar: remoteSpawn.js
 * Adapted to Codebrain's CommonJS + MCP bridge architecture.
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const KNOWN_CLIS = ["claude", "codex", "gemini"];

/**
 * Shell-quote a value for safe embedding in remote commands.
 */
function shQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate that a host alias contains only safe characters (no shell-meta injection).
 */
function isSafeAlias(alias) {
  return /^[A-Za-z0-9._-]+$/.test(alias) && !alias.startsWith("-");
}

/**
 * Parse ssh:// URL into { host, path }.
 * Returns null if not a valid ssh:// URL.
 */
function parseSshUrl(workspaceRef) {
  if (!workspaceRef || !workspaceRef.startsWith("ssh://")) return null;
  try {
    const url = new URL(workspaceRef);
    return { host: url.hostname, path: url.pathname || "/" };
  } catch {
    return null;
  }
}

/**
 * Detect which agent CLIs are available on a remote host.
 * Returns a Set of CLI names (e.g. "claude", "codex", "gemini").
 */
async function detectRemoteClis(hostAlias) {
  if (!isSafeAlias(hostAlias)) return new Set();

  const script = [
    'for pair in "claude claude" "codex codex" "gemini gemini"; do',
    '  name=${pair%% *}',
    '  binary=${pair#* }',
    '  path=$(command -v "$binary" 2>/dev/null || true)',
    '  if [ -n "$path" ]; then printf "%s\\t%s\\n" "$name" "$path"; fi',
    "done",
  ].join("\n");

  const remoteCommand = `SHELL_PATH="\${SHELL:-/bin/sh}"; exec "$SHELL_PATH" -lc ${shQuote(script)}`;

  try {
    const result = await execFileAsync("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      hostAlias,
      remoteCommand,
    ], { encoding: "utf8", timeout: 10_000, maxBuffer: 128_000 });

    const found = new Set();
    for (const line of (result.stdout || "").split(/\r?\n/)) {
      const name = line.split("\t")[0];
      if (KNOWN_CLIS.includes(name)) found.add(name);
    }
    return found;
  } catch {
    return new Set();
  }
}

/**
 * Probe a remote host to verify SSH connectivity.
 * Returns { reachable, latencyMs } or { reachable: false, error }.
 */
async function probeRemoteHost(hostAlias) {
  if (!isSafeAlias(hostAlias)) return { reachable: false, error: "invalid host alias" };

  const start = Date.now();
  try {
    await execFileAsync("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      hostAlias,
      "echo ok",
    ], { encoding: "utf8", timeout: 10_000 });
    return { reachable: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

// ─── Bridge Handlers ────────────────────────────────────────────────────────

/**
 * Creates remote spawn handlers for the MCP bridge.
 *
 * @param {Object} opts
 * @param {Object} opts.ptyManager - PtyManager (for spawn routing)
 * @param {Function} [opts.spawnPaneFn] - Function to spawn a pane
 */
function createRemoteSpawnHandlers(opts) {
  return {
    /**
     * Detect which agent CLIs are available on a remote host.
     * Returns list of found CLIs and their paths.
     */
    async remoteSpawnDetectClis({ host }) {
      if (!host) return { ok: false, error: "host is required" };
      if (!isSafeAlias(host)) return { ok: false, error: "invalid host alias (only alphanumeric, dots, hyphens allowed)" };

      const clis = await detectRemoteClis(host);
      return {
        ok: true,
        data: {
          host,
          clis: [...clis],
          available: clis.size > 0,
        },
      };
    },

    /**
     * Probe SSH connectivity to a remote host.
     */
    async remoteSpawnProbe({ host }) {
      if (!host) return { ok: false, error: "host is required" };
      if (!isSafeAlias(host)) return { ok: false, error: "invalid host alias" };

      const result = await probeRemoteHost(host);
      return { ok: true, data: { host, ...result } };
    },

    /**
     * Parse an ssh:// workspace reference into host + path.
     */
    async remoteSpawnParseRef({ ref }) {
      if (!ref) return { ok: false, error: "ref is required" };
      const parsed = parseSshUrl(ref);
      if (!parsed) return { ok: false, error: "not a valid ssh:// URL" };
      return { ok: true, data: parsed };
    },
  };
}

module.exports = { createRemoteSpawnHandlers, detectRemoteClis, probeRemoteHost, parseSshUrl, shQuote, isSafeAlias };
