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
• REUSE workers: call pane_list() before spawning. If a worker with the right label exists and is idle, send it a new task via pane_write.
• Skipping memory = INCOMPLETE TASK. The system tracks whether you used memory tools.
──────────────────────────────────────────
`.trim();

/**
 * Pane-related bridge handlers (spawn, read, write, list, idle, roles, messages).
 */
function createPaneHandlers(ptyManager, opts) {
  const roleMap = opts.roleMap || new Map();
  const idleWaiters = new Map();

  ptyManager.on("idle", ({ paneId, idle }) => {
    const waiter = idleWaiters.get(paneId);
    if (waiter) {
      clearTimeout(waiter.timer);
      idleWaiters.delete(paneId);
      waiter.resolve({ idle: true, lastOutput: idle?.lastOutput });
    }
  });

  return {
    roleMap,

    async spawnPane({ agent, cwd, providerId, model, label }) {
      try {
        // ── Duplicate guard: if a pane with this label already exists and is alive, reuse it ──
        if (label && opts.paneLabels) {
          for (const [existingPaneId, existingLabel] of opts.paneLabels) {
            if (existingLabel === label) {
              // Check if the pane is still alive
              const panes = ptyManager.list();
              const pane = panes.find(p => p.paneId === existingPaneId);
              if (pane && pane.status !== "exited") {
                return {
                  ok: true,
                  paneId: existingPaneId,
                  reused: true,
                  label,
                  message: `Reusing existing "${label}" pane (${existingPaneId}). It is already active.`,
                };
              }
              // Pane exited — remove stale label
              opts.paneLabels.delete(existingPaneId);
            }
          }
        }

        if (opts.spawnPaneFn) {
          const result = await opts.spawnPaneFn({ agent, cwd, providerId, model });
          if (result.ok && result.paneId) {
            roleMap.set(result.paneId, "worker");
            if (label && opts.paneLabels) opts.paneLabels.set(result.paneId, label);
          }
          return result;
        }
        const config = { agent: agent || "openclaude", cwd: cwd || undefined, providerId: providerId || undefined, model: model || undefined };
        const paneId = await ptyManager.spawn(config);
        roleMap.set(paneId, "worker");
        if (label && opts.paneLabels) opts.paneLabels.set(paneId, label);
        if (opts.onPaneCreated) opts.onPaneCreated({ paneId, agent: config.agent, cwd: config.cwd, providerId, model });
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
      // Sanitize newlines — readline treats \n as Enter, causing premature submission
      const sanitized = finalText.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
      ptyManager.writeSilent(paneId, sanitized);
      if (submit) {
        // Send Enter as a separate write after a delay so readline can finish
        // processing pasted text before receiving the submit signal.
        // Sending sanitized+"\r" as one chunk causes readline to buffer the \r
        // inside paste-mode and never submit.
        // Delay scales with text length: large prompts need more time for the
        // shell to process all characters before it can handle the Enter key.
        const delay = Math.min(3000, Math.max(100, 100 + sanitized.length * 0.5));
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
  };
}

module.exports = { createPaneHandlers };
