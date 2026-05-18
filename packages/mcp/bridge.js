"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

const { createPaneHandlers } = require("./bridge/pane-handlers.js");
const { createBrowserHandlers } = require("./bridge/browser-handlers.js");
const { createTodoHandlers } = require("./bridge/todo-handlers.js");
const { createMemoryHandlers } = require("./bridge/memory-handlers.js");
const { createSwarmHandlers } = require("./bridge/swarm-handlers.js");
const { createFileHandlers } = require("./bridge/file-handlers.js");
const { createWorkerDispatch } = require("./bridge/worker-dispatch.js");
const { createHooksHandlers } = require("./bridge/hooks-handlers.js");
const { createSkillHandlers } = require("./bridge/skill-handlers.js");

// ── Auto-notify helpers ─────────────────────────────────────────────────────
// When agents make changes (file writes, memory writes), other agents are
// automatically notified via the message bus so they can adapt in real-time.

const MESSAGES_DIR = path.join(os.homedir(), ".codebrain", "messages");

function sendAgentNotification(ptyManager, paneLabels, fromId, content, msgType) {
  if (!ptyManager) return;
  const panes = ptyManager.list();
  const fromLabel = paneLabels.get(fromId) || fromId;
  for (const p of panes) {
    if (p.paneId === fromId) continue; // Don't notify self
    // Write notification file to message bus
    try {
      const inbox = path.join(MESSAGES_DIR, p.paneId);
      if (!fs.existsSync(inbox)) fs.mkdirSync(inbox, { recursive: true });
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const msg = {
        id,
        from: fromId,
        to: p.paneId,
        content: `[AUTO] ${content}`,
        type: msgType,
        timestamp: Date.now(),
        read: false,
      };
      fs.writeFileSync(path.join(inbox, `${id}.json`), JSON.stringify(msg, null, 2), "utf-8");
    } catch {}
  }
}

/**
 * Creates a bridge between MCP server tools and the PtyManager.
 * Composes pane, browser, todo, memory, and swarm handlers into a single bridge object.
 * Wraps fileWrite and memoryWrite with automatic memory recording + agent notifications.
 *
 * @param {import("../../electron/main/pty-manager").PtyManager} ptyManager
 * @param {Object} opts
 */
function createMCPBridge(ptyManager, opts = {}) {
  const paneLabels = new Map();
  const roleMap = new Map();

  // Pass roleMap to pane handlers so it's shared
  const paneHandlers = createPaneHandlers(ptyManager, { ...opts, paneLabels, roleMap });
  // Use the same roleMap instance (paneHandlers creates its own, we override)
  paneHandlers.roleMap = roleMap;

  const browserHandlers = createBrowserHandlers(opts);
  const todoHandlers = createTodoHandlers();
  const memoryHandlers = createMemoryHandlers({ ...opts, paneLabels });
  const swarmHandlers = createSwarmHandlers(ptyManager, { ...opts, paneLabels, roleMap });
  const fileHandlers = createFileHandlers({ ...opts, paneLabels, roleMap, ptyManager });
  const workerDispatch = createWorkerDispatch({ ...opts, paneLabels, roleMap, ptyManager });
  const hooksHandlers = createHooksHandlers({ ...opts, paneLabels, roleMap });
  const skillHandlers = createSkillHandlers({ ...opts, paneLabels, roleMap });

  // ── Wrap fileWrite: auto-record in shared memory + notify agents ────────
  const originalFileWrite = fileHandlers.fileWrite.bind(fileHandlers);
  fileHandlers.fileWrite = async function wrappedFileWrite(args) {
    const result = await originalFileWrite(args);
    if (result?.ok && args.path) {
      const ws = opts.getCurrentWorkspacePath?.() || process.cwd();
      const relPath = path.relative(ws, args.path).replace(/\\/g, "/");
      // Auto-record file change in shared memory (working type)
      try {
        const store = opts.memoryStore;
        if (store) {
          const contentPreview = typeof args.content === "string"
            ? args.content.slice(0, 500)
            : "(binary)";
          store.write({
            type: "working",
            key: `file-changed-${relPath}`,
            content: `File modified: ${relPath}\nSize: ${result.size || 0} bytes\nPreview: ${contentPreview}`,
            tags: ["file-change", "auto"],
            agent_id: "auto-memory",
            workspace: ws,
          });
        }
      } catch {}
      // Fire hook event
      try { opts.hooksManager?.fire?.("file_written", { path: relPath, size: result.size }); } catch {}
      // Notify all other agents about the file change
      sendAgentNotification(
        ptyManager, paneLabels, "system",
        `File changed: ${relPath} (${result.size || 0}B) — search memory for "file-changed-${relPath}" for details`,
        "update"
      );
    }
    return result;
  };

  // ── Wrap memoryWrite: notify agents when significant memory is written ──
  const originalMemoryWrite = memoryHandlers.memoryWrite.bind(memoryHandlers);
  memoryHandlers.memoryWrite = async function wrappedMemoryWrite(args) {
    const result = await originalMemoryWrite(args);
    if (result?.ok && args.key) {
      // Fire hook event
      try { opts.hooksManager?.fire?.("memory_written", { key: args.key, type: args.type, agent_id: args.agent_id }); } catch {}
      // Notify all other agents about the new memory entry
      const typeLabel = args.type || "working";
      sendAgentNotification(
        ptyManager, paneLabels, args.agent_id || "agent",
        `Memory updated: [${typeLabel}] ${args.key} — use memory_search("${args.key}") or memory_read(key="${args.key}")`,
        "update"
      );
    }
    return result;
  };

  return {
    ...paneHandlers,
    ...browserHandlers,
    ...todoHandlers,
    ...memoryHandlers,
    ...swarmHandlers,
    ...fileHandlers,
    ...workerDispatch,
    ...hooksHandlers,
    ...skillHandlers,
    // Override listPanes to pass paneLabels
    async listPanes() {
      return paneHandlers.listPanes(paneLabels);
    },
  };
}

module.exports = { createMCPBridge };
