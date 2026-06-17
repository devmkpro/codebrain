"use strict";

/**
 * Auto-Memory Bridge MCP Handlers
 * Imports Claude Code's native memory files (~/.claude/projects/*/memory/*.md)
 * into Codebrain's SQLite memory store for cross-project knowledge.
 */

const { createAutoMemoryBridge } = require("../../memory/auto-memory-bridge.js");

function createAutoMemoryHandlers(opts) {
  let _bridge = null;

  function getBridge() {
    if (!_bridge) {
      const store = opts.memoryStore;
      if (!store) return null;
      _bridge = createAutoMemoryBridge(store, {
        workspace: "global",
        overwrite: false,
      });
    }
    return _bridge;
  }

  return {
    /**
     * Import ALL Claude Code project memories into Codebrain.
     */
    async memoryImportClaude() {
      try {
        const bridge = getBridge();
        if (!bridge) return { ok: false, error: "Memory store not available" };

        const result = bridge.importAll();
        return {
          ok: true,
          data: {
            imported: result.imported,
            skipped: result.skipped,
            errors: result.errors,
            projects: result.projects,
            message: `Imported ${result.imported} memories from ${result.projects.length} projects (${result.skipped} already existed, ${result.errors} errors)`,
          },
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Get auto-memory bridge status.
     */
    async memoryBridgeStatus() {
      try {
        const bridge = getBridge();
        if (!bridge) return { ok: false, error: "Memory store not available" };

        const result = bridge.status();
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    /**
     * Scan for available Claude Code memory files without importing.
     */
    async memoryScanClaude() {
      try {
        const bridge = getBridge();
        if (!bridge) return { ok: false, error: "Memory store not available" };

        const files = bridge.scanMemoryFiles();
        const grouped = {};
        for (const f of files) {
          if (!grouped[f.projectName]) grouped[f.projectName] = [];
          grouped[f.projectName].push(f.filePath);
        }
        return {
          ok: true,
          data: {
            totalFiles: files.length,
            projects: grouped,
          },
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}

module.exports = { createAutoMemoryHandlers };
