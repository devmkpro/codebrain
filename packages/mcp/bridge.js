"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { createPaneHandlers } = require("./bridge/pane-handlers.js");
const { createBrowserHandlers } = require("./bridge/browser-handlers.js");
const { CDPClient } = require("./bridge/cdp-client.js");
const { createTodoHandlers } = require("./bridge/todo-handlers.js");
const { createMemoryHandlers } = require("./bridge/memory-handlers.js");
const { createSwarmHandlers } = require("./bridge/swarm-handlers.js");
const { createFileHandlers } = require("./bridge/file-handlers.js");
const { createWorkerDispatch } = require("./bridge/worker-dispatch.js");
const { createHooksHandlers } = require("./bridge/hooks-handlers.js");
const { createSkillHandlers } = require("./bridge/skill-handlers.js");
const { createKanbanHandlers } = require("./bridge/kanban-handlers.js");
const { createMissionHandlers } = require("./bridge/mission-handlers.js");
const { createFetchHandlers } = require("./bridge/fetch-handlers.js");
const { createMRHandlers } = require("./bridge/mr-handlers.js");

// ── MiMo-Code Features (25 new features) ───────────────────────────────────
const { createCompactionHandlers } = require("./bridge/compaction-handlers.js");
const { createStepClassifier } = require("./bridge/step-classifier.js");
const { createTextLoopRecovery } = require("./bridge/text-loop-recovery.js");
const { createGoalHandlers } = require("./bridge/goal-handlers.js");
const { createSnapshotHandlers } = require("./bridge/snapshot-handlers.js");
const { createCheckpointHandlers } = require("./bridge/checkpoint-handlers.js");
const { createHistoryHandlers } = require("./bridge/history-handlers.js");
const { createQuestionHandlers } = require("./bridge/question-handlers.js");
const { createLSPHandlers } = require("./bridge/lsp-handlers.js");
const { createMultiEditHandlers } = require("./bridge/multi-edit-handlers.js");
const { createProviderPromptHandlers } = require("./bridge/provider-prompt-handlers.js");
const { createMaxModeHandlers } = require("./bridge/max-mode-handlers.js");
const { createComposeModeHandlers } = require("./bridge/compose-mode-handlers.js");
const { createPlanAgentHandlers } = require("./bridge/plan-agent-handlers.js");

// ── New multi-agent features ────────────────────────────────────────────────
const { MessageBus } = require("./bridge/message-bus.js");
const { AgentScorer } = require("./bridge/agent-scorer.js");
const { createPipelineHandlers } = require("./bridge/pipeline-handlers.js");
const { WorkerManager } = require("./bridge/background-workers.js");
const { createBackgroundWorkerHandlers } = require("./bridge/worker-handlers.js");
const { createConsensusHandlers } = require("./bridge/consensus-handlers.js");
const { createExpandedHooksHandlers } = require("./bridge/hooks-expand-handlers.js");

// ── Gap-Closing Features ──────────────────────────────────────────────────
const { createAutoMemoryHandlers } = require("./bridge/auto-memory-handlers.js");
const { createSecurityHandlers } = require("./bridge/security-handlers.js");

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
      read: true, // AUTO messages are pre-read — they must NOT accumulate as unread
      // Rationale: unread AUTO messages were the main driver of the idle→inject→loop cycle.
      // Agents can still see them via pane_read_messages(unreadOnly=false) if needed.
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
  console.log(`[bridge] createMCPBridge called, setMrPollTrigger present:`, typeof opts.setMrPollTrigger === 'function');
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
    spawnPaneFn: opts.spawnPaneFn,
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

  // ── Idle broadcast DISABLED ────────────────────────────────────────────
  // Previously broadcast a "agent finished" notification to all panes on idle.
  // This was a primary source of agent loops: idle → broadcast → agent sees
  // notification → responds → goes idle → broadcast → loop.
  // Workers now report completion via handoff_submit, which uses pokeOrchestrator
  // (serialized, targeted write to the orchestrator only) instead of broadcasting.

  // ── Auto-inject pane_read_messages REMOVED ──────────────────────────────
  // Previously this hook injected "pane_read_messages(paneId)" into stdin on
  // every idle event, causing an infinite loop:
  //   idle → inject cmd → agent runs → reads messages → goes idle → inject → loop
  // Agents should call pane_read_messages proactively per their system prompt,
  // not be driven by a polling loop. Messages remain in the inbox until read.

  // ── Repeated-Step Loop Detection (MiMo-inspired) ─────────────────────────
  // When a pane goes idle, check if its recent output shows the same tool call
  // repeated 3+ times consecutively. If so, inject a warning to break the loop.
  if (opts.memoryStore && opts.memoryStore.recordStep) {
    ptyManager.on("idle", ({ paneId, idle }) => {
      try {
        const store = opts.memoryStore;
        if (!store || !idle?.lastOutput) return;
        // Scan last output lines for repeated tool call patterns
        const outputText = Array.isArray(idle.lastOutput) ? idle.lastOutput.join("\n") : String(idle.lastOutput);
        // Look for MCP tool call patterns (mcp__codebrain__xxx)
        const toolCalls = outputText.match(/mcp__codebrain__(\w+)/g);
        if (!toolCalls || toolCalls.length < 2) return;
        // Check if the same tool was called multiple times
        const lastTool = toolCalls[toolCalls.length - 1];
        const recentTools = toolCalls.slice(-3);
        if (recentTools.length >= 3 && recentTools.every(t => t === lastTool)) {
          // Potential loop detected — check if this pattern persists
          const result = store.recordStep({ paneId, toolName: lastTool, toolInput: {} });
          if (result.isLooping) {
            console.warn(`[bridge] LOOP DETECTED: pane ${paneId.slice(0,8)} repeated "${lastTool}" ${result.count}x`);
            // Inject a gentle warning (the agent will see it on next turn)
            try {
              const warning = `\n⚠️ LOOP WARNING: You appear to be calling "${lastTool}" repeatedly with the same result. Try a different approach or stop.\n`;
              ptyManager.write(paneId, warning, false);
            } catch {}
          }
        }
      } catch {}
    });
  }

  // Clean up step history, pressure tracking, text loop buffers, and step signatures on pane exit
  if (opts.hooksManager) {
    opts.hooksManager.on("pane_exited", ({ paneId }) => {
      try { opts.memoryStore?.clearStepHistory?.({ paneId }); } catch {}
      try { opts.memoryStore?.clearPressureTracking?.({ paneId }); } catch {}
      try { opts.memoryStore?.clearTextLoopBuffer?.({ paneId }); } catch {}
      try { opts.memoryStore?.clearStepSignatures?.({ paneId }); } catch {}
      try { opts.memoryStore?.clearGoal?.(paneId); } catch {}
      try { opts.memoryStore?.clearCompactionState?.(paneId); } catch {}
    });
  }

  // ── Text Loop Recovery on idle (MiMo-inspired) ─────────────────────────────
  // When a pane goes idle, check if its output text has been repeating.
  // SKIP orchestrators — they legitimately produce similar-looking outputs between
  // tool calls during multi-step tasks (e.g. "Executando teste 1...", "Executando teste 2...")
  // and get false positives. Only flag workers doing true repetitive loops.
  ptyManager.on("idle", ({ paneId, idle }) => {
    try {
      const store = opts.memoryStore;
      if (!store?.recordTextOutput || !idle?.lastOutput) return;
      // Skip orchestrator panes — false positive rate is too high for coordinating agents
      const role = roleMap.get(paneId) || "worker";
      if (role === "orchestrator") return;
      const outputText = Array.isArray(idle.lastOutput) ? idle.lastOutput.join("\n") : String(idle.lastOutput);
      if (outputText.length < 80) return; // Skip very short outputs
      const result = store.recordTextOutput(paneId, outputText);
      if (result.isLooping && result.recoveryCount <= 2) {
        console.warn(`[bridge] TEXT LOOP: pane ${paneId.slice(0,8)} recovery #${result.recoveryCount}`);
      }
    } catch {}
  });

  // ── Enhanced Step Signature Loop Detection on idle ──────────────────────────
  // Uses stableStringify for key-order-independent comparison.
  // SKIP orchestrators — they legitimately call the same tools (pane_write, pane_wait_idle)
  // multiple times across different workers and get false positives.
  if (opts.memoryStore?.recordStepSignature) {
    ptyManager.on("idle", ({ paneId, idle }) => {
      try {
        const store = opts.memoryStore;
        if (!store?.recordStepSignature || !idle?.lastOutput) return;
        const role = roleMap.get(paneId) || "worker";
        if (role === "orchestrator") return;
        const outputText = Array.isArray(idle.lastOutput) ? idle.lastOutput.join("\n") : String(idle.lastOutput);
        const toolCalls = outputText.match(/mcp__codebrain__(\w+)/g);
        if (!toolCalls || toolCalls.length < 2) return;
        const lastTool = toolCalls[toolCalls.length - 1];
        const result = store.recordStepSignature({ paneId, toolName: lastTool, toolInput: {} });
        if (result.isLooping) {
          console.warn(`[bridge] ENHANCED LOOP: pane ${paneId.slice(0,8)} repeated "${lastTool}" ${result.count}x (key-order-independent)`);
        }
      } catch {}
    });
  }

  // ── Task Gate Pre-Stop Validation (wired on idle) ──────────────────────────
  // When a pane goes idle after significant activity, check for incomplete tasks.
  ptyManager.on("idle", ({ paneId, idle }) => {
    try {
      const store = opts.memoryStore;
      if (!store?.taskGateCheck) return;
      // Only check if there was meaningful activity (not empty idle pings)
      const lastLines = idle?.lastOutput?.slice(-5) || [];
      const summary = lastLines.join(" ").replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (!summary || summary.length < 20) return;
      const gate = store.taskGateCheck({ paneId, maxReEntries: 3 });
      if (!gate.shouldStop && gate.nudgeText) {
        // Inject nudge into pane terminal
        try { ptyManager.write(paneId, `\n${gate.nudgeText}\n`, false); } catch {}
      }
    } catch {}
  });

  // ── Context Pressure Tracking (MiMo-inspired) ────────────────────────────
  // Track output volume and tool calls per pane for pressure estimation.
  if (opts.memoryStore?.recordActivity) {
    ptyManager.on("idle", ({ paneId, idle }) => {
      try {
        const lastOutput = idle?.lastOutput;
        if (!lastOutput || lastOutput.length === 0) return;
        const outputText = Array.isArray(lastOutput) ? lastOutput.join("\n") : String(lastOutput);
        const outputChars = outputText.length;
        const hasToolCall = /mcp__codebrain__|tool_use|function_call/i.test(outputText);
        opts.memoryStore.recordActivity({ paneId, outputChars, toolCall: hasToolCall });
      } catch {}
    });
  }

  // ── Memory Auto-Pruning (MiMo-inspired) ──────────────────────────────────
  // Run once on startup, then every 6 hours.
  if (opts.memoryStore?.autoPrune) {
    // Initial prune on startup (cleanup stale data from previous sessions)
    try {
      const result = opts.memoryStore.autoPrune();
      if (result.ok && result.pruned > 0) {
        console.log(`[bridge] Memory auto-prune: removed ${result.pruned} stale entries (stale: ${result.details.stale}, orphans: ${result.details.orphans}, excess: ${result.details.excess})`);
      }
    } catch {}

    // Periodic prune every 6 hours
    const PRUNE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
    setInterval(() => {
      try {
        const result = opts.memoryStore.autoPrune();
        if (result.ok && result.pruned > 0) {
          console.log(`[bridge] Memory auto-prune (periodic): removed ${result.pruned} entries`);
        }
      } catch {}
    }, PRUNE_INTERVAL);
  }

  // ── Auto-Dream + Auto-Distill (MiMo-inspired) ────────────────────────────
  // Dream: consolidate working memories older than 1 day → semantic summaries
  // Distill: extract repeated workflows from trajectories → patterns
  // Dream runs every 24h, Distill runs every 7 days
  if (opts.memoryStore?.autoDream && opts.memoryStore?.autoDistill) {
    const DREAM_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    const DISTILL_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days
    const workspace = opts.getCurrentWorkspacePath?.() || null;

    // Dream on startup delay (wait 5 min for some activity first)
    setTimeout(() => {
      try {
        const result = opts.memoryStore.autoDream({ workspace });
        if (result.ok && result.consolidated > 0) {
          console.log(`[bridge] Auto-dream: consolidated ${result.consolidated} memory groups`);
        }
      } catch {}
    }, 5 * 60 * 1000);

    // Periodic dream every 24h
    setInterval(() => {
      try {
        const ws = opts.getCurrentWorkspacePath?.() || null;
        const result = opts.memoryStore.autoDream({ workspace: ws });
        if (result.ok && result.consolidated > 0) {
          console.log(`[bridge] Auto-dream (periodic): consolidated ${result.consolidated} groups`);
        }
      } catch {}
    }, DREAM_INTERVAL);

    // Periodic distill every 7 days
    setTimeout(() => {
      setInterval(() => {
        try {
          const ws = opts.getCurrentWorkspacePath?.() || null;
          const result = opts.memoryStore.autoDistill({ workspace: ws });
          if (result.ok && result.distilled > 0) {
            console.log(`[bridge] Auto-distill: extracted ${result.distilled} workflow patterns`);
          }
        } catch {}
      }, DISTILL_INTERVAL);
    }, 60 * 60 * 1000); // First distill after 1 hour
  }

  // ── Short-term → Long-term Pattern Promotion ────────────────────────────
  // Promote qualifying short-term patterns every 30 minutes
  // Criteria: usage_count >= 3 AND quality >= 0.6
  if (opts.memoryStore?.promoteShortTermPatterns) {
    const PROMOTE_INTERVAL = 30 * 60 * 1000; // 30 minutes
    setInterval(() => {
      try {
        const result = opts.memoryStore.promoteShortTermPatterns();
        if (result.ok && result.promoted > 0) {
          console.log(`[bridge] Pattern promotion: ${result.promoted} short-term → long-term (${result.remaining} remaining)`);
        }
        // Also prune old short-term patterns
        opts.memoryStore.pruneShortTermPatterns();
      } catch {}
    }, PROMOTE_INTERVAL);
  }

  // ── CDP Client for native Chrome control ─────────────────────────────
  // Lazy-initialized on first browser tool call.
  // If opts.cdpClient is already provided (from mcp.ts), use it.
  // Otherwise create one.
  if (!opts.cdpClient) {
    try {
      opts.cdpClient = new CDPClient({ log: console.log, debug: false });
    } catch (err) {
      console.warn("[Bridge] Could not create CDPClient:", err.message);
    }
  }

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
        // NOTE: Removed sendAgentNotification on pane_spawned — broadcasting to all
        // panes caused agents to react and loop. Agents discover peers via pane_list().
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
        // Update actor registry on exit
        try { store.actorUpdateStatus?.({ paneId, status: 'idle', lastOutcome: 'success' }); } catch {}
        // NOTE: Removed sendAgentNotification on pane_exited — broadcasting caused
        // other agents to react unnecessarily. The orchestrator detects exits via pane_list().
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
  const fetchHandlers = createFetchHandlers(opts);
  const mrHandlers = createMRHandlers({
    getOAuthToken: opts.getOAuthToken,
    getBotToken: opts.getBotToken,
    emitNotification: opts.emitNotification,
  });

  // Gap-closing handlers
  const autoMemoryHandlers = createAutoMemoryHandlers({ memoryStore: opts.memoryStore });
  const securityHandlers = createSecurityHandlers({ memoryStore: opts.memoryStore, getCurrentWorkspacePath: opts.getCurrentWorkspacePath });

  // ── MiMo-Code Feature Handlers ──────────────────────────────────────────
  const compactionHandlers = createCompactionHandlers(sharedOpts);
  const stepClassifier = createStepClassifier(sharedOpts);
  const textLoopRecovery = createTextLoopRecovery(sharedOpts);
  const goalHandlers = createGoalHandlers(sharedOpts);
  const snapshotHandlers = createSnapshotHandlers(sharedOpts);
  const checkpointHandlers = createCheckpointHandlers(sharedOpts);
  const historyHandlers = createHistoryHandlers(sharedOpts);
  const questionHandlers = createQuestionHandlers(sharedOpts);
  const lspHandlers = createLSPHandlers(sharedOpts);
  const multiEditHandlers = createMultiEditHandlers(sharedOpts);
  const providerPromptHandlers = createProviderPromptHandlers(sharedOpts);
  const maxModeHandlers = createMaxModeHandlers(sharedOpts);
  const composeModeHandlers = createComposeModeHandlers(sharedOpts);
  const planAgentHandlers = createPlanAgentHandlers(sharedOpts);

  // ── Start stuck detection scanner (MiMo-inspired) ──────────────────────────
  // Scans actor_registry every 60s for actors stuck in 'running' for >5 minutes.
  // Marks them as 'stuck' and fires hooks for UI notification.
  if (opts.memoryStore && opts.memoryStore.actorStartStuckScanner) {
    opts.memoryStore.actorStartStuckScanner(60000, (stuckActors) => {
      try {
        for (const actor of stuckActors) {
          const label = actor.label || actor.agent || actor.pane_id?.slice(0, 8) || 'unknown';
          const stuckMin = Math.floor((actor.stuckDuration || 0) / 60000);
          console.warn(`[bridge] STUCK DETECTED: "${label}" (${actor.pane_id}) — no activity for ${stuckMin}m`);
          // Fire hook for observability
          if (opts.hooksManager) {
            opts.hooksManager.fire("worker_alert", {
              paneId: actor.pane_id,
              label,
              stuckDuration: actor.stuckDuration,
              type: "stuck",
            });
          }
        }
      } catch {}
    });
    console.log("[bridge] Actor stuck detection scanner started (60s interval, 5min threshold)");
  }

  // Wire mrHandlers + configStore + paneHandlers into WorkerManager for mr_poll worker
  workerManager.opts.mrHandlers = mrHandlers;
  workerManager.opts.configStore = opts.configStore;
  workerManager.opts.emitNotification = opts.emitNotification;
  workerManager.opts.paneHandlers = paneHandlers;
  workerManager.opts.clearReviewingState = opts.clearReviewingState;
  workerManager.opts.sendFindings = opts.sendFindings;
  workerManager.opts.sendReviewError = opts.sendReviewError;

  // Expose direct trigger function for IPC handler (bypasses HooksManager event bus)
  if (opts.setMrPollTrigger) {
    opts.setMrPollTrigger((triggerOpts) => {
      console.log(`[bridge] triggerMrPoll called directly, workspace:`, triggerOpts?.workspace ?? 'all');
      const result = workerManager.triggerWorker("mr_poll", triggerOpts);
      console.log(`[bridge] triggerWorker result:`, JSON.stringify(result));
      return result;
    });
    console.log(`[bridge] mr_poll trigger function registered on ctx`);
  }

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
      // NOTE: Removed sendAgentNotification on file_write — broadcasting every file
      // change interrupted agents mid-task. File changes are tracked in shared memory
      // (key: file-changed-<path>) and agents read them via memory_search() proactively.
      // sendAgentNotification(
      //   ptyManager, paneLabels, "system",
      //   `File changed: ${relPath} (${result.size || 0}B) -- search memory for "file-changed-${relPath}" for details`,
      //   "update",
      //   messageBus,
      //   ws
      // );
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
      // NOTE: Removed sendAgentNotification on memory_write — broadcasting every
      // memory write caused constant interruptions. Agents read shared memory
      // proactively via memory_search() instead of being pushed notifications.
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
    ...fetchHandlers,
    ...mrHandlers,
    ...agentHandlers,
    // ── MiMo-Code Feature Handlers (25 new features) ──────────────────────
    ...compactionHandlers,
    ...stepClassifier,
    ...textLoopRecovery,
    ...goalHandlers,
    ...snapshotHandlers,
    ...checkpointHandlers,
    ...historyHandlers,
    ...questionHandlers,
    ...lspHandlers,
    ...multiEditHandlers,
    ...providerPromptHandlers,
    ...maxModeHandlers,
    ...composeModeHandlers,
    ...planAgentHandlers,
    // Gap-closing handlers
    ...autoMemoryHandlers,
    ...securityHandlers,
    // Expose foundational instances
    messageBus,
    agentScorer,
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
