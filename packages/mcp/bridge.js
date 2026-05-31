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
const { createKanbanHandlers } = require("./bridge/kanban-handlers.js");
const { createMissionHandlers } = require("./bridge/mission-handlers.js");

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

function sendAgentNotification(ptyManager, paneLabels, fromId, content, msgType, messageBus, workspacePath) {
  if (!ptyManager) return;
  const panes = ptyManager.list();
  for (const p of panes) {
    if (p.paneId === fromId) continue; // Don't notify self
    // Workspace scoping: only notify panes in the same workspace
    if (workspacePath) {
      const paneWorkspace = p.workspacePath || p.cwd || "";
      if (paneWorkspace && path.resolve(paneWorkspace) !== path.resolve(workspacePath)) {
        continue; // Skip panes in different workspaces
      }
    }
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
    // Auto-notifications stay file-based; agents discover them via memory_search protocol.
    // Explicit pane_send_message calls get PTY injection via index.js.
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

  // ── Memory compliance tracking per pane ──────────────────────────────────
  // Tracks which panes have used memory tools (read/write/search) and which
  // have been warned about non-compliance. This is code-level enforcement.
  const paneMemoryState = new Map();
  opts.paneMemoryState = paneMemoryState;

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

  // ── Code-level memory compliance enforcement on idle ─────────────────────
  // When a pane goes idle, check if it actually used memory tools during its
  // task. If not, inject a compliance warning. This is enforced in code —
  // the AI CANNOT skip memory usage without being warned.
  ptyManager.on("idle", ({ paneId, idle }) => {
    try {
      const state = paneMemoryState.get(paneId);
      if (!state) {
        // First time seeing this pane idle — just create a basic state entry
        paneMemoryState.set(paneId, { wentIdleSinceLastWrite: true });
        return;
      }
      // Mark that this pane went idle (used by writePane to decide whether to re-inject protocol)
      state.wentIdleSinceLastWrite = true;
      // Only check compliance for panes that have been given tasks (protocol was injected)
      if (!state.protocolInjected) {
        paneMemoryState.set(paneId, state);
        return;
      }
      // Don't warn if already warned for this task cycle
      if (state.warnedAt && state.warnedAt > (state.lastWriteAt || 0)) {
        paneMemoryState.set(paneId, state);
        return;
      }
      // Check if this pane used memory tools (tracked by wrapped memoryWrite)
      // Also scan recent output as a fallback signal
      const lastOutput = idle?.lastOutput;
      if (!lastOutput || lastOutput.length === 0) {
        paneMemoryState.set(paneId, state);
        return;
      }
      let detectedMemoryUse = state.hasMemoryActivity === true;
      if (!detectedMemoryUse) {
        const outputText = Array.isArray(lastOutput) ? lastOutput.join("\n") : String(lastOutput);
        detectedMemoryUse = /memory[_\s]?(write|read|search|list)/i.test(outputText)
          || /pattern[_\s]?(write|list)/i.test(outputText);
      }
      if (!detectedMemoryUse) {
        // Keep the warning quiet to avoid flooding the terminal; the state is still tracked.
        state.warnedAt = Date.now();
      }
      paneMemoryState.set(paneId, state);
    } catch {}
  });

  // ── Desktop notification on idle (task complete) ────────────────────────
  // Track when panes receive writes so we can detect >30s of activity.
  const paneActivityStart = new Map();
  const notifyIdleDebounce = new Map();
  ptyManager.on("idle", ({ paneId }) => {
    try {
      const configStore = opts.configStore;
      if (!configStore) return;
      const notifSettings = configStore.get()?.notifications;
      if (!notifSettings?.onTaskComplete) return;
      const startedAt = paneActivityStart.get(paneId);
      if (!startedAt) return;
      const activityDuration = Date.now() - startedAt;
      paneActivityStart.delete(paneId);
      if (activityDuration < 30000) return; // Only notify after >30s of activity
      // Debounce: one notification per 60s per pane
      const now = Date.now();
      const lastNotif = notifyIdleDebounce.get(paneId) || 0;
      if (now - lastNotif < 60000) return;
      notifyIdleDebounce.set(paneId, now);
      // Get pane label
      const label = paneLabels.get(paneId) || paneId.slice(0, 8);
      // Fire desktop notification via Electron Notification API
      try {
        const { Notification } = require("electron");
        if (Notification.isSupported()) {
          new Notification({
            title: "Codebrain",
            body: `Agente "${label}" concluiu a tarefa`,
          }).show();
        }
      } catch {}
    } catch {}
  });

  // ── Sync: broadcast "agent finished" when a pane goes idle ─────────────
  // Every agent in the same workspace is notified when a peer finishes work.
  // This enables real-time coordination without manual polling.
  const idleBroadcastDebounce = new Map();
  ptyManager.on("idle", ({ paneId, idle }) => {
    try {
      const now = Date.now();
      const last = idleBroadcastDebounce.get(paneId) || 0;
      if (now - last < 15000) return; // debounce 15s
      idleBroadcastDebounce.set(paneId, now);
      const label = paneLabels.get(paneId) || paneId.slice(0, 8);
      const role = roleMap.get(paneId) || "worker";
      const workspace = opts.getCurrentWorkspacePath?.() || null;
      // Build a brief summary from last output lines
      const lastLines = idle?.lastOutput?.slice(-3) || [];
      const summary = lastLines.join(" ").replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 200);
      const content = summary
        ? `Agente "${label}" (${role}) finalizou trabalho. Últimas linhas: ${summary}`
        : `Agente "${label}" (${role}) está idle/aguardando.`;
      sendAgentNotification(ptyManager, paneLabels, paneId, content, "update", messageBus, workspace);
    } catch {}
  });

  // ── Auto-check for unread messages on idle ──────────────────────────────
  // When a pane goes idle, check if it has unread messages in the file inbox.
  // If so, inject the pane_read_messages command into the agent's STDIN so it
  // processes it as its next input. This is the only reliable way to make
  // agents discover messages — output injection alone doesn't trigger action.
  // Debounced to once per 20s per pane to avoid loops.
  const msgIdleDebounce = new Map();
  ptyManager.on("idle", ({ paneId }) => {
    try {
      const now = Date.now();
      const last = msgIdleDebounce.get(paneId) || 0;
      if (now - last < 20000) return; // debounce 20s
      const inbox = path.join(MESSAGES_DIR, paneId);
      if (!fs.existsSync(inbox)) return;
      const files = fs.readdirSync(inbox).filter(f => f.endsWith(".json"));
      let unreadCount = 0;
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(inbox, file), "utf-8");
          const msg = JSON.parse(raw);
          if (!msg.read) unreadCount++;
        } catch {}
      }
      if (unreadCount > 0) {
        msgIdleDebounce.set(paneId, now);
        // Write a short command to the agent's stdin so it processes it as
        // its next input. writeSilent suppresses echo. Submit after a delay.
        const cmd = `pane_read_messages(${paneId})`;
        ptyManager.writeSilent(paneId, cmd);
        setTimeout(() => {
          try { ptyManager.write(paneId, "\r"); } catch {}
        }, 200);
      }
    } catch {}
  });

  // ── Create handler factories ─────────────────────────────────────────────
  const sharedOpts = { ...opts, paneLabels, roleMap, messageBus, agentScorer };
  const paneHandlers = createPaneHandlers(ptyManager, sharedOpts);

  // Record write timestamps for activity tracking (patch must come after paneHandlers is created)
  const originalWritePane = paneHandlers.writePane.bind(paneHandlers);
  paneHandlers.writePane = async function trackedWritePane(paneId, text, submit) {
    const now = Date.now();
    if (!paneActivityStart.has(paneId)) paneActivityStart.set(paneId, now);
    return originalWritePane(paneId, text, submit);
  };

  // ── Agent registry + message handlers (simple CRUD via memoryStore) ────
  const agentHandlers = {
    async agentList({ workspace, limit } = {}) {
      const store = opts.memoryStore;
      if (!store) return { ok: false, error: "memory store not available" };
      return store.listAgents({ workspace, limit });
    },
    async agentMessages({ paneId, unreadOnly, workspace, limit } = {}) {
      const store = opts.memoryStore;
      if (!store) return { ok: false, error: "memory store not available" };
      return store.getAgentMessages({ paneId, unreadOnly, workspace, limit });
    },
  };

  // ── Auto-register agents on pane lifecycle events ─────────────────────────
  // pane_spawned → upsertAgent + update context files
  // pane_exited → updateAgentStatus + update context files
  if (opts.hooksManager) {
    opts.hooksManager.on("pane_spawned", ({ paneId, agent, model, providerId }) => {
      try {
        const store = opts.memoryStore;
        if (!store) return;
        const label = paneLabels.get(paneId) || null;
        const role = roleMap.get(paneId) || "worker";
        const workspace = opts.getCurrentWorkspacePath?.() || null;
        store.upsertAgent({ paneId, label, role, model, providerId, status: "active", workspace });
        // Notify all other agents that a new peer joined
        const agentDesc = [label && `"${label}"`, role, model && `(${model})`].filter(Boolean).join(" ");
        sendAgentNotification(
          ptyManager, paneLabels, paneId,
          `Novo agente entrou no workspace: ${agentDesc} — paneId: ${paneId}. Quando finalizar sua tarefa, notifique-o via pane_send_message.`,
          "update", messageBus, workspace
        );
        // Update context files with new agent info
        if (workspace && opts.updateContextFiles) {
          try { opts.updateContextFiles(workspace); } catch {}
        }
      } catch {}
    });
    opts.hooksManager.on("pane_exited", ({ paneId }) => {
      try {
        const store = opts.memoryStore;
        if (!store) return;
        store.updateAgentStatus({ paneId, status: "exited" });
        // Notify others that this agent exited
        const label = paneLabels.get(paneId) || paneId.slice(0, 8);
        const workspace = opts.getCurrentWorkspacePath?.() || null;
        sendAgentNotification(
          ptyManager, paneLabels, paneId,
          `Agente "${label}" (${paneId}) saiu do workspace. Adapte-se se dependia deste agente.`,
          "update", messageBus, workspace
        );
        // Update context files to remove exited agent
        if (workspace && opts.updateContextFiles) {
          try { opts.updateContextFiles(workspace); } catch {}
        }
      } catch {}
    });
  }
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
  const kanbanHandlers = createKanbanHandlers({ ...opts });
  const missionHandlers = createMissionHandlers({ ...opts });

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
      // Notify all other agents about the file change (same workspace only)
      sendAgentNotification(
        ptyManager, paneLabels, "system",
        `File changed: ${relPath} (${result.size || 0}B) -- search memory for "file-changed-${relPath}" for details`,
        "update",
        messageBus,
        ws
      );
    }
    return result;
  };

  // ── Wrap memoryWrite: notify agents when significant memory is written ──
  const originalMemoryWrite = memoryHandlers.memoryWrite.bind(memoryHandlers);
  memoryHandlers.memoryWrite = async function wrappedMemoryWrite(args) {
    const result = await originalMemoryWrite(args);
    if (result?.ok && args.key) {
      // ── Track memory compliance: mark recently-active panes as compliant ──
      // Since MCP tool calls don't carry paneId, we infer which pane is active
      // by checking which pane was recently written to (within last 120s).
      const now = Date.now();
      for (const [pid, state] of paneMemoryState) {
        if (state.lastWriteAt && (now - state.lastWriteAt) < 120000) {
          state.hasMemoryActivity = true;
          paneMemoryState.set(pid, state);
        }
      }
      // Fire hook event
      try { opts.hooksManager?.fire?.("memory_written", { key: args.key, type: args.type, agent_id: args.agent_id }); } catch {}
      // Notify all other agents about what was learned and where it was saved
      const typeLabel = args.type || "working";
      const agentLabel = args.agent_id || "agent";
      const contentSummary = typeof args.content === "string" ? args.content.slice(0, 150) : "";
      const contentPreview = contentSummary.length < (args.content?.length || 0) ? contentSummary + "..." : contentSummary;
      sendAgentNotification(
        ptyManager, paneLabels, agentLabel,
        `Agent "${agentLabel}" learned something and saved it: [${typeLabel}] key="${args.key}" -- ${contentPreview} -- access via memory_search("${args.key}") or memory_read(key="${args.key}")`,
        "update",
        messageBus,
        args.workspace || opts.getCurrentWorkspacePath?.() || undefined
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
    ...kanbanHandlers,
    ...missionHandlers,
    ...agentHandlers,
    // Expose foundational instances
    messageBus,
    agentScorer,
    costTracker,
    workerManager,
    configStore: opts.configStore,
    // Override listPanes to pass paneLabels
    async listPanes() {
      return paneHandlers.listPanes(paneLabels);
    },
    // Expose ptyManager for workspace validation in message handlers
    getPaneWorkspacePath(paneId) {
      if (!ptyManager) return null;
      const panes = ptyManager.list();
      const pane = panes.find(p => p.paneId === paneId);
      return pane ? (pane.workspacePath || pane.cwd || null) : null;
    },
  };
}

module.exports = { createMCPBridge };
