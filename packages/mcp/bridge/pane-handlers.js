"use strict";

/**
 * Memory protocol injected into pane_write so the AI agent is
 * constantly reminded to use memory_read/write/search and pattern_write.
 * This is code-level enforcement — not just a prompt suggestion.
 */
const MEMORY_PROTOCOL_PREFIX = `
🔴 MEMORY PROTOCOL (CODE-ENFORCED — you MUST follow this):
• BEFORE working: memory_search("file-changed"), memory_search("changes"), memory_search("api"), memory_search("schema")
• DURING work: memory_write() for EVERY significant change (api, schema, component, decision, fix)
• AFTER completion: memory_write(type="episodic", key="completed-<task>", content="summary", tags=["result"])
• ALWAYS: pattern_write() for new patterns discovered. NEVER create .md files for knowledge — use MCP memory/patterns only.
• REUSE workers: call pane_list() or actor_list() before spawning. If a worker with the right label exists and is idle, send it a new task via pane_write.
• SPAWN + WAIT: use pane_spawn_and_wait() when you need the result inline (blocks until idle, parses return header). Use pane_spawn() for fire-and-forget.
• KILL CASCADE: use pane_kill_cascade(paneId) to kill a pane AND all its registered children at once.
• ACTOR STATUS: use actor_status(paneId) or actor_list() to check turn count, stuck detection, and parent hierarchy.
• TASK COMPLETION: When you finish a task assigned by the orchestrator, call mcp__codebrain__handoff_submit({paneId:"<your pane id>", summary:"...", status:"done"|"blocked"|"error", artifacts:[...]}) as your VERY LAST action. The orchestrator will be notified automatically. NEVER try to pane_write back to the orchestrator yourself.
• WAIT BEFORE SEND: Always call pane_wait_idle(paneId) BEFORE pane_write to ensure the agent is at its prompt. If busy, pane_write interrupts the current task.
• Skipping memory = INCOMPLETE TASK. The system tracks whether you used memory tools.
──────────────────────────────────────────
`.trim();

/**
 * Worker contract footer — auto-appended to task writes (>80 chars) to
 * ensure workers always terminate with handoff_submit instead of going idle.
 * Inspired by Overclock's WORKER_CONTRACT_FOOTER pattern.
 */
const WORKER_CONTRACT_FOOTER = `

— Worker contract: when you finish this task, call mcp__codebrain__handoff_submit({ paneId: "<your_pane_id>", summary: "...", status: "done"|"blocked"|"error", artifacts: [...] }) as your VERY LAST action. The orchestrator is waiting on your result; simply going idle does NOT signal completion.`;

// Stuck detection: 5 minutes without output → fire event
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
const STUCK_SCAN_INTERVAL_MS = 60 * 1000;

/**
 * Pane-related bridge handlers (spawn, read, write, list, idle, roles, messages).
 */
function createPaneHandlers(ptyManager, opts) {
  const roleMap = opts.roleMap || new Map();
  const idleWaiters = new Map();
  // Serializes pokeOrchestrator writes per worker pane to avoid race conditions
  const handoffPokeChain = new Map();

  // ── Update turn count in actor registry when pane produces output ──────────
  // ptyManager emits: ("output", paneId, data) — note positional args, not object
  const outputTurnDebounce = new Map();
  ptyManager.on("output", (paneId, _data) => {
    try {
      const store = opts.memoryStore;
      if (!store?.actorUpdateTurn) return;
      // Debounce turn updates to every 5 seconds per pane to avoid spamming SQLite
      const now = Date.now();
      const last = outputTurnDebounce.get(paneId) || 0;
      if (now - last < 5000) return;
      outputTurnDebounce.set(paneId, now);
      store.actorUpdateTurn({ paneId });
    } catch {}
  });

  ptyManager.on("idle", ({ paneId, idle }) => {
    // Resolve waiting pane_wait_idle calls
    const waiter = idleWaiters.get(paneId);
    if (waiter) {
      clearTimeout(waiter.timer);
      idleWaiters.delete(paneId);
      waiter.resolve({ idle: true, lastOutput: idle?.lastOutput });
    }
    // Update actor registry: pane went idle → success
    try {
      const store = opts.memoryStore;
      if (store?.actorUpdateStatus) {
        store.actorUpdateStatus({ paneId, status: 'idle', lastOutcome: 'success' });
      }
    } catch {}
  });

  // ── Stuck detection fiber (scans every 60s) ────────────────────────────────
  const stuckScanTimer = setInterval(() => {
    try {
      const store = opts.memoryStore;
      if (!store?.actorDetectStuck) return;
      const { stuck = [] } = store.actorDetectStuck({ thresholdMs: STUCK_THRESHOLD_MS });
      for (const actor of stuck) {
        // Only flag panes that are still alive in the PTY manager
        if (!ptyManager.hasPane(actor.pane_id)) continue;
        // Mark as stuck in DB
        store.actorUpdateStatus({ paneId: actor.pane_id, status: 'stuck' });
        // Fire hooksManager event so the orchestrator can react
        try {
          opts.hooksManager?.fire?.('pane_stuck', {
            paneId: actor.pane_id,
            label: actor.label || actor.agent || actor.pane_id.slice(0, 8),
            lastTurnTime: actor.last_turn_time,
            stuckDuration: Date.now() - actor.last_turn_time,
          });
        } catch {}
      }
    } catch {}
  }, STUCK_SCAN_INTERVAL_MS);
  // Prevent the interval from keeping Node.js alive when the app exits
  if (stuckScanTimer.unref) stuckScanTimer.unref();

  return {
    roleMap,

    async spawnPane({ agent, cwd, providerId, model, label, description, parentPaneId }) {
      try {
        // ── Duplicate guard: if a pane with this label already exists and is alive, reuse it ──
        // BUT only if providerId+model match — otherwise the user wants a different provider.
        if (label && opts.paneLabels) {
          for (const [existingPaneId, existingLabel] of opts.paneLabels) {
            if (existingLabel === label) {
              // Check if the pane is still alive
              const panes = ptyManager.list();
              const pane = panes.find(p => p.paneId === existingPaneId);
              if (pane && pane.status !== "exited") {
                // Check if provider/model match — if not, don't reuse (user wants different provider)
                const providerMatch = !providerId || !pane.providerId || pane.providerId === providerId;
                const modelMatch = !model || !pane.model || pane.model === model;
                if (providerMatch && modelMatch) {
                  return {
                    ok: true,
                    paneId: existingPaneId,
                    reused: true,
                    label,
                    message: `Reusing existing "${label}" pane (${existingPaneId}). It is already active.`,
                  };
                }
                // Label matches but provider/model differ — remove stale label, spawn new
                opts.paneLabels.delete(existingPaneId);
              } else {
                // Pane exited — remove stale label
                opts.paneLabels.delete(existingPaneId);
              }
            }
          }
        }

        if (opts.spawnPaneFn) {
          const result = await opts.spawnPaneFn({ agent, cwd, providerId, model });
          if (result.ok && result.paneId) {
            roleMap.set(result.paneId, "worker");
            if (label && opts.paneLabels) opts.paneLabels.set(result.paneId, label);
            // Register in actor registry
            try {
              const workspace = opts.getCurrentWorkspacePath?.() || null;
              opts.memoryStore?.actorRegister?.({
                paneId: result.paneId, parentPaneId: parentPaneId || null,
                agent, label, description, workspace, cwd, providerId, model,
              });
            } catch {}
          }
          return result;
        }
        const config = { agent: agent || "openclaude", cwd: cwd || undefined, providerId: providerId || undefined, model: model || undefined };
        const paneId = await ptyManager.spawn(config);
        roleMap.set(paneId, "worker");
        if (label && opts.paneLabels) opts.paneLabels.set(paneId, label);
        if (opts.onPaneCreated) opts.onPaneCreated({ paneId, agent: config.agent, cwd: config.cwd, providerId, model });
        // Register in actor registry
        try {
          const workspace = opts.getCurrentWorkspacePath?.() || null;
          opts.memoryStore?.actorRegister?.({
            paneId, parentPaneId: parentPaneId || null,
            agent: config.agent, label, description, workspace, cwd, providerId, model,
          });
        } catch {}
        return { paneId };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    async writePane(paneId, text, submit = true) {
      if (!ptyManager.hasPane(paneId)) return { ok: false, error: "pane not found" };
      // ── Code-level memory protocol enforcement ────────────────────────────
      // Prepend memory protocol instructions on the first write to each pane
      // and whenever a pane receives a new task after going idle.
      // This is enforced in code, not just in prompt files.
      let finalText = text;
      if (opts.paneMemoryState) {
        const existing = opts.paneMemoryState.get(paneId);
        const isFirstWrite = !existing;
        const isAfterIdle = existing?.wentIdleSinceLastWrite === true;
        if (isFirstWrite || isAfterIdle) {
          finalText = MEMORY_PROTOCOL_PREFIX + "\n\n" + text;
        }
        // Track pane state
        opts.paneMemoryState.set(paneId, {
          ...(existing || {}),
          protocolInjected: true,
          lastWriteAt: Date.now(),
          wentIdleSinceLastWrite: false,
          hasMemoryActivity: false,
        });
      }
      // ── Worker contract footer (auto-append for task writes) ──────────────
      // Appended when: text is long enough to be a task (>80 chars),
      // does NOT already contain handoff_submit, and this is a submit write.
      // Inspired by Overclock's WORKER_CONTRACT_FOOTER pattern.
      if (
        submit &&
        finalText.length > 80 &&
        !finalText.includes("handoff_submit")
      ) {
        finalText = finalText + WORKER_CONTRACT_FOOTER;
      }
      // ── Bracketed paste mode: preserves multi-line formatting ────────────
      // Instead of sanitizing newlines to spaces (which destroys prompt structure),
      // wrap the text in \x1b[200~ ... \x1b[201~ so readline treats \n as literal
      // newlines inside the paste — not as Enter keypresses.
      // Normalize \r\n → \n but keep \n intact for the agent to read structure.
      const pasteText = finalText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      // writeSilent with useBracketedPaste=true — suppresses echo + uses paste mode
      ptyManager.writeSilent(paneId, pasteText, true);
      if (submit) {
        // Send Enter as a separate write after a delay so readline can finish
        // processing pasted text before receiving the submit signal.
        // Bracketed paste mode closes with \x1b[201~ then we send \r to submit.
        // Delay scales with text length: large prompts need more time to process.
        const delay = Math.min(3000, Math.max(150, 150 + pasteText.length * 0.3));
        await new Promise((r) => setTimeout(r, delay));
        ptyManager.write(paneId, "\r");
      }
      return { ok: true };
    },

    async readPane(paneId, lastN = 200) {
      return { lines: ptyManager.read(paneId, lastN) };
    },

    async waitPaneIdle(paneId, timeout = 300000) {
      return new Promise((resolve) => {
        const existing = idleWaiters.get(paneId);
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
          idleWaiters.delete(paneId);
          resolve({ idle: true, timedOut: true });
        }, timeout);
        idleWaiters.set(paneId, { resolve, timer });
      });
    },

    async listPanes(paneLabels) {
      return ptyManager.list().map((p) => ({
        ...p,
        role: roleMap.get(p.paneId) || "worker",
        label: paneLabels.get(p.paneId) || p.agent,
      }));
    },

    async setRole(paneId, role) {
      roleMap.set(paneId, role);
      return { ok: true, paneId, role };
    },

    async notifyPane(paneId, message) {
      try {
        ptyManager.injectOutput(paneId, message);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Send a message to a pane's stdin via writeSilent (echo-suppressed).
     * Unlike notifyPane (injectOutput = display only), this reaches the agent's CLI process.
     */
    async messagePane(paneId, message) {
      try {
        if (!ptyManager.hasPane(paneId)) return { ok: false, error: "pane not found" };
        ptyManager.writeSilent(paneId, message);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async handoffSubmit({ paneId, summary, status, artifacts }) {
      try {
        const store = opts.memoryStore;
        if (!store) return { ok: false, error: "memory store not available" };
        const workspace = opts.getCurrentWorkspacePath?.() || null;
        const result = store.submitHandoff({ paneId, summary, status, artifacts, workspace });
        // Fire hook event
        try { opts.hooksManager?.fire?.("handoff_submitted", { paneId, status, summary: summary.slice(0, 100) }); } catch {}

        // ── pokeOrchestrator: notify the orchestrator automatically ────────
        // Find the orchestrator pane (role === "orchestrator") and inject the
        // result as a system message. This is the key pattern from Overclock:
        // workers NEVER write to the orchestrator directly — the MCP server
        // delivers the result asynchronously, serialized with delays.
        // This breaks the bidirectional conversation loop completely.
        try {
          const workerLabel = opts.paneLabels?.get(paneId) || paneId.slice(0, 8);
          const artifactStr = (artifacts && artifacts.length > 0)
            ? ` Artifacts: ${artifacts.join(", ")}.`
            : "";
          const msg = `[squad] Worker "${workerLabel}" (pane ${paneId.slice(0, 8)}) finished — status=${status}. ${summary}${artifactStr} Use handoff_wait or handoff_list to get the full result, then continue the pipeline.`;

          // Find orchestrator pane(s) — serialize writes to avoid race conditions
          const orchestratorPaneId = (() => {
            for (const [pid, role] of roleMap) {
              if (role === "orchestrator" && ptyManager.hasPane(pid)) return pid;
            }
            return null;
          })();

          if (orchestratorPaneId) {
            // Serialize: chain onto previous poke promise to avoid simultaneous writes
            const prevChain = handoffPokeChain.get(paneId) ?? Promise.resolve();
            const nextChain = prevChain.then(async () => {
              if (!ptyManager.hasPane(orchestratorPaneId)) return;
              // Write message text silently (no echo)
              ptyManager.writeSilent(orchestratorPaneId, msg);
              // Wait 500ms then submit (Enter) — same as Overclock's pokeOrchestrator
              await new Promise(r => setTimeout(r, 500));
              if (!ptyManager.hasPane(orchestratorPaneId)) return;
              ptyManager.write(orchestratorPaneId, "\r");
              await new Promise(r => setTimeout(r, 350));
            });
            handoffPokeChain.set(paneId, nextChain);
          }
        } catch {}

        return result;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async handoffWait({ paneIds, returnOn = "all", timeoutMs = 300000 }) {
      const store = opts.memoryStore;
      if (!store) return { ok: false, error: "memory store not available" };
      if (!Array.isArray(paneIds) || paneIds.length === 0) return { ok: false, error: "paneIds array is required" };

      const deadline = Date.now() + timeoutMs;
      const pollInterval = 500; // ms

      while (Date.now() < deadline) {
        const results = [];
        for (const pid of paneIds) {
          const handoff = store.getHandoff({ paneId: pid });
          if (handoff.ok) results.push(handoff.handoff);
        }

        if (returnOn === "any" && results.length > 0) {
          return { ok: true, handoffs: results, waited: true };
        }
        if (returnOn === "all" && results.length === paneIds.length) {
          return { ok: true, handoffs: results, waited: true };
        }

        // Wait before next poll
        await new Promise(r => setTimeout(r, pollInterval));
      }

      // Timeout — return whatever we have
      const finalResults = [];
      for (const pid of paneIds) {
        const handoff = store.getHandoff({ paneId: pid });
        if (handoff.ok) finalResults.push(handoff.handoff);
      }
      return { ok: true, handoffs: finalResults, timedOut: true };
    },

    /**
     * Kill a pane and ALL its registered children recursively (cancel cascade).
     * Inspired by MiMo's actor.cancel() which calls listByParent + cancel recursively.
     */
    async killPaneCascade(paneId, _depth = 0) {
      if (_depth > 20) return; // safety limit
      try {
        const store = opts.memoryStore;
        // 1. Recursively kill children first
        if (store?.actorListChildren) {
          const { actors: children = [] } = store.actorListChildren({ parentPaneId: paneId });
          for (const child of children) {
            await this.killPaneCascade(child.pane_id, _depth + 1);
          }
        }
        // 2. Kill the pane itself
        if (ptyManager.hasPane(paneId)) {
          ptyManager.kill(paneId);
        }
        // 3. Update actor registry
        if (store?.actorUpdateStatus) {
          store.actorUpdateStatus({ paneId, status: 'idle', lastOutcome: 'cancelled' });
        }
      } catch {}
    },

    /**
     * Spawn a pane and block until idle (run mode, like MiMo's action:"run").
     * Returns the pane output after completion.
     * @param {number} timeoutMs - Max wait time (default 10 minutes)
     */
    async paneSpawnAndWait({ agent, cwd, providerId, model, label, description, parentPaneId, timeoutMs = 600_000 }) {
      // 1. Spawn
      const spawnResult = await this.spawnPane({ agent, cwd, providerId, model, label, description, parentPaneId });
      if (!spawnResult.paneId) return { ok: false, error: spawnResult.error || 'spawn failed' };
      const { paneId } = spawnResult;

      // 2. Wait for idle with timeout
      const waitResult = await this.waitPaneIdle(paneId, timeoutMs);

      // 3. Read output
      const { lines } = await this.readPane(paneId, 300);

      // 4. Parse return header if present (Melhoria 5 — standardized format)
      let parsedStatus = null;
      let parsedSummary = null;
      if (lines && lines.length > 0) {
        const outputText = lines.join('\n');
        const statusMatch = outputText.match(/\*\*Status\*\*:\s*(success|partial|failed|blocked)/i);
        const summaryMatch = outputText.match(/\*\*Summary\*\*:\s*(.+)/i);
        if (statusMatch) parsedStatus = statusMatch[1].toLowerCase();
        if (summaryMatch) parsedSummary = summaryMatch[1].trim();
      }

      return {
        ok: true,
        paneId,
        timedOut: waitResult.timedOut || false,
        lines,
        reportedStatus: parsedStatus,
        reportedSummary: parsedSummary,
        reused: spawnResult.reused || false,
      };
    },

    /**
     * Get actor registry info for a pane (status, turn count, last turn time, etc).
     */
    actorStatus({ paneId }) {
      const store = opts.memoryStore;
      if (!store?.actorGet) return { ok: false, error: 'actor registry not available' };
      return store.actorGet({ paneId });
    },

    /**
     * List all active actors in the current workspace.
     */
    actorList({ workspace, includeTerminal } = {}) {
      const store = opts.memoryStore;
      if (!store?.actorList) return { ok: false, error: 'actor registry not available' };
      const ws = workspace || opts.getCurrentWorkspacePath?.() || undefined;
      return store.actorList({ workspace: ws, includeTerminal });
    },

    /**
     * Render active actors summary for agent context.
     */
    actorRenderForAgent({ workspace } = {}) {
      const store = opts.memoryStore;
      if (!store?.actorRenderForAgent) return { ok: true, text: '' };
      const ws = workspace || opts.getCurrentWorkspacePath?.() || undefined;
      return store.actorRenderForAgent({ workspace: ws });
    },

    /**
     * Block until any/all of the listed panes go idle OR submit a handoff.
     * Returns as soon as the returnOn condition is met.
     * Eliminates the model-driven polling loop of repeated pane_wait_idle calls.
     * Inspired by Overclock's pane_wait_many(returnOn="any").
     */
    async waitManyPanes({ paneIds, returnOn = "any", timeoutMs = 300000, matchStrings = [] }) {
      if (!Array.isArray(paneIds) || paneIds.length === 0) return { ok: false, error: "paneIds required" };

      const deadline = Date.now() + timeoutMs;
      const pollMs = 500;
      const idleSet = new Set();

      // Subscribe to idle events for fast detection
      const onIdle = ({ paneId }) => {
        if (paneIds.includes(paneId)) idleSet.add(paneId);
      };
      ptyManager.on("idle", onIdle);

      try {
        while (Date.now() < deadline) {
          // Also check handoff submissions as a completion signal
          const store = opts.memoryStore;
          const handoffIds = new Set();
          if (store?.getHandoff) {
            for (const pid of paneIds) {
              const h = store.getHandoff({ paneId: pid });
              if (h.ok && h.handoff) handoffIds.add(pid);
            }
          }

          // Check matchStrings in recent output
          const matchedIds = new Set();
          if (matchStrings.length > 0) {
            for (const pid of paneIds) {
              if (!ptyManager.hasPane(pid)) continue;
              const lines = ptyManager.read(pid, 30);
              const text = lines.join("\n");
              if (matchStrings.some(s => text.includes(s))) matchedIds.add(pid);
            }
          }

          const doneIds = new Set([...idleSet, ...handoffIds, ...matchedIds]);

          if (returnOn === "any" && doneIds.size > 0) {
            return { ok: true, done: [...doneIds], remaining: paneIds.filter(p => !doneIds.has(p)), returnOn };
          }
          if (returnOn === "all" && paneIds.every(p => doneIds.has(p))) {
            return { ok: true, done: [...doneIds], remaining: [], returnOn };
          }

          await new Promise(r => setTimeout(r, pollMs));
        }
        // Timeout
        return { ok: true, done: [...idleSet], remaining: paneIds.filter(p => !idleSet.has(p)), timedOut: true };
      } finally {
        ptyManager.off("idle", onIdle);
      }
    },

    async writeManyPanes({ paneIds, text, submit = true }) {
      if (!Array.isArray(paneIds) || paneIds.length === 0) return { ok: false, error: "paneIds array is required" };
      if (!text) return { ok: false, error: "text is required" };

      const results = [];
      for (const paneId of paneIds) {
        try {
          const result = await this.writePane(paneId, text, submit);
          results.push({ paneId, ...result });
        } catch (err) {
          results.push({ paneId, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { ok: true, results, count: results.length };
    },
  };
}

module.exports = { createPaneHandlers };
