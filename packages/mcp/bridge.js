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

// ── New multi-agent features ────────────────────────────────────────────────
const { MessageBus } = require("./bridge/message-bus.js");
const { AgentScorer } = require("./bridge/agent-scorer.js");
const { createPipelineHandlers } = require("./bridge/pipeline-handlers.js");
const { WorkerManager } = require("./bridge/background-workers.js");
const { createBackgroundWorkerHandlers } = require("./bridge/worker-handlers.js");
const { createConsensusHandlers } = require("./bridge/consensus-handlers.js");
const { CostTracker } = require("./bridge/cost-tracker.js");
const { createExpandedHooksHandlers } = require("./bridge/hooks-expand-handlers.js");
const { parseTokenUsage } = require("./bridge/token-parser.js");

// ── Auto-notify helpers ─────────────────────────────────────────────────────
// When agents make changes (file writes, memory writes), other agents are
// automatically notified via the message bus so they can adapt in real-time.

const MESSAGES_DIR = path.join(os.homedir(), ".codebrain", "messages");

function sendAgentNotification(ptyManager, paneLabels, fromId, content, msgType, messageBus) {
  if (!ptyManager) return;
  const panes = ptyManager.list();
  for (const p of panes) {
    if (p.paneId === fromId) continue; // Don't notify self
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
    // Send to in-memory bus
    if (messageBus) {
      try { messageBus.send(p.paneId, { ...msg, priority: "normal" }); } catch {}
    }
    // Also write to disk (file fallback)
    try {
      const inbox = path.join(MESSAGES_DIR, p.paneId);
      if (!fs.existsSync(inbox)) fs.mkdirSync(inbox, { recursive: true });
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

  // ── Create foundational instances ────────────────────────────────────────
  const messageBus = new MessageBus({
    ackTimeout: opts.messageBusAckTimeout || 5000,
    maxRetries: opts.messageBusMaxRetries || 3,
    ttl: opts.messageBusTTL || 30000,
  });

  const agentScorer = new AgentScorer({
    ptyManager,
    roleMap,
    paneLabels,
    memoryStore: opts.memoryStore,
    providerHealth: opts.providerHealth,
  });

  const workerManager = new WorkerManager({
    ptyManager,
    memoryStore: opts.memoryStore,
    hooksManager: opts.hooksManager,
    messageBus,
    getCurrentWorkspacePath: opts.getCurrentWorkspacePath,
    dataDir: opts.dataDir || path.join(os.homedir(), ".codebrain"),
  });

  const costTracker = opts.costTracker || new CostTracker({
    dataDir: opts.dataDir || path.join(os.homedir(), ".codebrain"),
    defaultBudget: opts.defaultBudget || null,
    alertThreshold: opts.alertThreshold || 0.8,
  });

  // ── Auto-parse token usage from PTY output on idle ───────────────────────
  ptyManager.on("idle", ({ paneId, idle }) => {
    try {
      const lastOutput = idle?.lastOutput;
      if (!lastOutput || lastOutput.length === 0) return;
      const usage = parseTokenUsage(lastOutput);
      if (!usage) return;
      // Get pane config for metadata
      const paneCfg = opts.paneConfigs?.get?.(paneId);
      const workspace = opts.getCurrentWorkspacePath?.() || process.cwd();
      costTracker.recordUsage({
        model: usage.model || paneCfg?.model || "unknown",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        agentId: paneCfg?.agent || paneId,
        workspace,
        taskId: paneCfg?.taskId,
      });
    } catch {}
  });

  // ── Create handler factories ─────────────────────────────────────────────
  const sharedOpts = { ...opts, paneLabels, roleMap, messageBus, agentScorer };
  const paneHandlers = createPaneHandlers(ptyManager, sharedOpts);
  paneHandlers.roleMap = roleMap;

  const browserHandlers = createBrowserHandlers(opts);
  const todoHandlers = createTodoHandlers();
  const memoryHandlers = createMemoryHandlers({ ...opts, paneLabels });
  const swarmHandlers = createSwarmHandlers(ptyManager, { ...opts, paneLabels, roleMap, agentScorer });
  const fileHandlers = createFileHandlers({ ...opts, paneLabels, roleMap, ptyManager });
  const workerDispatch = createWorkerDispatch({ ...opts, paneLabels, roleMap, ptyManager });
  const hooksHandlers = createHooksHandlers({ ...opts, paneLabels, roleMap });
  const skillHandlers = createSkillHandlers({ ...opts, paneLabels, roleMap });
  const pipelineHandlers = createPipelineHandlers(sharedOpts);
  const bgWorkerHandlers = createBackgroundWorkerHandlers({ workerManager });
  const consensusHandlers = createConsensusHandlers({ ...sharedOpts, workerManager });
  const expandedHooksHandlers = createExpandedHooksHandlers({ ...opts, paneLabels, roleMap });

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
    ...pipelineHandlers,
    ...bgWorkerHandlers,
    ...consensusHandlers,
    ...expandedHooksHandlers,
    // Expose foundational instances
    messageBus,
    agentScorer,
    costTracker,
    workerManager,
    // Override listPanes to pass paneLabels
    async listPanes() {
      return paneHandlers.listPanes(paneLabels);
    },
  };
}

module.exports = { createMCPBridge };
