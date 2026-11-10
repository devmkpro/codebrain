"use strict";

const os = require("node:os");
const { createFileOps } = require("./file-ops.js");

/** File operations share one access policy, encoding layer and bounded output. */
function createFileHandlers(opts = {}) {
  const ops = createFileOps(opts);
  return {
    fileRead: ops.read,
    fileWrite: ops.write,
    fileSearch: ops.search,
    fileBudgetedRead: ops.budgetedRead,

    async systemInfo() {
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
        workspace: ops.workspace(),
        homeDir: os.homedir(),
        currentTime: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        shell: process.platform === "win32" ? (process.env.COMSPEC || "cmd.exe") : (process.env.SHELL || "/bin/bash"),
        availableClis: [...(opts.getAvailableClis?.() || [])].map(id => ({
          id, installed: true, authentication: "not_verified",
        })),
      };
    },

    async systemDiagnostics() {
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
          byStatus: panes.reduce((acc, pane) => {
            acc[pane.status || "unknown"] = (acc[pane.status || "unknown"] || 0) + 1;
            return acc;
          }, {}),
          details: panes.map(pane => ({
            paneId: pane.paneId,
            agent: pane.agent,
            role: roleMap.get(pane.paneId) || "worker",
            label: paneLabels.get(pane.paneId) || pane.agent,
            status: pane.status || "unknown",
          })),
        },
        mcp: { memoryStoreReady: !!opts.memoryStore },
      };
    },
  };
}

module.exports = { createFileHandlers };
