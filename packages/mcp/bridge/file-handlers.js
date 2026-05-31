"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * File and system bridge handlers for MCP tools.
 * Provides structured file access and system diagnostics.
 * Enforces workspace access mode sandbox (read_external / write_external).
 */
function createFileHandlers(opts) {
  function getWorkspace() {
    return opts.getCurrentWorkspacePath?.() || process.cwd();
  }

  function isWithinWorkspace(filePath, ws) {
    const resolved = path.resolve(filePath);
    return resolved === ws || resolved.startsWith(ws + path.sep);
  }

  function resolveSafe(filePath) {
    const ws = getWorkspace();
    const resolved = path.resolve(ws, filePath);
    // Prevent path traversal outside workspace AND outside home
    if (!isWithinWorkspace(resolved, ws) && !resolved.startsWith(os.homedir())) {
      throw new Error("Path traversal not allowed: " + filePath);
    }
    return resolved;
  }

  /**
   * Enforce workspace access mode for operations outside the workspace root.
   * @param {string} fullPath - resolved absolute path
   * @param {"read"|"write"} kind - operation type
   * @throws {Error} if access is denied by workspace policy
   */
  function enforceAccessMode(fullPath, kind) {
    const ws = getWorkspace();
    // Always allow operations inside the workspace
    if (isWithinWorkspace(fullPath, ws)) return;

    // Outside workspace — check access mode
    const store = opts.workspaceConfigStore;
    if (!store) return; // No store available (CLI/stdio mode) — allow

    const mode = store.getAccessMode(ws);
    // Both modes allow reading outside; only write_external allows writing outside
    if (kind === "read") return; // read_external and write_external both allow reads

    // kind === "write" — only write_external allows
    if (mode !== "write_external") {
      throw new Error(
        "workspace access denied: write_external required to edit files outside the workspace. " +
        `File: ${fullPath}. Current mode: ${mode}. ` +
        "Ask the user to change workspace access mode in settings."
      );
    }
  }

  return {
    /**
     * Read a file from the workspace.
     */
    async fileRead({ path: filePath, encoding }) {
      try {
        const fullPath = resolveSafe(filePath);
        enforceAccessMode(fullPath, "read");
        if (!fs.existsSync(fullPath)) return { ok: false, error: "file not found" };
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const entries = fs.readdirSync(fullPath, { withFileTypes: true });
          return {
            ok: true,
            directory: true,
            entries: entries.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "directory" : "file",
            })),
          };
        }
        // Limit to 100KB to avoid huge reads
        if (stat.size > 100 * 1024) {
          const fd = fs.openSync(fullPath, "r");
          const buf = Buffer.alloc(100 * 1024);
          fs.readSync(fd, buf, 0, 100 * 1024, 0);
          fs.closeSync(fd);
          return {
            ok: true,
            content: buf.toString(encoding || "utf-8"),
            truncated: true,
            totalSize: stat.size,
          };
        }
        const content = fs.readFileSync(fullPath, encoding || "utf-8");
        return { ok: true, content, size: stat.size };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Write a file to the workspace.
     */
    async fileWrite({ path: filePath, content, encoding, createDirs }) {
      try {
        const fullPath = resolveSafe(filePath);
        enforceAccessMode(fullPath, "write");
        if (createDirs) {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, encoding || "utf-8");
        return { ok: true, path: fullPath, size: Buffer.byteLength(content, encoding || "utf-8") };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Search for files by glob pattern or content.
     */
    async fileSearch({ pattern, content, path: searchPath, limit }) {
      try {
        const basePath = searchPath ? resolveSafe(searchPath) : getWorkspace();
        enforceAccessMode(basePath, "read");
        const maxResults = limit || 20;
        const results = [];

        function walkDir(dir, depth) {
          if (depth > 5 || results.length >= maxResults) return;
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (results.length >= maxResults) break;
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".git") continue;

            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(basePath, fullPath);

            if (entry.isDirectory()) {
              walkDir(fullPath, depth + 1);
            } else {
              // Pattern matching (simple glob: * and **)
              let matchesPattern = true;
              if (pattern) {
                const regexStr = pattern
                  .replace(/\./g, "\\.")
                  .replace(/\*\*/g, "___DOUBLESTAR___")
                  .replace(/\*/g, "[^/]*")
                  .replace(/___DOUBLESTAR___/g, ".*")
                  .replace(/\?/g, ".");
                matchesPattern = new RegExp(`^${regexStr}$`, "i").test(relPath) ||
                                 new RegExp(`^${regexStr}$`, "i").test(entry.name);
              }

              // Content matching
              let matchesContent = true;
              if (content && matchesPattern) {
                try {
                  const stat = fs.statSync(fullPath);
                  if (stat.size > 500 * 1024) { matchesContent = false; }
                  else {
                    const fileContent = fs.readFileSync(fullPath, "utf-8");
                    matchesContent = fileContent.includes(content);
                  }
                } catch {
                  matchesContent = false;
                }
              }

              if (matchesPattern && matchesContent) {
                results.push({ path: relPath, fullPath, name: entry.name });
              }
            }
          }
        }

        walkDir(basePath, 0);
        return { ok: true, results, count: results.length };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Get system information.
     */
    async systemInfo() {
      const os = require("os");
      return {
        ok: true,
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        nodeVersion: process.version,
        workspace: getWorkspace(),
        homeDir: os.homedir(),
      };
    },

    /**
     * Get diagnostics: pane health, MCP status, provider status.
     */
    async systemDiagnostics() {
      const os = require("os");
      const panes = opts.ptyManager?.list?.() || [];
      const roleMap = opts.roleMap || new Map();
      const paneLabels = opts.paneLabels || new Map();

      return {
        ok: true,
        system: {
          platform: os.platform(),
          freeMemory: os.freemem(),
          totalMemory: os.totalmem(),
          memoryUsagePct: Math.round((1 - os.freemem() / os.totalmem()) * 100),
          uptime: os.uptime(),
        },
        panes: {
          total: panes.length,
          byStatus: panes.reduce((acc, p) => {
            acc[p.status || "unknown"] = (acc[p.status || "unknown"] || 0) + 1;
            return acc;
          }, {}),
          details: panes.map((p) => ({
            paneId: p.paneId,
            agent: p.agent,
            role: roleMap.get(p.paneId) || "worker",
            label: paneLabels.get(p.paneId) || p.agent,
            status: p.status || "unknown",
          })),
        },
        mcp: {
          memoryStoreReady: !!opts.memoryStore,
        },
      };
    },
  };
}

module.exports = { createFileHandlers };
