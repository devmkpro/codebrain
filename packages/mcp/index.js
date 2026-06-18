"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Token-aware truncation helpers ───────────────────────────────────────────
// These prevent massive MCP responses from flooding the LLM context window.
// They operate ONLY on the serialized output — internal logic is untouched.

/**
 * Truncate a long string (e.g. HTML) and append a notice.
 * Returns the original string if it's within the limit.
 */
function truncateText(text, maxChars = 50_000) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const omitted = text.length - maxChars;
  return (
    truncated +
    `\n\n<!-- [TRUNCATED by MCP — ${omitted.toLocaleString()} chars omitted. ` +
    `Use browser_get_text() or browser_get_accessibility_tree() for a compact view, ` +
    `or pass a CSS selector to get_html() to target a specific element.] -->`
  );
}

/**
 * Strip heavy fields from pane metadata returned by ptyManager.list().
 * Keeps only what the orchestrator needs to manage workers.
 * Heavy fields: args (string[]), session (Record<string,unknown>),
 * workspacePath, claudeSessionId — can be 5-20 KB each when present.
 */
function stripHeavyPaneFields(panes) {
  if (!Array.isArray(panes)) return panes;
  return panes.map(({ args, session, workspacePath, claudeSessionId, ...rest }) => rest);
}

// ── Message Bus (file-based, cross-process) ─────────────────────────────────
const MESSAGES_DIR = path.join(os.homedir(), ".codebrain", "messages");

function ensureMessagesDir() {
  if (!fs.existsSync(MESSAGES_DIR)) {
    fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  }
}

function paneInbox(paneId) {
  return path.join(MESSAGES_DIR, paneId);
}

function ensureInbox(paneId) {
  const dir = paneInbox(paneId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Creates a CodeBrain MCP server that exposes PTY and task management tools
 * to Claude/Gemini/Codex agents running inside the app.
 *
 * @param {Object} bridge - { spawnPane, writePane, readPane, waitPaneIdle, listPanes, setRole, todoManager }
 * @returns {McpServer}
 */
function createCodebrainMCPServer(bridge) {
  const server = new McpServer(
    { name: "codebrain", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Debounce map for message notifications: paneId → lastNotifyTimestamp
  let msgNotifyDebounce = null; // lazy-initialized to avoid polluting scope

  // ── mcp__codebrain__pane_spawn ─────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_spawn",
    "Open a NEW VISIBLE terminal pane in the CodeBrain workspace grid. Use this instead of your built-in background agent tool if you want the user to see the progress. Returns the paneId.",
    {
      cwd:          z.string().optional().describe("Working directory for the new pane. STRONGLY RECOMMENDED — always pass your workspace path here to ensure the pane opens in the correct project. If omitted, the system guesses from active panes."),
      agent:        z.string().optional().describe("Agent binary: claude, codex, gemini, openclaude, shell. Defaults to claude."),
      providerId:   z.string().optional().describe("Provider ID to use for the new pane."),
      model:        z.string().optional().describe("Model to use for the new pane."),
      label:        z.string().optional().describe("A short label to identify this pane in pane_list (e.g. 'backend', 'frontend', 'ui-tester'). Helps the orchestrator reuse existing workers."),
      description:  z.string().optional().describe("Short description of the task this pane will perform. Stored in actor registry for status/monitoring."),
      parentPaneId: z.string().optional().describe("The pane_id of the parent/orchestrator that spawned this pane. Used for cancel cascade and hierarchy tracking."),
    },
    async (args) => {
      try {
        const result = await bridge.spawnPane({
          agent:        args.agent,
          cwd:          args.cwd,
          providerId:   args.providerId,
          model:        args.model,
          label:        args.label,
          description:  args.description,
          parentPaneId: args.parentPaneId,
        });

        const paneId = result?.paneId;
        if (!paneId || result?.error) {
          return { content: [{ type: "text", text: `error: ${result?.error ?? "spawn failed"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ paneId, ok: true, reused: result.reused || false }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_spawn_and_wait ────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_spawn_and_wait",
    "Spawn a pane and BLOCK until it goes idle (run mode). Returns the pane output + parsed status header. Use when you need the result inline (like MiMo action:'run'). For fire-and-forget, use pane_spawn instead.",
    {
      cwd:          z.string().optional().describe("Working directory for the new pane."),
      agent:        z.string().optional().describe("Agent binary: claude, codex, gemini, openclaude. Defaults to claude."),
      providerId:   z.string().optional().describe("Provider ID to use."),
      model:        z.string().optional().describe("Model to use."),
      label:        z.string().optional().describe("Label to identify this pane."),
      description:  z.string().min(1).describe("Short description of the task (3-5 words). Required."),
      parentPaneId: z.string().optional().describe("Parent orchestrator pane_id for hierarchy tracking."),
      timeout_ms:   z.number().int().positive().optional().describe("Max wait time in milliseconds (default 600000 = 10 min)."),
    },
    async (args) => {
      try {
        const result = await bridge.paneSpawnAndWait({
          agent:        args.agent,
          cwd:          args.cwd,
          providerId:   args.providerId,
          model:        args.model,
          label:        args.label,
          description:  args.description,
          parentPaneId: args.parentPaneId,
          timeoutMs:    args.timeout_ms,
        });
        if (!result.ok) return { content: [{ type: "text", text: `error: ${result.error}` }], isError: true };
        const output = (result.lines || []).join('\n').slice(-8000); // cap to avoid context overflow
        return { content: [{ type: "text", text: JSON.stringify({
          paneId: result.paneId,
          timedOut: result.timedOut,
          reportedStatus: result.reportedStatus,
          reportedSummary: result.reportedSummary,
          output,
        }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_kill_cascade ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_kill_cascade",
    "Kill a pane and ALL its registered children recursively (cancel cascade). Use when you want to terminate an orchestrator and all workers it spawned. Safe to call on leaf panes (no children) — just kills that one pane.",
    {
      paneId: z.string().describe("The pane to kill (with all its children)."),
    },
    async (args) => {
      try {
        await bridge.killPaneCascade(args.paneId);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, paneId: args.paneId }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__actor_status ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__actor_status",
    "Get the actor registry entry for a pane: status (pending/running/idle/stuck/cancelled), turn_count, last_turn_time, last_error, parent_pane_id, description.",
    {
      paneId: z.string().describe("The pane ID to inspect."),
    },
    async (args) => {
      try {
        const result = bridge.actorStatus({ paneId: args.paneId });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__actor_list ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__actor_list",
    "List all active actors (panes) in the current workspace from the persistent registry. Shows status, turn count, parent hierarchy, and stuck detection. More detailed than pane_list.",
    {
      include_terminal: z.boolean().optional().describe("Include already-completed panes (default false — only active ones)."),
    },
    async (args) => {
      try {
        const result = bridge.actorList({ includeTerminal: args.include_terminal });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_write ─────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_write",
    "Write text or a prompt to an existing pane (simulates keyboard input into that terminal).",
    {
      paneId: z.string().describe("The target pane ID."),
      text:   z.string().describe("Text to send to the pane's stdin."),
      submit: z.boolean().optional().describe("If true, append a newline to submit as a command."),
    },
    async (args) => {
      try {
        const shouldSubmit = args.submit !== false; // default true
        await bridge.writePane(args.paneId, args.text, shouldSubmit);
        return { content: [{ type: "text", text: "ok" }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_read ──────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_read",
    "Read recent output from a pane's terminal buffer.",
    {
      paneId: z.string().describe("The target pane ID."),
      lastN:  z.number().optional().describe("Number of recent lines to return (default 200)."),
    },
    async (args) => {
      try {
        const result = await bridge.readPane(args.paneId, args.lastN ?? 200);
        const text = Array.isArray(result?.lines) ? result.lines.join("\n") : (result?.lines ?? "");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_wait_idle ─────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_wait_idle",
    "Wait until a pane becomes idle (no new output for ~3s). Call after pane_write to know when the agent finished.",
    {
      paneId:  z.string().describe("The pane to wait on."),
      timeout: z.number().optional().describe("Max milliseconds to wait (default 300000 = 5 min)."),
    },
    async (args) => {
      try {
        const result = await bridge.waitPaneIdle(args.paneId, args.timeout ?? 300000);
        return { content: [{ type: "text", text: JSON.stringify(result ?? { idle: true }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_list ──────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_list",
    "List all active terminal panes in the current session, including panes created by the user via +Terminal. Returns paneId, label, providerId, model, status, isOrchestrator, and hasAgent (true if the pane has already received a pane_write or user input).",
    {},
    async () => {
      try {
        const panes = await bridge.listPanes();
        const lean = stripHeavyPaneFields(panes);
        return { content: [{ type: "text", text: JSON.stringify(lean, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_set_role ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_set_role",
    "Mark an existing pane as a worker or orchestrator. Use this to claim panes created by the user via +Terminal and assign them a role in the squad.",
    {
      paneId: z.string().describe("The target pane ID (from pane_list or pane_spawn)."),
      role:   z.enum(["worker", "orchestrator"]).describe('Role to assign: "worker" or "orchestrator".'),
    },
    async (args) => {
      try {
        const result = await bridge.setRole(args.paneId, args.role);
        if (!result?.ok) {
          return { content: [{ type: "text", text: `error: ${result?.error ?? "unknown error"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__todo_manager ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__todo_manager",
    "Manage the user-visible task list shown in the CodeBrain sidebar. Actions: set_tasks, add_task, move_to_task, read_list, mark_all_done.",
    {
      action: z.enum(["set_tasks", "add_task", "move_to_task", "read_list", "mark_all_done"])
               .describe("Action to perform."),
      tasks: z.array(z.string()).optional()
               .describe("For set_tasks: ordered list of task names."),
      task: z.string().optional()
              .describe("For add_task: task name to add."),
      moveToTask: z.string().optional()
                   .describe("For move_to_task: task name to activate (marks previous ones done)."),
      taskNameActive: z.string().optional()
                       .describe("Display name while the task is in-progress."),
      taskNameComplete: z.string().optional()
                         .describe("Display name when the task is done."),
    },
    async (args) => {
      try {
        const result = await bridge.todoManager(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__task_tree ─────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__task_tree",
    "Manage hierarchical tasks with tree structure (T1, T1.1, T1.2). SQLite-backed, persistent. Actions: create, update, list, get, delete, gate. Gate returns incomplete tasks for pre-stop check.",
    {
      action: z.enum(["create", "update", "list", "get", "delete", "gate"])
               .describe("Action: create, update, list, get, delete, gate."),
      id: z.string().optional().describe("Task ID (pattern: T1, T1.1, T1.2). Required for create/update/get/delete."),
      description: z.string().optional().describe("Task description. Required for create."),
      status: z.enum(["open", "in_progress", "blocked", "done", "abandoned"]).optional()
               .describe("New status for update action."),
      parentId: z.string().optional().describe("Parent task ID for create (makes this a subtask)."),
      owner: z.string().optional().describe("Pane ID of the assigned agent."),
      sessionId: z.string().optional().describe("Session ID for grouping."),
      workspace: z.string().optional().describe("Workspace path filter."),
    },
    async (args) => {
      try {
        const store = opts.memoryStore;
        if (!store) return { content: [{ type: "text", text: "error: memory store not available" }], isError: true };
        let result;
        switch (args.action) {
          case "create":
            result = store.taskTreeCreate({ id: args.id, description: args.description, parentId: args.parentId, sessionId: args.sessionId, owner: args.owner, workspace: args.workspace });
            break;
          case "update":
            result = store.taskTreeUpdate({ id: args.id, status: args.status, owner: args.owner, workspace: args.workspace });
            break;
          case "list":
            result = store.taskTreeList({ sessionId: args.sessionId, status: args.status, workspace: args.workspace, parentId: args.parentId });
            break;
          case "get":
            result = store.taskTreeGet({ id: args.id });
            break;
          case "delete":
            result = store.taskTreeDelete({ id: args.id });
            break;
          case "gate":
            result = store.taskTreeGate({ workspace: args.workspace });
            break;
          default:
            result = { ok: false, error: `unknown action: ${args.action}` };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__auto_dream ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__auto_dream",
    "Run auto-dream (consolidate working memories into semantic summaries) or auto-distill (extract repeated workflow patterns from trajectories). Use periodically for memory hygiene.",
    {
      mode: z.enum(["dream", "distill"]).describe("Mode: 'dream' consolidates working memories, 'distill' extracts workflow patterns from trajectories."),
      workspace: z.string().optional().describe("Workspace to scope the operation."),
      maxAge: z.number().optional().describe("For dream: max age in seconds of working memories to consolidate (default: 7 days)."),
      minOccurrences: z.number().optional().describe("For distill: minimum occurrences to count as pattern (default: 2)."),
    },
    async (args) => {
      try {
        const store = opts.memoryStore;
        if (!store) return { content: [{ type: "text", text: "error: memory store not available" }], isError: true };
        let result;
        if (args.mode === "dream") {
          result = store.autoDream({ workspace: args.workspace, maxAge: args.maxAge });
        } else {
          result = store.autoDistill({ workspace: args.workspace, minOccurrences: args.minOccurrences });
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_write_many ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_write_many",
    "Write the same text to multiple panes at once. Useful for broadcasting a task prompt to all workers simultaneously.",
    {
      paneIds: z.array(z.string()).describe("Array of pane IDs to write to."),
      text:    z.string().describe("Text to send to each pane's stdin."),
      submit:  z.boolean().optional().describe("If true (default), append newline to submit."),
    },
    async (args) => {
      try {
        const result = await bridge.writeManyPanes({ paneIds: args.paneIds, text: args.text, submit: args.submit !== false });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__handoff_submit ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__handoff_submit",
    "Worker calls this as its LAST action to report a structured result. The orchestrator uses handoff_wait to collect these results.",
    {
      paneId:    z.string().describe("The worker's pane ID."),
      summary:   z.string().describe("Brief summary of what was accomplished or what blocked progress."),
      status:    z.enum(["done", "blocked", "error"]).describe("Result status: done (success), blocked (needs help), error (failed)."),
      artifacts: z.array(z.string()).optional().describe("List of artifact paths or identifiers produced (e.g. file paths, URLs)."),
    },
    async (args) => {
      try {
        const result = await bridge.handoffSubmit(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__handoff_wait ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__handoff_wait",
    "Orchestrator waits for workers to submit their handoff results. Polls until returnOn condition is met or timeout.",
    {
      paneIds:    z.array(z.string()).describe("Worker pane IDs to wait for."),
      returnOn:   z.enum(["any", "all"]).optional().describe("Return when: 'any' (first result) or 'all' (every worker). Default: all."),
      timeoutMs:  z.number().optional().describe("Max wait time in ms (default 300000 = 5 min)."),
    },
    async (args) => {
      try {
        const result = await bridge.handoffWait({ paneIds: args.paneIds, returnOn: args.returnOn || "all", timeoutMs: args.timeoutMs || 300000 });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__agent_list ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__agent_list",
    "List all active and recently exited agents (panes) with their role, model, and status. Data is persisted in SQLite for session history.",
    {
      workspace: z.string().optional().describe("Filter by workspace path."),
      limit:     z.number().optional().describe("Max results (default 50)."),
    },
    async (args) => {
      try {
        const result = await bridge.agentList({ workspace: args.workspace, limit: args.limit });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__agent_messages ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__agent_messages",
    "Retrieve messages sent to a specific agent pane from other agents. Includes full message history persisted in SQLite (unlike pane_read_messages which uses file-based inbox).",
    {
      paneId:     z.string().describe("Target pane ID to get messages for."),
      unreadOnly: z.boolean().optional().describe("If true, only return unread messages."),
      workspace:  z.string().optional().describe("Filter by workspace path."),
      limit:      z.number().optional().describe("Max results (default 50)."),
    },
    async (args) => {
      try {
        const result = await bridge.agentMessages({ paneId: args.paneId, unreadOnly: args.unreadOnly, workspace: args.workspace, limit: args.limit });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_send_message ──────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_send_message",
    "Send a message to another agent pane. Use this for ALL inter-agent coordination: notify a worker about API changes, send a task result to the orchestrator, or ask a question to another worker. The recipient sees a yellow notification in their terminal and MUST respond.",
    {
      from:    z.string().describe("Your pane ID (sender)."),
      to:      z.string().describe("Target pane ID (recipient)."),
      content: z.string().describe("Message content — be specific and include all context the recipient needs."),
      type:    z.enum(["task", "update", "question", "result"]).optional()
                 .describe("Message type: task (assign work), update (notify about changes), question (ask something), result (report completion). Default: update."),
    },
    async (args) => {
      try {
        // ── Workspace isolation: sender and recipient must be in the same workspace ──
        if (bridge.getPaneWorkspacePath) {
          const senderWorkspace = bridge.getPaneWorkspacePath(args.from);
          const recipientWorkspace = bridge.getPaneWorkspacePath(args.to);
          if (senderWorkspace && recipientWorkspace) {
            const resolvedSender = path.resolve(senderWorkspace);
            const resolvedRecipient = path.resolve(recipientWorkspace);
            if (resolvedSender !== resolvedRecipient) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    error: `Cannot send message: sender pane "${args.from}" is in workspace "${senderWorkspace}" but recipient pane "${args.to}" is in workspace "${recipientWorkspace}". Cross-workspace messaging is not allowed.`
                  })
                }],
                isError: true,
              };
            }
          }
        }

        ensureMessagesDir();
        const inbox = ensureInbox(args.to);
        const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const msgType = args.type ?? "update";
        const msg = {
          id,
          from: args.from,
          to: args.to,
          content: args.content,
          type: msgType,
          timestamp: Date.now(),
          read: false,
        };
        const filePath = path.join(inbox, `${id}.json`);
        const jsonStr = JSON.stringify(msg, null, 2);
        fs.writeFileSync(filePath, jsonStr, "utf-8");
        // Force fsync to ensure file is visible on Windows before read
        try {
          const fd = fs.openSync(filePath, "r+");
          fs.fsyncSync(fd);
          fs.closeSync(fd);
        } catch {}

        // Inject a compact one-line notification into the recipient's terminal.
        // Debounced: if multiple messages arrive within 3s, only one ping.
        // Also persist to agent_messages table for durable history.
        try {
          if (bridge.memoryStore) {
            const ws = bridge.getCurrentWorkspacePath?.() || null;
            bridge.memoryStore.saveAgentMessage({
              fromPane: args.from,
              toPane: args.to,
              content: args.content,
              type: msgType,
              workspace: ws,
            });
          }
        } catch {}
        // Inject a compact notification into the recipient's PTY stdin (echo-suppressed).
        // This makes the agent aware of the message so it calls pane_read_messages.
        // Uses writeSilent (not injectOutput) so the CLI agent actually receives it on stdin.
        try {
          if (typeof bridge.messagePane === "function") {
            const shortFrom = args.from.slice(0, 8);
            const typeLabel = msgType.toUpperCase();
            const preview = args.content.length > 120 ? args.content.slice(0, 120) + "..." : args.content;
            const injectMsg = `\n\x1b[33m[MESSAGE from ${shortFrom} | ${typeLabel}] ${preview}\x1b[0m\nUse pane_read_messages to read the full message.\n`;
            await bridge.messagePane(args.to, injectMsg);
          }
        } catch {}

        // ── Desktop notification for incoming message ─────────────────────
        try {
          const configStore = bridge.configStore;
          if (configStore?.get) {
            const notifSettings = configStore.get()?.notifications;
            if (notifSettings?.onMessage) {
              const { Notification } = require("electron");
              if (Notification.isSupported()) {
                const shortFrom = args.from.slice(0, 8);
                new Notification({
                  title: "Codebrain",
                  body: `Mensagem de ${shortFrom}: ${args.content.slice(0, 80)}`,
                }).show();
              }
            }
          }
        } catch {}

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, messageId: id }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pane_read_messages ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_read_messages",
    "Read messages sent to your pane from other agents. Check this before starting work and periodically during execution to catch updates from the orchestrator or other workers.",
    {
      paneId:    z.string().describe("Your pane ID — reads messages from your inbox."),
      unreadOnly: z.boolean().optional()
                    .describe("If true (default), only return unread messages. Set false to read all."),
    },
    async (args) => {
      try {
        ensureMessagesDir();
        const inbox = paneInbox(args.paneId);
        if (!fs.existsSync(inbox)) {
          // Double-check after a small delay (Windows fsync race)
          await new Promise(r => setTimeout(r, 100));
          if (!fs.existsSync(inbox)) {
            return { content: [{ type: "text", text: JSON.stringify({ messages: [], count: 0 }) }] };
          }
        }

        // ── Workspace isolation: resolve recipient pane's workspace ──
        let recipientWorkspace = null;
        if (bridge.getPaneWorkspacePath) {
          recipientWorkspace = bridge.getPaneWorkspacePath(args.paneId);
          if (recipientWorkspace) recipientWorkspace = path.resolve(recipientWorkspace);
        }

        const files = fs.readdirSync(inbox).filter(f => f.endsWith(".json")).sort();
        const messages = [];
        for (const file of files) {
          const filePath = path.join(inbox, file);
          try {
            const raw = fs.readFileSync(filePath, "utf-8");
            const msg = JSON.parse(raw);
            const wantUnreadOnly = args.unreadOnly !== false;
            if (wantUnreadOnly && msg.read) continue;

            // ── Workspace isolation: skip messages from panes in different workspaces ──
            if (recipientWorkspace && msg.from) {
              const senderWorkspace = bridge.getPaneWorkspacePath(msg.from);
              if (senderWorkspace && path.resolve(senderWorkspace) !== recipientWorkspace) {
                continue; // Cross-workspace message — skip silently
              }
            }

            messages.push(msg);
            // Mark as read
            msg.read = true;
            fs.writeFileSync(filePath, JSON.stringify(msg, null, 2), "utf-8");
          } catch (readErr) {
            // Log but continue — don't silently swallow
            process.stderr.write(`[pane_read_messages] Error reading ${file}: ${readErr}\n`);
          }
        }
        return { content: [{ type: "text", text: JSON.stringify({ messages, count: messages.length }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // MEMORY TOOLS — Shared memory for multi-agent coordination
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__memory_write ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__memory_write",
    "Write to shared memory. Use this to persist context, decisions, and findings that other agents need to access. Memory types: episodic (events), semantic (knowledge), procedural (how-to), working (scratch).",
    {
      type:     z.enum(["episodic", "semantic", "procedural", "working"]).optional()
                  .describe("Memory type. Default: working."),
      key:      z.string().describe("Unique key for this memory (e.g. 'api-schema-users', 'decision-auth-jwt')."),
      content:  z.string().describe("The memory content to store."),
      tags:     z.array(z.string()).optional()
                  .describe("Tags for categorization and search (e.g. ['api', 'backend', 'decision'])."),
      agent_id: z.string().optional()
                  .describe("ID of the agent writing this memory."),
      workspace: z.string().optional()
                   .describe("Workspace path. Defaults to current workspace."),
      id:       z.string().optional()
                  .describe("If provided and exists, updates the existing memory instead of creating."),
    },
    async (args) => {
      try {
        const result = await bridge.memoryWrite(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__memory_read ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__memory_read",
    "Read a specific memory by id or key. Use this to retrieve context saved by other agents.",
    {
      id:        z.string().optional().describe("Memory ID to read."),
      key:       z.string().optional().describe("Memory key to read (returns most recent)."),
      workspace: z.string().optional().describe("Workspace scope."),
    },
    async (args) => {
      try {
        const result = await bridge.memoryRead(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__memory_search ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__memory_search",
    "Search shared memories by keyword. Searches across content, keys, and tags. Use this to find context saved by other agents.",
    {
      query:     z.string().describe("Search keyword or phrase."),
      type:      z.enum(["episodic", "semantic", "procedural", "working"]).optional()
                   .describe("Filter by memory type."),
      workspace: z.string().optional().describe("Filter by workspace."),
      limit:     z.number().optional().describe("Max results (default 20)."),
    },
    async (args) => {
      try {
        const result = await bridge.memorySearch(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__memory_list ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__memory_list",
    "List shared memories with optional filters. Returns most recent first.",
    {
      type:      z.enum(["episodic", "semantic", "procedural", "working"]).optional()
                   .describe("Filter by memory type."),
      agent_id:  z.string().optional().describe("Filter by agent ID."),
      workspace: z.string().optional().describe("Filter by workspace."),
      limit:     z.number().optional().describe("Max results (default 50)."),
      offset:    z.number().optional().describe("Pagination offset."),
    },
    async (args) => {
      try {
        const result = await bridge.memoryList(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__memory_delete ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__memory_delete",
    "Delete a memory by id or key.",
    {
      id:        z.string().optional().describe("Memory ID to delete."),
      key:       z.string().optional().describe("Memory key to delete."),
      workspace: z.string().optional().describe("Workspace scope."),
    },
    async (args) => {
      try {
        const result = await bridge.memoryDelete(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__memory_stats ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__memory_stats",
    "Get shared memory statistics: count and size per memory type.",
    {
      workspace: z.string().optional().describe("Filter by workspace."),
    },
    async (args) => {
      try {
        const result = await bridge.memoryStats(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // SWARM TOOLS — Multi-agent coordination
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__swarm_status ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__swarm_status",
    "Get swarm status: active workers, roles, health, topology, and counts. Use this to understand the current state of the agent swarm.",
    {},
    async () => {
      try {
        const result = await bridge.swarmStatus();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__swarm_broadcast ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__swarm_broadcast",
    "Broadcast a message to all active worker panes. Use for announcements that all workers should see (e.g. architecture changes, priority shifts).",
    {
      message: z.string().describe("The message to broadcast to all workers."),
      from:    z.string().optional().describe("Sender identification (usually orchestrator pane ID)."),
    },
    async (args) => {
      try {
        const result = await bridge.swarmBroadcast(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__swarm_assign_task ──────────────────────────────────────
  server.tool(
    "mcp__codebrain__swarm_assign_task",
    "Assign a task to a specific worker by injecting a task message into its terminal. Prefer pane_send_message for detailed task assignments.",
    {
      paneId: z.string().describe("Target worker pane ID."),
      task:   z.string().describe("Task description to assign."),
      from:   z.string().optional().describe("Sender identification."),
    },
    async (args) => {
      try {
        const result = await bridge.swarmAssignTask(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__swarm_worker_health ────────────────────────────────────
  server.tool(
    "mcp__codebrain__swarm_worker_health",
    "Check health of a specific worker: is it alive, what's its recent output, what's its status.",
    {
      paneId: z.string().describe("Worker pane ID to check."),
    },
    async (args) => {
      try {
        const result = await bridge.swarmWorkerHealth(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__swarm_respawn ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__swarm_respawn",
    "Respawn a crashed worker. Creates a new pane with the same configuration as the original.",
    {
      paneId: z.string().describe("The pane ID of the crashed worker to respawn."),
    },
    async (args) => {
      try {
        const result = await bridge.swarmRespawn(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__swarm_set_topology ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__swarm_set_topology",
    "Set the swarm topology: hierarchical (orchestrator→workers), mesh (any-to-any), centralized (all→one).",
    {
      type: z.enum(["hierarchical", "mesh", "centralized"]).describe("Topology type."),
    },
    async (args) => {
      try {
        const result = await bridge.swarmSetTopology(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // PATTERN TOOLS — Learned pattern management
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__pattern_write ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pattern_write",
    "Save a learned pattern extracted from successful task trajectories. Use after completing a task to record what worked.",
    {
      pattern_type:      z.string().describe("Pattern category (e.g. 'api-design', 'refactor', 'test-strategy')."),
      description:       z.string().describe("What the pattern describes and when to apply it."),
      source_trajectory: z.string().optional().describe("The task/actions that led to this pattern."),
      quality_score:     z.number().optional().describe("Confidence score 0-1 (default 0.5)."),
    },
    async (args) => {
      try {
        const result = await bridge.patternWrite(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pattern_list ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pattern_list",
    "List learned patterns. Sorted by quality score (highest first).",
    {
      pattern_type: z.string().optional().describe("Filter by pattern type."),
      limit:        z.number().optional().describe("Max results (default 20)."),
    },
    async (args) => {
      try {
        const result = await bridge.patternList(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pattern_update ─────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pattern_update",
    "Update a pattern's quality score after it was successfully applied.",
    {
      id:            z.string().describe("Pattern ID."),
      quality_score: z.number().describe("New quality score 0-1."),
    },
    async (args) => {
      try {
        const result = await bridge.patternUpdate(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__pattern_delete ─────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pattern_delete",
    "Delete a learned pattern.",
    {
      id: z.string().describe("Pattern ID to delete."),
    },
    async (args) => {
      try {
        const result = await bridge.patternDelete(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TRAJECTORY TOOLS — Action sequence tracking + pattern extraction
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__trajectory_record ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_record",
    "Record a new trajectory (action sequence for a task). Returns trajectory ID for subsequent step additions.",
    {
      session_id:  z.string().optional().describe("Session ID for grouping."),
      agent_id:    z.string().optional().describe("Agent performing the task."),
      workspace:   z.string().optional().describe("Workspace path."),
      task_type:   z.string().optional().describe("Type of task (e.g., 'refactor', 'feature', 'bugfix')."),
      steps:       z.array(z.record(z.unknown())).optional().describe("Initial action steps."),
      outcome:     z.enum(["success", "failure", "partial", "unknown"]).optional().describe("Task outcome."),
      outcome_detail: z.string().optional().describe("Details about the outcome."),
      duration_ms: z.number().optional().describe("Total task duration in ms."),
      tool_calls:  z.number().optional().describe("Number of tool calls made."),
    },
    async (args) => {
      try {
        const result = await bridge.trajectoryRecord(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_add_step ───────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_add_step",
    "Add a step to an existing trajectory. Use for real-time action logging.",
    {
      id:   z.string().describe("Trajectory ID."),
      step: z.record(z.unknown()).describe("Step data (action, tool, params, result, duration)."),
    },
    async (args) => {
      try {
        const result = await bridge.trajectoryAddStep(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_update ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_update",
    "Update trajectory outcome (mark as success/failure after task completes).",
    {
      id:             z.string().describe("Trajectory ID."),
      outcome:        z.enum(["success", "failure", "partial", "unknown"]).describe("Final outcome."),
      outcome_detail: z.string().optional().describe("Details about the outcome."),
      duration_ms:    z.number().optional().describe("Final duration in ms."),
    },
    async (args) => {
      try {
        const result = await bridge.trajectoryUpdate(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_list ───────────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_list",
    "List trajectories with optional filters (session, agent, outcome, task type).",
    {
      session_id: z.string().optional(),
      agent_id:   z.string().optional(),
      workspace:  z.string().optional(),
      outcome:    z.enum(["success", "failure", "partial", "unknown"]).optional(),
      task_type:  z.string().optional(),
      limit:      z.number().optional().describe("Max results (default 20)."),
      offset:     z.number().optional(),
    },
    async (args) => {
      try {
        const result = await bridge.trajectoryList(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_get ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_get",
    "Get a single trajectory by ID with full step details.",
    { id: z.string().describe("Trajectory ID.") },
    async (args) => {
      try {
        const result = await bridge.trajectoryGet(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_stats ──────────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_stats",
    "Get trajectory statistics: counts by outcome, average duration, average tool calls.",
    { workspace: z.string().optional() },
    async (args) => {
      try {
        const result = await bridge.trajectoryStats(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_extract_patterns ───────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_extract_patterns",
    "Extract common action patterns from successful trajectories. Auto-saves high-frequency patterns.",
    {
      task_type:       z.string().optional().describe("Filter by task type."),
      min_occurrences: z.number().optional().describe("Minimum occurrences to count as pattern (default 2)."),
      workspace:       z.string().optional(),
    },
    async (args) => {
      try {
        const result = await bridge.trajectoryExtractPatterns(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__trajectory_delete ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__trajectory_delete",
    "Delete a trajectory record.",
    { id: z.string().describe("Trajectory ID.") },
    async (args) => {
      try {
        const result = await bridge.trajectoryDelete(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // FILE TOOLS — Structured file access for agents
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__file_read ──────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__file_read",
    "Read a file or list directory contents from the workspace. Returns file content (max 100KB) or directory listing.",
    {
      path:     z.string().describe("Relative or absolute path within the workspace."),
      encoding: z.string().optional().describe("File encoding (default: utf-8)."),
    },
    async (args) => {
      try {
        const result = await bridge.fileRead(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__file_budgeted_read ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__file_budgeted_read",
    "Read a file within a token budget. Prioritizes structure (headers, function signatures) over body content. Returns headers-first when file exceeds budget. Use for large files to avoid context overflow.",
    {
      path:          z.string().describe("Relative or absolute path within the workspace."),
      budgetTokens:  z.number().optional().describe("Token budget for the read (default: 4000). ~4 chars per token."),
      encoding:      z.string().optional().describe("File encoding (default: utf-8)."),
    },
    async (args) => {
      try {
        const result = await bridge.fileBudgetedRead(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__file_write ─────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__file_write",
    "Write content to a file in the workspace. Creates parent directories if needed.",
    {
      path:        z.string().describe("Relative or absolute path within the workspace."),
      content:     z.string().describe("Content to write."),
      encoding:    z.string().optional().describe("File encoding (default: utf-8)."),
      createDirs:  z.boolean().optional().describe("Create parent directories if they don't exist (default: true)."),
    },
    async (args) => {
      try {
        const result = await bridge.fileWrite({ ...args, createDirs: args.createDirs !== false });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__file_search ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__file_search",
    "Search for files by name pattern or content. Supports glob patterns (*.ts, **/*.tsx). Skips node_modules and .git.",
    {
      pattern: z.string().optional().describe("Glob pattern for filename matching (e.g. '*.ts', '**/*.tsx')."),
      content: z.string().optional().describe("Search for files containing this text."),
      path:    z.string().optional().describe("Base directory for search. Defaults to workspace root."),
      limit:   z.number().optional().describe("Max results (default 20)."),
    },
    async (args) => {
      try {
        const result = await bridge.fileSearch(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // SYSTEM TOOLS — System info and diagnostics
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__system_info ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__system_info",
    "Get system information: OS, CPU, memory, Node version, workspace path.",
    {},
    async () => {
      try {
        const result = await bridge.systemInfo();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__system_diagnostics ─────────────────────────────────────
  server.tool(
    "mcp__codebrain__system_diagnostics",
    "Get full diagnostics: system health, all pane statuses, MCP server health, memory usage.",
    {},
    async () => {
      try {
        const result = await bridge.systemDiagnostics();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // WORKER DISPATCH TOOLS — Trigger detection and background workers
  // ══════════════════════════════════════════════════════════════════════════

  // ── mcp__codebrain__worker_detect ──────────────────────────────────────────
  server.tool(
    "mcp__codebrain__worker_detect",
    "Scan text for task triggers (optimize, audit, document, refactor, benchmark, testgaps, deepdive). Use to detect if a background worker should be dispatched.",
    {
      text: z.string().describe("Text to scan for trigger patterns (e.g. a user prompt or task description)."),
    },
    async (args) => {
      try {
        const result = await bridge.workerDetect(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__worker_list_triggers ───────────────────────────────────
  server.tool(
    "mcp__codebrain__worker_list_triggers",
    "List all available trigger definitions with their patterns and priorities.",
    {},
    async () => {
      try {
        const result = await bridge.workerListTriggers();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__provider_health ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__provider_health",
    "Get provider health status: success/error counts, error rates, status (healthy/degraded/critical).",
    {},
    async () => {
      try {
        const result = await bridge.providerHealth();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__hooks_status ─────────────────────────────────────────
  server.tool(
    "mcp__codebrain__hooks_status",
    "Get hooks system status: registered hooks, event stats, recent lifecycle events.",
    {},
    async () => {
      try {
        const result = await bridge.hooksStatus();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__hooks_log ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__hooks_log",
    "Get recent lifecycle hook events (pane_spawned, pane_exited, pane_idle, etc).",
    { limit: z.number().optional().describe("Max events to return (default 50)") },
    async (args) => {
      try {
        const result = await bridge.hooksLog(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__hooks_fire ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__hooks_fire",
    "Fire a custom hook event. Useful for testing or automation triggers.",
    { type: z.string().describe("Hook event type (pane_spawned, pane_exited, pane_idle, task_started, task_completed, etc)"), data: z.record(z.unknown()).optional().describe("Event data payload") },
    async (args) => {
      try {
        const result = await bridge.hooksFire({ type: args.type, data: args.data });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__skill_list ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_list",
    "List installed skills (prompt templates and squad templates). Returns skill manifests.",
    {
      type: z.enum(["prompt", "squad"]).optional().describe("Filter by skill type"),
      scope: z.enum(["global", "project"]).optional().describe("'global' = ~/.codebrain/skills, 'project' = <cwd>/.codebrain/skills. Omit to list both."),
      cwd: z.string().optional().describe("Project directory for project-scoped skills (defaults to current workspace)"),
    },
    async (args) => {
      try {
        const result = await bridge.skillList({ type: args.type, scope: args.scope, cwd: args.cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__skill_get ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_get",
    "Get full skill content: manifest + all files (prompt.md, squad.json, README.md).",
    {
      id: z.string().describe("Skill ID (folder name in skills directory)"),
      scope: z.enum(["global", "project"]).optional().describe("Search scope. Omit to search project first, then global."),
      cwd: z.string().optional().describe("Project directory for project-scoped skills"),
    },
    async (args) => {
      try {
        const result = await bridge.skillGet({ id: args.id, scope: args.scope, cwd: args.cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__skill_create ─────────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_create",
    "Create a new skill locally. Use scope='project' to save in <cwd>/.codebrain/skills/ (project-specific), or scope='global' (default) to save in ~/.codebrain/skills/ (available everywhere).",
    {
      id: z.string().describe("Unique skill ID (used as folder name, e.g. 'my-skill')"),
      name: z.string().describe("Human-readable skill name"),
      prompt: z.string().describe("The prompt template content (written to prompt.md)"),
      description: z.string().optional().describe("Short description of what this skill does"),
      type: z.enum(["prompt", "squad"]).optional().describe("Skill type (default: 'prompt')"),
      version: z.string().optional().describe("Version string (default: '1.0.0')"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      scope: z.enum(["global", "project"]).optional().describe("'global' = ~/.codebrain/skills (default, available to all projects), 'project' = <cwd>/.codebrain/skills (only this project)"),
      cwd: z.string().optional().describe("Project directory when scope='project'. Defaults to current workspace."),
    },
    async (args) => {
      try {
        const result = await bridge.skillCreate(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__skill_delete ─────────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_delete",
    "Delete a locally created skill by ID. Removes the skill directory.",
    {
      id: z.string().describe("Skill ID to delete"),
      scope: z.enum(["global", "project"]).optional().describe("Where to look. Omit to search project first, then global."),
      cwd: z.string().optional().describe("Project directory for project-scoped skills"),
    },
    async (args) => {
      try {
        const result = await bridge.skillDelete({ id: args.id, scope: args.scope, cwd: args.cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__skill_install ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_install",
    "Install a skill from the GitLab registry to local ~/.codebrain/skills/.",
    { id: z.string().describe("Skill ID to install from registry") },
    async (args) => {
      try {
        const result = await bridge.skillInstall({ id: args.id });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── mcp__codebrain__skill_uninstall ──────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_uninstall",
    "Uninstall a locally installed skill.",
    { id: z.string().describe("Skill ID to uninstall") },
    async (args) => {
      try {
        const result = await bridge.skillUninstall({ id: args.id });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
      }
    }
  );

  // ── ADVANCED TOOLS — registered but DISABLED by default ─────────────────
  // These are activated on-demand via mcp__codebrain__enable_tool_group.
  // Each server.tool() returns a RegisteredTool with .enable()/.disable() methods.
  // The SDK automatically sends notifications/tools/list_changed when enabled/disabled.

  const advancedToolGroups = {};

  // ── Consensus Tools ────────────────────────────────────────────────────────
  advancedToolGroups.consensus = [
    server.tool("mcp__codebrain__swarm_vote", "Start a vote among agents. Modes: majority, unanimous, weighted.", { question: z.string(), options: z.array(z.string()).min(2), mode: z.enum(["majority","unanimous","weighted"]).optional(), timeoutMs: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmVote(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_cast_vote", "Cast a vote in an active vote.", { voteId: z.string(), paneId: z.string(), choice: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmCastVote(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_elect_leader", "Auto-elect a leader among workers based on capability score.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmElectLeader(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_consensus_status", "Get consensus status: leader, active votes, Raft/PBFT/Gossip node counts.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmConsensusStatus(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__raft_start", "Start a Raft consensus node.", { nodeId: z.string(), peers: z.array(z.string()).optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.raftStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__raft_stop", "Stop a Raft node.", { nodeId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.raftStop(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__raft_append", "Append a command to the Raft log (leader only).", { nodeId: z.string(), command: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.raftAppend(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__raft_status", "Get status of all Raft nodes.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.raftStatus(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__pbft_start", "Start a PBFT node.", { nodeId: z.string(), allNodes: z.array(z.string()) }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.pbftStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__pbft_stop", "Stop a PBFT node.", { nodeId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.pbftStop(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__pbft_propose", "Propose a request via PBFT (primary only).", { nodeId: z.string(), request: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.pbftPropose(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__pbft_view_change", "Initiate PBFT view change.", { nodeId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.pbftViewChange(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__pbft_status", "Get status of all PBFT nodes.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.pbftStatus(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__gossip_start", "Start a gossip node.", { nodeId: z.string(), peers: z.array(z.string()).optional(), fanout: z.number().optional(), intervalMs: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.gossipStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__gossip_stop", "Stop a gossip node.", { nodeId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.gossipStop(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__gossip_set", "Set a value in gossip state (will be disseminated).", { nodeId: z.string(), key: z.string(), value: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.gossipSet(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__gossip_get", "Get a value from gossip state.", { nodeId: z.string(), key: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.gossipGet(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__gossip_sync", "Trigger manual gossip sync round.", { nodeId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.gossipSync(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__gossip_status", "Get status of all gossip nodes.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.gossipStatus(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ── Swarm Pipeline Tools ───────────────────────────────────────────────────
  advancedToolGroups.swarm = [
    server.tool("mcp__codebrain__swarm_fan_out", "Distribute tasks to workers in parallel. Supports domain routing and batch mode.", { tasks: z.array(z.object({ taskId: z.string(), description: z.string(), targetWorker: z.string().optional(), domain: z.string().optional(), dependsOn: z.array(z.string()).optional() })), strategy: z.enum(["round_robin","least_loaded","random","domain_aware"]).optional(), batchMode: z.boolean().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmFanOut(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_fan_in", "Collect and merge results from parallel tasks.", { taskIds: z.array(z.string()), aggregationStrategy: z.enum(["merge","vote","best","domain_grouped"]).optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmFanIn(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_pipeline", "Execute a chain of sequential tasks.", { steps: z.array(z.object({ stepId: z.string(), description: z.string(), targetWorker: z.string().optional() })) }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmPipeline(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_pipeline_status", "Check pipeline execution state.", { pipelineId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmPipelineStatus(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_complete_task", "Mark a pipeline task as complete with result.", { taskId: z.string(), result: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmCompleteTask(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_domain_status", "Get domain-based task routing status.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmDomainStatus(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_worker_loads", "Get worker load distribution.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmWorkerLoads(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_steal_work", "Steal work from an overloaded worker.", { thiefId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmStealWork(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__swarm_score_agents", "Score and rank agents for a task type.", { taskType: z.string().optional(), requiredCapabilities: z.array(z.string()).optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.swarmScoreAgents(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__pane_bus_metrics", "Get MessageBus metrics: messages/sec, latency, queue depths.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.paneBusMetrics(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ── Background Worker Tools ────────────────────────────────────────────────
  advancedToolGroups.worker = [
    server.tool("mcp__codebrain__worker_start", "Start a background maintenance worker.", { name: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_stop", "Stop a background worker.", { name: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerStop(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_status", "Get status of all background workers.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerStatus(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_alerts", "Get recent worker alerts.", { limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerAlerts(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_start_all", "Start all background workers.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerStartAll(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_stop_all", "Stop all background workers.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerStopAll(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_execute_trigger", "Execute an on-demand trigger manually.", { triggerName: z.string(), context: z.object({}).passthrough().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerExecuteTrigger(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_trigger_history", "Get trigger execution history.", { limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.workerTriggerHistory(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_pattern_clusters", "Get k-means pattern clusters.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(bridge.workerManager.getPatternClusters(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__worker_force_evolution", "Force pattern evolution: prune + merge.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(bridge.workerManager.forcePatternEvolution(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ── Knowledge Graph Tools ──────────────────────────────────────────────────
  advancedToolGroups.memory_advanced = [
    server.tool("mcp__codebrain__memory_graph", "Get a memory node and its graph neighbors.", { memoryId: z.string(), depth: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.memoryGraph(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__memory_rank", "Get PageRank scores for all memories.", { workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.memoryRank(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__memory_similar", "Find similar memories using cosine similarity.", { memoryId: z.string(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.memorySimilar(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__memory_transfer", "Transfer a memory to a different scope (project/local/user).", { id: z.string(), target_scope: z.string() }, async ({ id, target_scope }) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.memoryTransfer({ id, targetScope: target_scope }), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ── Event Sourcing Tools ───────────────────────────────────────────────────
  advancedToolGroups.event = [
    server.tool("mcp__codebrain__event_store", "Store an event in the event sourcing system. Append-only log per aggregate.", { aggregate_id: z.string(), aggregate_type: z.string().optional(), event_type: z.string(), payload: z.string().optional(), metadata: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.eventStore(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__event_replay", "Replay events for an aggregate from a sequence. Uses snapshots.", { aggregate_id: z.string(), from_sequence: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.eventReplay(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__event_list", "List events with optional filters.", { aggregate_id: z.string().optional(), event_type: z.string().optional(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.eventList(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__event_snapshot", "Force a snapshot for an aggregate.", { aggregate_id: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.eventSnapshot(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__event_stats", "Get event sourcing statistics.", { workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.eventStats(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ── Mission Tools ───────────────────────────────────────────────────────
  advancedToolGroups.mission = [
    server.tool("mcp__codebrain__mission_create", "Create a mission scoped to a git worktree.", { title: z.string(), summary: z.string().optional(), worktreePath: z.string().optional(), workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.missionCreate(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__mission_get", "Get mission details by ID.", { id: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.missionGet(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__mission_list", "List missions with optional status filter.", { status: z.string().optional(), workspace: z.string().optional(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.missionList(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__mission_set", "Update mission metadata.", { id: z.string(), updates: z.object({ title: z.string().optional(), summary: z.string().optional(), worktreePath: z.string().optional(), status: z.string().optional(), metadata: z.string().optional() }) }, async ({ id, updates }) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.missionSet({ id, updates }), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__mission_delete", "Delete a mission.", { id: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.missionDelete(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ════════════════════════════════════════════════════════════════════════════
  // MiMo-Code Features — ESSENTIAL (always enabled)
  // ════════════════════════════════════════════════════════════════════════════

  // ── Session Compaction (essential — context management) ───────────────────
  server.tool("mcp__codebrain__session_compact", "Get compaction status and recommendation for a pane. When context pressure is high, use this to decide if older messages should be summarized.", { paneId: z.string().describe("Target pane ID"), preserveRecentTurns: z.number().optional().describe("Number of recent turns to preserve (default 5)"), summaryPrompt: z.string().optional().describe("Custom prompt for summarization") }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.sessionCompact(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__session_compact_save", "Save a compaction summary after summarizing older messages. Frees context space.", { paneId: z.string(), sessionId: z.string().optional(), summary: z.string().describe("The summarized content"), messagesCompacted: z.number().optional(), tokensSaved: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.sessionCompactSave(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Step Classification (essential — loop control) ────────────────────────
  server.tool("mcp__codebrain__step_classify", "Classify an assistant step: final|continue|filtered|think-only|invalid|failed. Used for loop control decisions.", { output: z.string().optional(), hasPendingTools: z.boolean().optional(), hasError: z.boolean().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.stepClassify(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__step_classify_batch", "Classify multiple assistant steps at once.", { steps: z.array(z.object({ output: z.string().optional(), hasPendingTools: z.boolean().optional(), hasError: z.boolean().optional() })) }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.stepClassifyBatch(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Text Loop Recovery (essential — prevents stuck agents) ────────────────
  server.tool("mcp__codebrain__text_loop_check", "Check if an agent's text output is looping (3+ identical outputs). Injects recovery prompts.", { paneId: z.string(), output: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.textLoopCheck(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__text_loop_reset", "Reset text loop detection buffer for a pane.", { paneId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.textLoopReset(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Goal / Stop Condition (essential — autonomous work) ──────────────────
  server.tool("mcp__codebrain__goal_set", "Set a goal for a pane. An independent judge evaluates if the goal is truly satisfied before allowing the agent to stop.", { paneId: z.string(), goal: z.string().describe("The goal to achieve") }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.goalSet(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__goal_get", "Get current goal and judge verdicts for a pane.", { paneId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.goalGet(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__goal_clear", "Clear the goal for a pane (manual override).", { paneId: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.goalClear(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__goal_judge", "Record a judge's verdict on goal satisfaction. The judge should be an independent model that reads the transcript.", { paneId: z.string(), satisfied: z.boolean(), impossible: z.boolean().optional(), reason: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.goalJudge(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Cross-Session History (essential — persistent memory) ─────────────────
  server.tool("mcp__codebrain__history_search", "Search cross-session conversation history with FTS5. Filters: scope, session, kind, tool_name, time range.", { query: z.string(), scope: z.string().optional(), sessionId: z.string().optional(), kind: z.string().optional().describe("user_text|assistant_text|tool_input|tool_error|reasoning|tool_output"), toolName: z.string().optional(), since: z.number().optional(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.historySearch(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__history_record", "Record a conversation message for cross-session history search.", { sessionId: z.string(), role: z.string(), content: z.string(), kind: z.string().optional(), toolName: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.historyRecord(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Checkpoint (essential — session persistence) ──────────────────────────
  server.tool("mcp__codebrain__checkpoint_write", "Save a checkpoint for long-running sessions. Preserves state across context limits.", { sessionId: z.string().optional(), content: z.string(), topic: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.checkpointWrite(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__checkpoint_read", "Read a saved checkpoint.", { sessionId: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.checkpointRead(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Question Tool (essential — user interaction) ──────────────────────────
  server.tool("mcp__codebrain__question_ask", "Ask the user a structured question with predefined options. Supports headless auto-resolve.", { paneId: z.string().optional(), question: z.string(), options: z.array(z.string()), allowCustom: z.boolean().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.questionAsk(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__question_answer", "Submit an answer to a pending question.", { questionId: z.string(), answer: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.questionAnswer(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__question_list", "List pending questions awaiting answers.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.questionList(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Multi-Edit (essential — convenience) ──────────────────────────────────
  server.tool("mcp__codebrain__file_multi_edit", "Batch multiple edit operations on a single file in one call. Each edit specifies oldString/newString.", { path: z.string().describe("Absolute file path"), edits: z.array(z.object({ oldString: z.string(), newString: z.string().optional(), replaceAll: z.boolean().optional() })) }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.fileMultiEdit(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  // ── Provider Prompts (essential — model optimization) ─────────────────────
  server.tool("mcp__codebrain__provider_prompt", "Get model-specific prompt additions optimized for the current model family (Claude, Gemini, GPT, MIMO).", { model: z.string().optional(), providerId: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.providerPrompt(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });
  server.tool("mcp__codebrain__provider_prompt_list", "List all available provider prompt families.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.providerPromptList(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } });

  console.log(`[MCP] 20 MiMo-Code ESSENTIAL tools registered (compaction, step-classify, text-loop, goal, history, checkpoint, question, multi-edit, provider-prompt)`);

  // ── Expanded Hooks Tools ───────────────────────────────────────────────────
  advancedToolGroups.hooks_advanced = [
    server.tool("mcp__codebrain__hooks_export_logs", "Export hook logs in JSONL or CSV format.", { format: z.string().optional(), since: z.number().optional(), types: z.array(z.string()).optional(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.hooksExportLogs(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__hooks_event_stats", "Get hook event statistics by type and correlation.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.hooksEventStats(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
    server.tool("mcp__codebrain__hooks_correlation_events", "Get all events for a correlation ID.", { correlation_id: z.string() }, async ({ correlation_id }) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.hooksCorrelationEvents({ correlationId: correlation_id }), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; } }),
  ];

  // ── MiMo-Code: Session Advanced (10 tools) ───────────────────────────────
  advancedToolGroups.session_advanced = [
    server.tool("mcp__codebrain__session_compaction_history", "Get compaction history for a session.", { sessionId: z.string().optional(), workspace: z.string().optional(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.sessionCompactionHistory(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__snapshot_track", "Create a snapshot of the current workspace state for later revert.", { sessionId: z.string().optional(), messageIndex: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.snapshotTrack(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__snapshot_list", "List snapshots for a session.", { sessionId: z.string().optional(), limit: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.snapshotList(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__snapshot_revert", "Revert workspace to a specific snapshot.", { snapshotHash: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.snapshotRevert(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__checkpoint_validate", "Validate checkpoint quality: required sections, token budgets, ordering.", { content: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.checkpointValidate(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__checkpoint_state", "Get checkpoint state for a session.", { sessionId: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.checkpointState(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__history_around", "Get messages around a specific message ID for context.", { messageId: z.number(), before: z.number().optional(), after: z.number().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.historyAround(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
  ];

  // ── MiMo-Code: LSP (12 tools) — semantic code navigation ────────────────
  advancedToolGroups.lsp = [
    server.tool("mcp__codebrain__lsp_start", "Start a language server for a given language.", { language: z.string().describe("typescript|python|rust|go|javascript"), workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_stop", "Stop a language server.", { language: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspStop(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_servers", "List running language servers.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspServers(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_go_to_definition", "Go to definition of a symbol at a specific position.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspGoToDefinition(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_find_references", "Find all references to a symbol.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspFindReferences(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_hover", "Get hover info (type, docs) for a symbol.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspHover(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_document_symbol", "Get document symbols (outline) for a file.", { file: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspDocumentSymbol(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_workspace_symbol", "Search for symbols across the workspace.", { query: z.string() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspWorkspaceSymbol(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_go_to_implementation", "Go to implementation of a symbol.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspGoToImplementation(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_prepare_call_hierarchy", "Prepare call hierarchy for a symbol.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspPrepareCallHierarchy(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_incoming_calls", "Get incoming calls to a function.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspIncomingCalls(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__lsp_outgoing_calls", "Get outgoing calls from a function.", { file: z.string(), line: z.number(), character: z.number() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.lspOutgoingCalls(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
  ];

  // ── MiMo-Code: Advanced Workflows (11 tools) — max mode, compose, plan ──
  advancedToolGroups.workflows = [
    server.tool("mcp__codebrain__max_mode_run", "Run a prompt in MAX MODE: N parallel candidates, judge selects best. Higher quality for complex tasks.", { prompt: z.string(), candidates: z.number().optional().describe("Number of candidates (2-10, default 5)"), judgeModel: z.string().optional(), judgeCriteria: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.maxModeRun(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__max_mode_candidate", "Submit a candidate result for judge evaluation in max mode.", { runId: z.string(), candidateIndex: z.number(), output: z.string(), approach: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.maxModeCandidate(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__max_mode_judge", "Judge selects the best candidate from submitted results.", { runId: z.string(), candidates: z.array(z.object({ index: z.number(), output: z.string(), approach: z.string().optional() })) }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.maxModeJudge(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__compose_start", "Start a specs-driven compose workflow: plan → execute → review → test → debug → verify → merge.", { spec: z.string().optional(), workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.composeStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__compose_advance", "Advance to the next compose phase.", { composeId: z.string(), currentPhase: z.number(), phaseResult: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.composeAdvance(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__compose_phases", "Get the list of compose workflow phases.", {}, async () => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.composePhases(), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__plan_start", "Start a read-only planning session. Cannot edit files — only analyze and produce a plan.", { paneId: z.string().optional(), goal: z.string().optional(), workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.planStart(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__plan_save", "Save a plan document to disk.", { planId: z.string().optional(), content: z.string(), workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.planSave(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__plan_read", "Read a saved plan document.", { planId: z.string(), workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.planRead(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__plan_list", "List saved plans for the workspace.", { workspace: z.string().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.planList(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
    server.tool("mcp__codebrain__plan_exit", "Exit plan mode and optionally switch to build mode.", { paneId: z.string().optional(), switchToBuild: z.boolean().optional() }, async (args) => { try { return { content: [{ type: "text", text: JSON.stringify(await bridge.planExit(args), null, 2) }] }; } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; } }),
  ];

  // ── DISABLE all advanced tool groups on startup ─────────────────────────
  for (const refs of Object.values(advancedToolGroups)) {
    refs.forEach(ref => ref.disable());
  }
  const advancedToolCount = Object.values(advancedToolGroups).reduce((sum, refs) => sum + refs.length, 0);
  console.log(`[MCP] ${advancedToolCount} advanced tools disabled (activate via enable_tool_group)`);

  // ── RE-ENABLE essential advanced groups (always available) ─────────────
  // These groups are advanced in implementation but essential in usage:
  // - session_advanced: compaction, snapshots, checkpoints — critical for long sessions
  // - memory_advanced: knowledge graph, PageRank, similarity — core intelligence
  // - mission: structured workflow goals — fundamental coordination
  const essentialAdvancedGroups = ["session_advanced", "memory_advanced", "mission"];
  for (const name of essentialAdvancedGroups) {
    const refs = advancedToolGroups[name];
    if (refs) refs.forEach(ref => ref.enable());
  }
  console.log(`[MCP] Essential advanced groups enabled: ${essentialAdvancedGroups.join(", ")}`);

  // ── Meta-tools: enable_tool_group + tool_groups (always enabled) ────────
  const activatedGroups = new Set();

  server.tool(
    "mcp__codebrain__enable_tool_group",
    "Activate additional MCP tool groups on demand. Call this BEFORE using tools from disabled groups. ALWAYS-ON groups (no activation needed): session_advanced (7), memory_advanced (4), mission (5). ON-DEMAND groups: browser (60), fetch (5), mr (5), swarm (10), worker (10), consensus (19), event (5), hooks_advanced (3), lsp (12), workflows (11). Essential tools (pane, memory, pattern, file, task, hooks, skill, system, todo, agent, provider, handoff, goal, checkpoint, snapshot, compaction) are always available. BROWSER WORKFLOW: (1) enable_tool_group('browser') → (2) browser_launch() → (3) browser_navigate(url).",
    {
      group: z.enum(["browser", "fetch", "mr", "swarm", "worker", "consensus", "event", "mission", "memory_advanced", "hooks_advanced", "session_advanced", "lsp", "workflows"])
        .describe("Tool group to activate. Use tool_groups() to see all available groups."),
    },
    async ({ group }) => {
      try {
        // Idempotent: skip if already activated
        if (activatedGroups.has(group)) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, group, message: `${group} tools already active.` }) }] };
        }

        // Browser and fetch tools are registered lazily (not at startup)
        if (group === "browser") {
          registerBrowserTools(server, bridge);
          activatedGroups.add(group);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, group, tools_enabled: 60, message: "Browser tools activated. You can now use browser_* tools." }) }] };
        }
        if (group === "fetch") {
          registerFetchTools(server, bridge);
          activatedGroups.add(group);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, group, tools_enabled: 5, message: "Fetch tools activated. You can now use browser_fetch* tools." }) }] };
        }
        if (group === "mr") {
          registerMRTools(server, bridge);
          activatedGroups.add(group);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, group, tools_enabled: 5, message: "MR/PR Review tools activated. You can now use mr_setup, mr_list, mr_detail, mr_review, mr_comment." }) }] };
        }
        // Other advanced groups: just enable the already-registered tools
        const refs = advancedToolGroups[group];
        if (!refs) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown group: ${group}. Available: ${Object.keys(advancedToolGroups).join(", ")}` }) }], isError: true };
        }
        refs.forEach(ref => ref.enable());
        activatedGroups.add(group);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, group, tools_enabled: refs.length, message: `${group} tools activated (${refs.length} tools now available).` }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error activating group ${group}: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__tool_groups",
    "List all available MCP tool groups with their status (enabled/disabled) and tool count. Use enable_tool_group to activate disabled groups.",
    {},
    async () => {
      try {
        const groups = Object.entries(advancedToolGroups).map(([name, refs]) => ({
          name,
          toolCount: refs.length,
          enabled: refs[0] ? refs[0].enabled : false,
        }));
        // Browser, fetch, and MR are lazy (registered on demand, not in advancedToolGroups)
        groups.push({ name: "browser", toolCount: 60, enabled: activatedGroups.has("browser") });
        groups.push({ name: "fetch", toolCount: 5, enabled: activatedGroups.has("fetch") });
        groups.push({ name: "mr", toolCount: 5, enabled: activatedGroups.has("mr") });
        groups.push({ name: "lsp", toolCount: 12, enabled: activatedGroups.has("lsp") });
        groups.push({ name: "workflows", toolCount: 11, enabled: activatedGroups.has("workflows") });
        const totalTools = Object.keys(server._registeredTools || {}).length;
        const enabledTools = Object.values(server._registeredTools || {}).filter(t => t.enabled !== false).length;
        return { content: [{ type: "text", text: JSON.stringify({ groups, enabled: enabledTools, total: totalTools }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap-Closing Tools — Auto-Memory Bridge + Security Scanner
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "mcp__codebrain__memory_import_claude",
    "Import ALL Claude Code native memory files (~/.claude/projects/*/memory/*.md) into Codebrain's SQLite store. Enables cross-project knowledge sharing.",
    {},
    async () => {
      try {
        const result = await bridge.memoryImportClaude();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__memory_bridge_status",
    "Get auto-memory bridge status: how many Claude Code memories exist, how many imported, which projects.",
    {},
    async () => {
      try {
        const result = await bridge.memoryBridgeStatus();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__memory_scan_claude",
    "Scan for available Claude Code memory files without importing. Lists all projects and their memory files.",
    {},
    async () => {
      try {
        const result = await bridge.memoryScanClaude();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__security_scan",
    "Scan workspace for security issues: hardcoded secrets (API keys, passwords, tokens), vulnerabilities (SQL/command injection, eval), and code smells. Returns structured findings with severity levels.",
    {
      path: z.string().optional().describe("Directory to scan (default: current workspace)"),
      type: z.enum(["full", "secrets", "vulnerabilities"]).optional().describe("Scan type (default: full)"),
      force: z.boolean().optional().describe("Bypass 30-minute cooldown between scans"),
    },
    async (args) => {
      try {
        const result = await bridge.securityScan(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__security_status",
    "Get the last security scan result from memory. Shows findings summary and status.",
    {},
    async () => {
      try {
        const result = await bridge.securityStatus();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__intelligence_consolidate",
    "Run the full intelligence pipeline: RETRIEVE (search memory+patterns), JUDGE (evaluate quality), DISTILL (extract new patterns from trajectories), CONSOLIDATE (promote short-term→long-term, dream, prune stale). One-shot intelligence maintenance pass.",
    {
      query: z.string().optional().describe("Optional search query for the RETRIEVE step"),
      workspace: z.string().optional().describe("Workspace scope"),
    },
    async (args) => {
      try {
        const result = await bridge.intelligenceConsolidate(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  return server;
}

// ── Browser MCP Tools ────────────────────────────────────────────────────────
// 28 tools for browser automation. Registered on a separate function so the
// main server can import them alongside the existing pane tools.

function registerBrowserTools(server, bridge) {
  // ── MANDATORY GUIDE (must be called before any browser tool) ───────────
  server.tool(
    "mcp__codebrain__browser_guide",
    "MANDATORY: Read this BEFORE using any browser tool. Returns best-practices, navigation rules, and anti-patterns. You MUST call this tool first — other browser tools will not work correctly without this knowledge.",
    {},
    async () => {
      const guide = `# Browser Automation Guide — MANDATORY READING

You MUST read and follow these rules before using any browser tool.

## Rule 1: NEVER guess URLs or routes

WRONG: browser_navigate("http://localhost:3000/login")
WRONG: browser_navigate("http://localhost:3000/dashboard")
WRONG: browser_navigate("http://localhost:3000/api/users")

Why: You don't know if /login, /dashboard, or any route exists. The app might use hash routing (#/login), dynamic segments, or different paths entirely. Guessing URLs leads to 404s, wasted time, and incorrect test results.

RIGHT approach:
1. browser_navigate("http://localhost:3000") — go to the root/home page
2. browser_get_accessibility_tree() or browser_get_html() — read the page
3. Find actual links (<a href="...">, buttons, navigation menus) in the DOM
4. browser_click() on the real link or browser_navigate() with the EXACT href found

## Rule 2: Read the page BEFORE interacting

ALWAYS call browser_get_accessibility_tree() or browser_get_html() BEFORE clicking, filling, or navigating. You need to understand:
- What elements exist on the page
- What their actual selectors are (don't guess CSS selectors)
- What state the page is in (loading? error? content?)

RIGHT approach:
1. browser_get_accessibility_tree() — understand the page structure
2. browser_find_by_text("Login", "link") — find the element
3. browser_click("a[href='/auth/login']") — use the REAL selector from the DOM

## Rule 3: Do NOT open multiple browser panes

WRONG: browser_open() for every page you want to visit
WRONG: Opening 3-4 browser panes simultaneously

Each browser pane consumes memory, WebGL contexts, and system resources. Opening multiple panes causes:
- Performance degradation
- Memory exhaustion
- Confusion about which pane has the current state

RIGHT approach:
- Use ONE browser pane
- browser_navigate() to move between pages
- browser_back() / browser_forward() for history navigation
- Only open a new pane if you TRULY need to see two pages side-by-side

## Rule 4: Use semantic selectors, not guessed ones

WRONG: browser_click(".btn-primary") — guessed class name
WRONG: browser_click("#submit") — guessed ID
WRONG: browser_click("button:nth-child(3)") — fragile positional selector

RIGHT approach:
1. browser_get_accessibility_tree() — see roles, labels, and accessible names
2. browser_find_by_text("Submit", "button") — find by visible text
3. browser_click_text("Submit") — click by text in one call
4. Or use the EXACT selector you confirmed from the DOM

## Rule 5: Wait for page state before asserting

WRONG: browser_get_text() immediately after browser_click() — page may not have updated
WRONG: Checking for content before navigation completes

RIGHT approach:
1. browser_wait_for_load() — after navigation
2. browser_wait_for("selector") — after actions that add elements
3. browser_wait_for_text("expected text") — before assertions
4. Then read/verify the page

## Rule 6: One browser pane per app session

- If you need to test a different app or a completely different flow, navigate the existing pane
- Never open a new pane just because you're starting a new test case
- Reuse the same pane: navigate to home, then follow the new flow

## Rule 7: NEVER read screenshot PNG files

browser_screenshot() ALREADY returns a textual description of the page (URL, title, text, links, inputs, buttons) in the 'page' field of the response.

NEVER use Read/browser_read to open the PNG file. The text description has everything you need. Reading the PNG will cause API errors with some providers (Gemini, MIMO) that don't support image_url content parts.

If you need more detail, use browser_get_accessibility_tree() or browser_get_text() instead.

## Quick Reference — Correct Flow

1. browser_guide() — read this (you're here!)
2. browser_navigate("http://localhost:3000") — go to root
3. browser_wait_for_load() — wait for page
4. browser_get_accessibility_tree() — understand the page
5. Find the real link/button in the DOM
6. browser_click("real-selector-from-dom") — interact
7. browser_wait_for_load() or browser_wait_for("selector") — wait
8. browser_get_text() or browser_screenshot() — verify

NEVER guess. ALWAYS read first. Use ONE pane.`;
      return { content: [{ type: "text", text: guide }] };
    }
  );

  // ── Navigation ──────────────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_navigate",
    "Navigate the browser pane to a URL. Returns final URL and title after load.",
    { url: z.string().describe("URL to navigate to"), pane_id: z.string().optional().describe("Browser pane ID (auto-detected if omitted)") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserNavigate(args.url, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_open",
    "Open a NEW browser pane and navigate to a URL. Returns the new paneId.",
    { url: z.string().describe("URL to open") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserOpen(args.url)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_get_pane_id",
    "Get the current active browser pane ID. Use this to recover from pane ID loss.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.getBrowserPaneId()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_record_pane",
    "Record/update the active browser pane ID. Call this after opening a browser to maintain persistence.",
    { pane_id: z.string().describe("The browser pane ID to record as active") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.recordBrowserPane(args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_list_panes",
    "List all active browser panes and show which one is currently active.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.listBrowserPanes()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_clear_pane_cache",
    "Clear the browser pane cache. Use if you need to reset the active pane state.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.clearBrowserPaneCache()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_back",
    "Go back in browser history.",
    { pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserBack(args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_forward",
    "Go forward in browser history.",
    { pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserForward(args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_reload",
    "Reload the current page. Pass hard=true to bypass cache.",
    { hard: z.boolean().optional().describe("Hard reload (ignore cache)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserReload(args.hard, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── DOM Reading ─────────────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_get_html",
    "Get HTML content for scraping. Without a selector, returns only meaningful body content (strips <script>, <style>, <meta>, <link>, comments, icon SVGs). With a selector, returns that element's clean HTML. Response is auto-truncated at 50k chars.",
    { selector: z.string().optional().describe("CSS selector (omit for clean body HTML)"), pane_id: z.string().optional() },
    async (args) => {
      try {
        const result = await bridge.browserGetHtml(args.selector, args.pane_id);
        // Truncate the HTML field to protect the LLM context window
        if (result && typeof result === "object" && typeof result.html === "string") {
          result.html = truncateText(result.html);
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_get_text",
    "Get visible text content (no HTML tags) of the page or element.",
    { selector: z.string().optional().describe("CSS selector (omit for body)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetText(args.selector, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_get_accessibility_tree",
    "Get the accessibility tree (roles, labels, bounds) of the page. Best for AI understanding of page structure.",
    { max_depth: z.number().optional().describe("Max tree depth (default 10)"), max_nodes: z.number().optional().describe("Max nodes to return (default 300)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetA11yTree(args.max_depth, args.max_nodes, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_find_by_text",
    "Find elements by their visible text content. Optionally filter by role (button, link, input, heading, etc).",
    { text: z.string().describe("Text to search for"), role: z.string().optional().describe("ARIA role filter"), exact: z.boolean().optional().describe("Exact match"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFindByText(args.text, args.role, args.exact, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_get_element_info",
    "Get comprehensive info about an element: bounds, attributes, role, value, visibility, disabled state.",
    { selector: z.string().describe("CSS selector"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetElement(args.selector, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_get_url",
    "Get the current URL and page title.",
    { pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetUrl(args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── DOM Interaction ─────────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_click",
    "Click an element matching the CSS selector. Dispatches full mouse event sequence.",
    { selector: z.string().describe("CSS selector"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserClick(args.selector, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fill",
    "Fill an input or textarea with a value. Dispatches focus, input, and change events.",
    { selector: z.string().describe("CSS selector"), value: z.string().describe("Value to fill"), clear_first: z.boolean().optional().describe("Clear field before filling"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFill(args.selector, args.value, args.clear_first, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_select",
    "Select an option in a <select> element by value or visible text.",
    { selector: z.string().describe("CSS selector for <select>"), value_or_text: z.string().describe("Option value or visible text"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserSelect(args.selector, args.value_or_text, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_check",
    "Check or uncheck a checkbox/radio. Omit checked to toggle.",
    { selector: z.string().describe("CSS selector"), checked: z.boolean().optional().describe("true=check, false=uncheck, omit=toggle"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserCheck(args.selector, args.checked, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_clear",
    "Clear an input field (select all + delete).",
    { selector: z.string().describe("CSS selector"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserClear(args.selector, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_focus",
    "Focus an element without clicking it.",
    { selector: z.string().describe("CSS selector"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFocus(args.selector, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_hover",
    "Hover over an element (triggers :hover CSS, tooltips, dropdowns).",
    { selector: z.string().describe("CSS selector"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserHover(args.selector, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Coordinate-based Interaction ────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_click_at",
    "Click at exact screen coordinates. Useful when selector is unreliable.",
    { x: z.number().describe("X coordinate"), y: z.number().describe("Y coordinate"), button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default left)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserClickAt(args.x, args.y, args.button, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_hover_at",
    "Hover at exact screen coordinates.",
    { x: z.number(), y: z.number(), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserHoverAt(args.x, args.y, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_drag",
    "Drag from (x1,y1) to (x2,y2). Steps controls interpolation smoothness.",
    { x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), steps: z.number().optional().describe("Interpolation steps (default 10)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserDrag(args.x1, args.y1, args.x2, args.y2, args.steps, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_scroll",
    "Scroll the page or a specific element.",
    { selector: z.string().optional().describe("CSS selector (omit for page)"), direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"), amount: z.number().describe("Pixels to scroll"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserScroll(args.selector, args.direction, args.amount, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Keyboard ────────────────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_type",
    "Type text character by character into the focused element.",
    { text: z.string().describe("Text to type"), delay_ms: z.number().optional().describe("Delay between keystrokes in ms (0=instant)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserType(args.text, args.delay_ms, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_key",
    "Press a single key: Enter, Escape, Tab, Backspace, ArrowUp, ArrowDown, Delete, F5, etc.",
    { key: z.string().describe("Key name"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserKey(args.key, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_shortcut",
    "Keyboard shortcut: Ctrl+A, Ctrl+Z, Ctrl+Shift+I, Meta+R, Alt+F4, etc.",
    { keys: z.string().describe("Shortcut combo, e.g. 'Ctrl+Shift+I'"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserShortcut(args.keys, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Wait / Assertions ───────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_wait_for",
    "Wait for an element to appear and be visible in the DOM.",
    { selector: z.string().describe("CSS selector"), timeout_ms: z.number().optional().describe("Timeout in ms (default 5000)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserWaitFor(args.selector, args.timeout_ms, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_wait_for_text",
    "Wait for text to appear on the page or within a specific element.",
    { text: z.string().describe("Text to wait for"), selector: z.string().optional().describe("Scope selector (omit for whole page)"), timeout_ms: z.number().optional(), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserWaitForText(args.text, args.selector, args.timeout_ms, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_wait_for_url",
    "Wait for the URL to match a pattern (string substring or regex).",
    { pattern: z.string().describe("URL pattern (string or regex)"), timeout_ms: z.number().optional(), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserWaitForUrl(args.pattern, args.timeout_ms, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_wait_for_load",
    "Wait for the page to finish loading (network idle).",
    { timeout_ms: z.number().optional().describe("Timeout in ms (default 10000)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserWaitForLoad(args.timeout_ms, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Screenshots ─────────────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_screenshot",
    "Capture a screenshot. Without full_page: captures the visible viewport. With full_page: resizes the webview to capture the ENTIRE scrollable page (up to 8192px height), not just the visible area. Returns file path + textual page description. Do NOT read the PNG — use the text description.",
    { full_page: z.boolean().optional().describe("Capture the entire scrollable page (not just viewport)"), pane_id: z.string().optional() },
    async (args) => {
      try {
        const screenshot = await bridge.browserScreenshot(args.full_page, args.pane_id);
        const summary = await bridge.browserPageSummary(args.pane_id);
        return { content: [{ type: "text", text: JSON.stringify({ ...screenshot, page: summary }) }] };
      }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_screenshot_element",
    "Capture a screenshot of a specific element. Saves to .codebrain/screenshots/. Also returns the element's text content — do NOT read the PNG file.",
    { selector: z.string().describe("CSS selector"), pane_id: z.string().optional() },
    async (args) => {
      try {
        const screenshot = await bridge.browserScreenshotElement(args.selector, args.pane_id);
        const elInfo = await bridge.browserGetElement(args.selector, args.pane_id);
        return { content: [{ type: "text", text: JSON.stringify({ ...screenshot, element: elInfo }) }] };
      }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_annotate",
    "Draw boxes, arrows, or text labels on an existing screenshot. Saves _annotated.png.",
    { path: z.string().describe("Path to screenshot file"), annotations: z.array(z.object({
      type: z.enum(["box", "arrow", "text"]),
      x: z.number(), y: z.number(),
      w: z.number().optional(), h: z.number().optional(),
      label: z.string().optional(), color: z.string().optional()
    })).describe("Annotations to draw") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserAnnotate(args.path, args.annotations)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Console & Network Logs ──────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_console_log",
    "Read ALL browser console entries: console.log/warn/error/info/debug, uncaught JS errors (window.onerror), and unhandled promise rejections. Each entry has timestamp, level, message, and source location. Use level='error' to find all bugs. Filter by level, time, and limit.",
    { level: z.string().optional().describe("Console level filter"), since_ms: z.number().optional().describe("Only entries from last N ms"), limit: z.number().optional().describe("Max entries to return"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserConsoleLog(args.level, args.since_ms, args.limit, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_clear_console",
    "Clear the stored browser console log.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserClearConsole()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_network_log",
    "Read captured network activity: fetch, XHR/AJAX, WebSocket (sent AND received messages with full data), resource loads. Filter by URL, method, status ('5xx','4xx'). Default limit: 50. WebSocket entries have type='ws_send' (outgoing) or type='ws_message' (incoming) with a 'data' field containing the message content.",
    { url_filter: z.string().optional().describe("URL substring filter"), method: z.string().optional().describe("HTTP method (GET, POST, etc)"), status: z.string().optional().describe("Status code or range (e.g. '200', '5xx')"), since_ms: z.number().optional(), limit: z.number().optional().describe("Max entries (default 50)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserNetworkLog(args.url_filter, args.method, args.status, args.since_ms, args.limit || 50, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_network_wait",
    "Wait for a specific network request or WebSocket message to happen. Matches against URL and WebSocket data content. Useful to confirm an API call or WS message was made after a UI action.",
    { pattern: z.string().describe("URL substring to match"), method: z.string().optional().describe("HTTP method filter"), timeout_ms: z.number().optional().describe("Timeout in ms (default 10000)") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserNetworkWait(args.pattern, args.method, args.timeout_ms)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_clear_network",
    "Clear the stored network request log.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserClearNetwork()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Request Log (SQLite-backed auto-intercept) ──────────────────────────
  server.tool(
    "mcp__codebrain__browser_requests_log",
    "Query ALL captured HTTP requests from SQLite (auto-intercepted, always-on). Returns full request+response details: URL, method, status, headers, body, timing, site URL. Filter by url_filter, method, status, since_ms, site_url. Default limit: 100.",
    { url_filter: z.string().optional().describe("URL substring filter"), method: z.string().optional().describe("HTTP method filter (GET, POST, etc)"), status: z.number().optional().describe("HTTP status code filter"), site_url: z.string().optional().describe("Site URL filter"), since_ms: z.number().optional().describe("Only requests after this timestamp (ms)"), limit: z.number().optional().describe("Max results (default 100)"), offset: z.number().optional().describe("Pagination offset") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserRequestsLog(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_requests_search",
    "Search captured requests by text content (URL, request body, response body). Full-text search across all stored data.",
    { query: z.string().describe("Search text"), url: z.string().optional().describe("URL filter"), limit: z.number().optional().describe("Max results (default 50)") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserRequestsSearch(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_requests_stats",
    "Get statistics about all captured requests: total count, by method, by status, top sites, recent requests.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserRequestsStats()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_requests_export",
    "Export captured requests as JSON or CSV. Use for bulk analysis or sharing.",
    { format: z.enum(["json", "csv"]).optional().describe("Export format (default: json)"), limit: z.number().optional().describe("Max requests to export (default 10000)") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserRequestsExport(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_requests_clear",
    "Clear all captured requests from the SQLite log.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserRequestsClear()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── JavaScript Eval ─────────────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_eval",
    "Execute arbitrary JavaScript in the page context and return the result. Use for advanced interactions not covered by other tools.",
    { javascript: z.string().describe("JavaScript code to execute"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserEval(args.javascript, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── Composite / Batch Tools ────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__browser_click_text",
    "Find an element by its visible text and click it in a single fast call. Use instead of find_by_text + click.",
    { text: z.string().describe("Text to find and click"), role: z.string().optional().describe("ARIA role filter (button, link, etc)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserClickText(args.text, args.role, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fill_form",
    "Fill multiple form fields in a single fast call. Use instead of multiple fill() calls.",
    { fields: z.array(z.object({ selector: z.string(), value: z.string() })).describe("Array of {selector, value} pairs"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFillForm(args.fields, args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_page_summary",
    "Get URL, title, visible text, links, inputs, and buttons in a single fast call. Use instead of get_url + get_text + find_by_text.",
    { pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserPageSummary(args.pane_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ══════════════════════════════════════════════════════════════════════
  // NEW CDP-ONLY TOOLS — Native Chrome browser control
  // These require Chrome with --remote-debugging-port=9222
  // ══════════════════════════════════════════════════════════════════════

  // ── browser_mode — Detect current browser mode (CDP vs webview) ────
  server.tool(
    "mcp__codebrain__browser_mode",
    "Detect if using native Chrome (CDP) or embedded webview. Returns current browser mode, port, and connection status.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserMode()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_computer — Mouse/keyboard/screen via CDP ──────────────
  server.tool(
    "mcp__codebrain__browser_computer",
    "Perform mouse, keyboard, and screen actions on the native browser via CDP. Actions: left_click, right_click, double_click, triple_click, left_click_drag, type, key, screenshot, wait, scroll, scroll_to, hover, zoom. Requires Chrome with --remote-debugging-port.",
    {
      action: z.enum([
        "left_click", "right_click", "double_click", "triple_click",
        "left_click_drag", "type", "key", "screenshot", "wait",
        "scroll", "scroll_to", "hover", "zoom",
      ]).describe("Action to perform"),
      coordinate: z.array(z.number()).optional().describe("[x, y] screen coordinates"),
      text: z.string().optional().describe("Text to type or key to press"),
      start_coordinate: z.array(z.number()).optional().describe("Start position for drag"),
      scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
      scroll_amount: z.number().optional(),
      wait_ms: z.number().optional().describe("Milliseconds to wait"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserComputer(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_find — Natural language element search via CDP ────────
  server.tool(
    "mcp__codebrain__browser_find",
    "Find elements on the page by natural language query. Returns matching elements with coordinates and center points. Requires Chrome CDP.",
    {
      query: z.string().describe("Natural language query to find elements (e.g. 'Submit button', 'email input', 'navigation menu')"),
      role: z.string().optional().describe("ARIA role filter (button, link, input, heading, etc.)"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFindNaturalLanguage(args.query, args.role)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_tabs_list — List all open Chrome tabs ─────────────────
  server.tool(
    "mcp__codebrain__browser_tabs_list",
    "List all open browser tabs in the native Chrome instance. Returns tab ID, title, URL, and active status. Requires Chrome CDP.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserTabsList()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_tabs_create — Open new tab in Chrome ──────────────────
  server.tool(
    "mcp__codebrain__browser_tabs_create",
    "Create a new browser tab in the native Chrome instance. Returns the new tab ID. Requires Chrome CDP.",
    { url: z.string().optional().describe("URL to open in the new tab (default: about:blank)") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserTabsCreate(args.url)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_tabs_close — Close a Chrome tab ───────────────────────
  server.tool(
    "mcp__codebrain__browser_tabs_close",
    "Close a browser tab in the native Chrome instance by tab ID. Requires Chrome CDP.",
    { tab_id: z.string().describe("Tab ID to close (from browser_tabs_list)") },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserTabsClose(args.tab_id)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_batch — Execute multiple browser actions in one call ──
  server.tool(
    "mcp__codebrain__browser_batch",
    "Execute multiple browser tool calls sequentially in one round trip. Reduces latency for multi-step operations. Requires Chrome CDP.",
    {
      actions: z.array(z.object({
        tool: z.string().describe("Tool name (e.g. 'navigate', 'click', 'fill', 'screenshot', 'computer', 'find')"),
        input: z.object({}).passthrough().optional().describe("Tool arguments"),
      })).describe("Array of tool actions to execute sequentially"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserBatch(args.actions)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_upload_file — Upload files to file input ───────────────
  server.tool(
    "mcp__codebrain__browser_upload_file",
    "Upload files to a file input element using base64-encoded content. Works with <input type='file'> elements. Requires Chrome CDP.",
    {
      selector: z.string().describe("CSS selector for the file input element"),
      files: z.array(z.object({
        name: z.string().describe("File name (e.g. 'document.pdf')"),
        content: z.string().describe("Base64-encoded file content"),
        mimeType: z.string().optional().describe("MIME type (e.g. 'application/pdf', 'image/png')"),
      })).describe("Array of files to upload"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserUploadFile(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_upload_image — Upload image to element ─────────────────
  server.tool(
    "mcp__codebrain__browser_upload_image",
    "Upload an image to an element (file input or drop zone). Creates a File object from base64 data and dispatches appropriate events. Useful for chat interfaces with image upload. Requires Chrome CDP.",
    {
      selector: z.string().describe("Target element selector (file input or drop zone)"),
      image_data: z.string().describe("Base64-encoded image data"),
      mime_type: z.string().optional().describe("MIME type (default: 'image/png')"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserUploadImage(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_resize_window — Resize browser window ──────────────────
  server.tool(
    "mcp__codebrain__browser_resize_window",
    "Resize the browser window to specific dimensions. Requires Chrome CDP.",
    {
      width: z.number().describe("New width in pixels"),
      height: z.number().describe("New height in pixels"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserResizeWindow(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_gif_creator — GIF recording ────────────────────────────
  server.tool(
    "mcp__codebrain__browser_gif_creator",
    "Manage GIF recording of browser actions. Actions: start_recording, stop_recording, export, clear. NOTE: Full GIF recording requires the Claude Chrome extension's offscreen document — this is a stub that returns status info.",
    {
      action: z.enum(["start_recording", "stop_recording", "export", "clear"]).describe("GIF action to perform"),
      frame_delay_ms: z.number().optional().describe("Delay between frames in ms (default: 200)"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGifCreator(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_shortcuts_list — List shortcuts ────────────────────────
  server.tool(
    "mcp__codebrain__browser_shortcuts_list",
    "List available browser shortcuts/bookmarks. NOTE: Full shortcuts require the Claude Chrome extension — this returns available navigation shortcuts.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserShortcutsList()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_shortcuts_execute — Execute shortcut ───────────────────
  server.tool(
    "mcp__codebrain__browser_shortcuts_execute",
    "Execute a saved shortcut/bookmark. NOTE: Full shortcuts require the Claude Chrome extension — use browser_navigate as alternative.",
    {
      shortcut_id: z.string().describe("Shortcut ID to execute"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserShortcutsExecute(args)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ─── Fetch Interception Tools (CDP Fetch domain) ─────────────────────
  // Intercept, modify, block, or mock HTTP requests in real-time.

  server.tool(
    "mcp__codebrain__browser_intercept_requests",
    "Enable request interception via CDP Fetch domain. Pauses matching requests so they can be modified, blocked, or mocked. Requires Chrome CDP.",
    {
      url_patterns: z.array(z.string()).optional().describe("URL patterns to intercept (wildcards). Default: ['*'] (all)"),
      resource_types: z.array(z.string()).optional().describe("Resource types: Document, Stylesheet, Image, Media, Font, Script, XHR, Fetch, WebSocket, etc."),
      handle_auth: z.boolean().optional().describe("Handle auth challenges (default: false)"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserInterceptRequests(args.url_patterns, args.resource_types, args.handle_auth)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_continue_request",
    "Continue an intercepted (paused) request. Optionally modify URL, method, headers, or POST body. Requires Chrome CDP.",
    {
      request_id: z.string().describe("Paused request ID"),
      url: z.string().optional().describe("Override URL"),
      method: z.string().optional().describe("Override HTTP method"),
      headers: z.record(z.string()).optional().describe("Override headers"),
      post_data: z.string().optional().describe("Override POST body"),
    },
    async (args) => {
      try {
        const overrides = {};
        if (args.url) overrides.url = args.url;
        if (args.method) overrides.method = args.method;
        if (args.headers) overrides.headers = args.headers;
        if (args.post_data !== undefined) overrides.postData = args.post_data;
        return { content: [{ type: "text", text: JSON.stringify(await bridge.browserContinueRequest(args.request_id, Object.keys(overrides).length ? overrides : undefined)) }] };
      }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fulfill_request",
    "Fulfill an intercepted request with a custom mock response. Requires Chrome CDP.",
    {
      request_id: z.string().describe("Paused request ID"),
      status_code: z.number().optional().describe("HTTP status (default: 200)"),
      headers: z.record(z.string()).optional().describe("Response headers"),
      body: z.string().optional().describe("Response body text"),
      body_base64: z.string().optional().describe("Response body as base64"),
    },
    async (args) => {
      try {
        const response = { statusCode: args.status_code, headers: args.headers, body: args.body_base64 || args.body, isBase64: !!args.body_base64 };
        return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFulfillRequest(args.request_id, response)) }] };
      }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fail_request",
    "Block/fail an intercepted request. Use to block ads, trackers, or specific API calls. Requires Chrome CDP.",
    {
      request_id: z.string().describe("Paused request ID"),
      reason: z.enum(["Failed","Aborted","TimedOut","AccessDenied","ConnectionClosed","ConnectionReset","ConnectionRefused","ConnectionAborted","ConnectionFailed","NameNotResolved","InternetDisconnected","AddressUnreachable","BlockedByClient","BlockedByResponse"]).optional().describe("Error reason"),
    },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFailRequest(args.request_id, args.reason)) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_continue_response",
    "Continue an intercepted response (modify headers/body after server responds). Requires Chrome CDP.",
    {
      request_id: z.string().describe("Paused request ID"),
      headers: z.record(z.string()).optional().describe("Modified response headers"),
      body_base64: z.string().optional().describe("Modified response body as base64"),
    },
    async (args) => {
      try {
        const overrides = {};
        if (args.headers) overrides.headers = args.headers;
        if (args.body_base64) overrides.body = args.body_base64;
        return { content: [{ type: "text", text: JSON.stringify(await bridge.browserContinueResponse(args.request_id, Object.keys(overrides).length ? overrides : undefined)) }] };
      }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_stop_intercepting",
    "Disable request interception. Let all requests flow normally. Requires Chrome CDP.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserStopIntercepting()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  server.tool(
    "mcp__codebrain__browser_get_paused_requests",
    "Get all paused (intercepted) requests. Returns request ID, URL, method, headers, body for each. Requires Chrome CDP.",
    {},
    async () => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetPausedRequests()) }] }; }
      catch (err) { return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true }; }
    }
  );

  // ── browser_launch — Auto-launch native Chrome ────────────────────────
  server.tool(
    "mcp__codebrain__browser_launch",
    "Launch a native Chrome/Chromium browser with remote debugging enabled, or connect to an already-running instance. Auto-detects Chrome/Brave/Chromium on Windows and Linux/macOS. Returns { ok, launched, port, pid }. After this, all browser_* tools use the native browser (much more capable than the embedded webview).",
    {
      url: z.string().optional().describe("URL to open after launch (default: about:blank)"),
      port: z.number().optional().describe("Debug port to use (default: 9222)"),
    },
    async ({ url, port }) => {
      try {
        const result = await bridge.browserLaunch({ url, port });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── browser_form_input — Form filling by element ref ──────────────────
  server.tool(
    "mcp__codebrain__browser_form_input",
    "Set a value in a form element using an element reference from browser_get_accessibility_tree. Handles all input types: text, select (by value or text), checkbox (boolean), radio, date, range, number, textarea. More reliable than browser_fill for complex inputs. Requires Chrome CDP.",
    {
      ref: z.string().describe("Element reference ID from browser_get_accessibility_tree (e.g. 'ref_5')"),
      value: z.union([z.string(), z.boolean(), z.number()]).describe("Value to set. For checkbox/radio use boolean. For select use option text or value. For others use string."),
    },
    async ({ ref, value }) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await bridge.browserFormInput({ ref, value })) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── browser_get_article_text — Smart article extraction ───────────────
  server.tool(
    "mcp__codebrain__browser_get_article_text",
    "Extract the main article/content text from the current page intelligently. Tries article/main/[role=main] selectors, then common content class names, then falls back to body. Returns clean plain text without HTML. Much better than browser_get_text() for news articles, blog posts, and content-heavy pages. Works in both webview and CDP modes.",
    {
      max_chars: z.number().optional().describe("Maximum characters to return (default: 50000)"),
      pane_id: z.string().optional().describe("Browser pane ID (webview mode only)"),
    },
    async ({ max_chars, pane_id }) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetArticleText(max_chars, pane_id)) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH / SCRAPING TOOLS — HTTP requests with TLS fingerprinting
// ═══════════════════════════════════════════════════════════════════════════════

function registerFetchTools(server, bridge) {

  server.tool(
    "mcp__codebrain__browser_fetch",
    "Make an HTTP request with TLS fingerprinting (simulates Chrome/Firefox). Returns {status, headers, body, contentType, timing, cfBlocked}. Use this FIRST for scraping — it's faster and lighter than browser tools. If cfBlocked=true, fall back to browser_open + browser_wait_for.",
    {
      url: z.string().describe("URL to fetch"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]).default("GET").describe("HTTP method"),
      headers: z.record(z.string()).optional().describe("Custom headers (merged with browser-realistic defaults). Set to null to remove a default header."),
      body: z.union([z.string(), z.record(z.any())]).optional().describe("Request body (string or JSON object)"),
      timeout_ms: z.number().default(30000).describe("Request timeout in ms"),
      tls_profile: z.enum(["chrome-131", "chrome-mobile", "firefox-133"]).default("chrome-131").describe("TLS fingerprint profile to simulate"),
    },
    async ({ url, method, headers, body, timeout_ms, tls_profile }) => {
      try {
        const result = await bridge.browserFetch({ url, method, headers, body, timeout_ms, tls_profile });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fetch_json",
    "Fetch a URL and auto-parse JSON response. Shortcut for API calls. Returns parsed JSON object directly. If response is not JSON, returns warning.",
    {
      url: z.string().describe("URL to fetch"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP method"),
      headers: z.record(z.string()).optional().describe("Custom headers"),
      body: z.union([z.string(), z.record(z.any())]).optional().describe("Request body"),
      timeout_ms: z.number().default(30000).describe("Request timeout in ms"),
      tls_profile: z.enum(["chrome-131", "chrome-mobile", "firefox-133"]).default("chrome-131").describe("TLS fingerprint profile"),
    },
    async ({ url, method, headers, body, timeout_ms, tls_profile }) => {
      try {
        const result = await bridge.browserFetchJson({ url, method, headers, body, timeout_ms, tls_profile });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fetch_html",
    "Fetch HTML from a URL with TLS fingerprinting. Strips scripts/styles, auto-truncated at 50k chars. Use for scraping — faster than browser_navigate + browser_get_html. Falls back to browser_* tools if Cloudflare is detected (cfBlocked=true in response).",
    {
      url: z.string().describe("URL to fetch"),
      headers: z.record(z.string()).optional().describe("Custom headers"),
      timeout_ms: z.number().default(30000).describe("Request timeout in ms"),
      tls_profile: z.enum(["chrome-131", "chrome-mobile", "firefox-133"]).default("chrome-131").describe("TLS fingerprint profile"),
    },
    async ({ url, headers, timeout_ms, tls_profile }) => {
      try {
        const result = await bridge.browserFetchHtml({ url, headers, timeout_ms, tls_profile });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fetch_batch",
    "Fetch multiple URLs in parallel (max 10). Returns array of responses. Use for scraping multiple pages simultaneously. Each response includes status, body, timing, and cfBlocked flag.",
    {
      urls: z.array(z.string()).min(1).max(10).describe("Array of URLs to fetch (max 10)"),
      method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method for all requests"),
      headers: z.record(z.string()).optional().describe("Custom headers (applied to all requests)"),
      body: z.union([z.string(), z.record(z.any())]).optional().describe("Request body (applied to all requests)"),
      timeout_ms: z.number().default(30000).describe("Timeout per request in ms"),
      tls_profile: z.enum(["chrome-131", "chrome-mobile", "firefox-133"]).default("chrome-131").describe("TLS fingerprint profile"),
      max_concurrent: z.number().default(5).describe("Max concurrent requests (default 5)"),
    },
    async ({ urls, method, headers, body, timeout_ms, tls_profile, max_concurrent }) => {
      try {
        const result = await bridge.browserFetchBatch({ urls, method, headers, body, timeout_ms, tls_profile, max_concurrent });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__browser_fetch_cookies",
    "Manage HTTP cookies for fetch requests. Actions: list (get all cookies), set (add a cookie), clear (remove cookies). Cookies persist across fetch calls in the same session.",
    {
      action: z.enum(["list", "set", "clear"]).describe("Action: list, set, or clear cookies"),
      domain: z.string().optional().describe("Domain to scope the action to (optional for list/clear, required for set)"),
      name: z.string().optional().describe("Cookie name (required for set)"),
      value: z.string().optional().describe("Cookie value (for set)"),
    },
    async ({ action, domain, name, value }) => {
      try {
        const result = await bridge.browserFetchCookies({ action, domain, name, value });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MR / PR REVIEW TOOLS — List, detail, review, and comment on merge requests
// ═══════════════════════════════════════════════════════════════════════════════

function registerMRTools(server, bridge) {

  server.tool(
    "mcp__codebrain__mr_setup",
    "Smart diagnostic: checks if the workspace is ready for MR/PR operations. Verifies git remote, CLI installation, authentication, and SSH/HTTPS access. Returns structured diagnosis with issues and fix instructions. Call this FIRST if mr_list/mr_detail/mr_comment return setup_needed=true.",
    {
      cwd: z.string().describe("Workspace path (absolute). Must be a git repository."),
    },
    async ({ cwd }) => {
      try {
        const result = await bridge.mrSetup({ cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__mr_list",
    "List open merge requests / pull requests for the current repository. Auto-detects GitHub (gh) or GitLab (glab) from the git remote origin. Returns array of {id, title, author, branch, created_at, url}. Activate with enable_tool_group('mr') first.",
    {
      cwd: z.string().describe("Workspace path (absolute). Used to detect git repo and run CLI commands."),
      state: z.enum(["open", "closed", "all"]).default("open").describe("Filter by MR/PR state"),
      limit: z.number().default(20).describe("Max results to return"),
    },
    async ({ cwd, state, limit }) => {
      try {
        const result = await bridge.mrList({ cwd, state, limit });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__mr_detail",
    "Get full details of a merge request / pull request: title, description, author, branch, diff, files changed, additions/deletions, and existing comments. Auto-detects GitHub (gh) or GitLab (glab). Activate with enable_tool_group('mr') first.",
    {
      cwd: z.string().describe("Workspace path (absolute)."),
      id: z.number().describe("MR/PR number (iid for GitLab, number for GitHub)."),
      include_diff: z.boolean().default(true).describe("Include the full diff in the response. Set to false for a lighter response if you only need metadata."),
    },
    async ({ cwd, id, include_diff }) => {
      try {
        const result = await bridge.mrDetail({ cwd, id, include_diff });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__mr_review",
    "Analyze a MR/PR diff and generate structured code review findings. Returns findings with file, line, severity, category, message, and suggestion. The agent calls mr_detail internally to get the diff, then analyzes it. Activate with enable_tool_group('mr') first.",
    {
      cwd: z.string().describe("Workspace path (absolute)."),
      id: z.number().describe("MR/PR number."),
      focus: z.array(z.enum(["bugs", "security", "performance", "style", "all"])).optional().describe("Focus areas for the review. Default: all categories."),
    },
    async ({ cwd, id, focus }) => {
      try {
        // Get the full MR detail with diff
        const detail = await bridge.mrDetail({ cwd, id, include_diff: true });
        if (!detail.ok) return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };

        const mr = detail.mr;
        const diff = mr.diff || "";

        if (!diff || diff === "(diff unavailable)") {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No diff available for this MR/PR" }, null, 2) }] };
        }

        // Parse the diff to extract changed files and hunks
        const files = parseDiffFiles(diff);
        const focusAreas = focus && focus.length > 0 ? focus : ["bugs", "security", "performance", "style"];
        const findings = [];

        for (const file of files) {
          // Analyze each file's changes
          const fileFindings = analyzeFileChanges(file, focusAreas);
          findings.push(...fileFindings);
        }

        // Sort by severity
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        findings.sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5));

        const summary = {
          total_findings: findings.length,
          by_severity: {
            critical: findings.filter(f => f.severity === "critical").length,
            high: findings.filter(f => f.severity === "high").length,
            medium: findings.filter(f => f.severity === "medium").length,
            low: findings.filter(f => f.severity === "low").length,
            info: findings.filter(f => f.severity === "info").length,
          },
          by_category: {},
          files_reviewed: files.length,
          mr: { id: mr.id, title: mr.title, author: mr.author, url: mr.url },
        };

        for (const f of findings) {
          summary.by_category[f.category] = (summary.by_category[f.category] || 0) + 1;
        }

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, findings, summary, provider: detail.provider }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "mcp__codebrain__mr_comment",
    "Post a comment on a merge request / pull request. Supports general comments and inline review comments (provide file + line for inline). Auto-detects GitHub (gh) or GitLab (glab). Activate with enable_tool_group('mr') first.",
    {
      cwd: z.string().describe("Workspace path (absolute)."),
      id: z.number().describe("MR/PR number."),
      body: z.string().describe("Comment text (supports Markdown)."),
      file: z.string().optional().describe("File path for inline comment (optional). Must be a file changed in the MR."),
      line: z.number().optional().describe("Line number for inline comment (optional). Requires file to be set."),
    },
    async ({ cwd, id, body, file, line }) => {
      try {
        const result = await bridge.mrComment({ cwd, id, body, file, line });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

// ── Diff parsing helpers for mr_review ────────────────────────────────────

/**
 * Parse a unified diff into per-file change objects.
 * @param {string} diff - Raw unified diff output
 * @returns {Array<{path: string, hunks: Array<{start: number, end: number, added: string[], removed: string[]}>}>}
 */
function parseDiffFiles(diff) {
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let lineNum = 0;

  for (const line of diff.split("\n")) {
    // New file
    if (line.startsWith("+++ b/") || line.startsWith("+++ /dev/null")) {
      if (currentFile && currentHunk) currentFile.hunks.push(currentHunk);
      if (currentFile) files.push(currentFile);
      const path = line.replace(/^(\+\+\+ b\/|\+\+\+ )/, "");
      currentFile = { path, hunks: [] };
      currentHunk = null;
      continue;
    }

    // New hunk
    if (line.startsWith("@@")) {
      if (currentFile && currentHunk) currentFile.hunks.push(currentHunk);
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      lineNum = match ? parseInt(match[2], 10) : 0;
      currentHunk = { start: lineNum, end: lineNum, added: [], removed: [], context: [] };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.added.push(line.slice(1));
      currentHunk.end = lineNum;
      lineNum++;
    } else if (line.startsWith("-")) {
      currentHunk.removed.push(line.slice(1));
    } else {
      // Context line
      lineNum++;
      currentHunk.end = lineNum;
    }
  }

  if (currentFile && currentHunk) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);
  return files;
}

/**
 * Analyze file changes for common issues.
 * This is a heuristic-based static analysis — not a full linter.
 * Returns an array of findings.
 */
function analyzeFileChanges(file, focusAreas) {
  const findings = [];
  const path = file.path;

  for (const hunk of file.hunks) {
    const addedLines = hunk.added;
    const lineOffset = hunk.start;

    for (let i = 0; i < addedLines.length; i++) {
      const line = addedLines[i];
      const lineNum = lineOffset + i;
      const trimmed = line.trim();

      // ── Security findings ──
      if (focusAreas.includes("security") || focusAreas.includes("all")) {
        // Hardcoded secrets/tokens
        if (/(?:api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(trimmed)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "critical",
            category: "security",
            message: "Potential hardcoded secret/token detected",
            suggestion: "Use environment variables or a secrets manager instead of hardcoding credentials.",
          });
        }

        // SQL injection patterns
        if (/(?:query|execute|raw)\s*\(\s*[`'"].*\$\{|\.query\(`.*\$\{|string interpolation.*sql/i.test(trimmed)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "high",
            category: "security",
            message: "Possible SQL injection via string interpolation",
            suggestion: "Use parameterized queries or prepared statements.",
          });
        }

        // eval() usage
        if (/\beval\s*\(/.test(trimmed)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "high",
            category: "security",
            message: "eval() usage detected — potential code injection risk",
            suggestion: "Avoid eval(). Use safer alternatives like JSON.parse(), Function constructor, or structured logic.",
          });
        }

        // innerHTML with variables
        if (/innerHTML\s*=\s*(?!['"])/.test(trimmed) && !trimmed.includes("textContent")) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "medium",
            category: "security",
            message: "innerHTML assignment with dynamic content — potential XSS",
            suggestion: "Use textContent for plain text, or sanitize HTML with DOMPurify.",
          });
        }
      }

      // ── Bug findings ──
      if (focusAreas.includes("bugs") || focusAreas.includes("all")) {
        // Catch empty catch block
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "medium",
            category: "bugs",
            message: "Empty catch block — errors are silently swallowed",
            suggestion: "At minimum, log the error. Consider whether the error should propagate.",
          });
        }

        // == instead of === (in JS/TS)
        if (/\b[^=!]==[^=]/.test(trimmed) && !trimmed.includes("===") && !trimmed.includes("!==")
            && /\.(js|ts|jsx|tsx|mjs)$/.test(path)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "low",
            category: "bugs",
            message: "Loose equality (==) — consider using strict equality (===)",
            suggestion: "Use === or !== to avoid type coercion bugs.",
          });
        }

        // TODO/FIXME/HACK comments
        if (/\b(TODO|FIXME|HACK|XXX)\b/.test(trimmed)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "info",
            category: "bugs",
            message: `Unresolved marker: ${trimmed.match(/\b(TODO|FIXME|HACK|XXX)\b/)[0]}`,
            suggestion: "Address this before merging, or create a ticket to track it.",
          });
        }
      }

      // ── Performance findings ──
      if (focusAreas.includes("performance") || focusAreas.includes("all")) {
        // N+1 query patterns (inside loops)
        if (/\.query\(|\.find\(|\.fetch\(|\.select\(/.test(trimmed) && i > 0) {
          // Check if previous lines suggest a loop
          const prevLines = addedLines.slice(Math.max(0, i - 3), i).join(" ");
          if (/for\s*\(|\.forEach\(|\.map\(|\.filter\(|while\s*\(/.test(prevLines)) {
            findings.push({
              file: path,
              line: lineNum,
              severity: "medium",
              category: "performance",
              message: "Database query inside a loop — potential N+1 problem",
              suggestion: "Batch queries or use eager loading to reduce database round-trips.",
            });
          }
        }

        // Synchronous file I/O
        if (/readFileSync|writeFileSync|existsSync|mkdirSync|statSync/.test(trimmed)
            && !path.includes("test") && !path.includes("spec") && !path.includes("__test__")) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "low",
            category: "performance",
            message: "Synchronous file I/O blocks the event loop",
            suggestion: "Use async variants (readFile, writeFile, etc.) in production code.",
          });
        }
      }

      // ── Style findings ──
      if (focusAreas.includes("style") || focusAreas.includes("all")) {
        // Console.log left in non-test code
        if (/console\.(log|debug|info)\s*\(/.test(trimmed)
            && !path.includes("test") && !path.includes("spec") && !path.includes("__test__")
            && !path.includes("scripts/") && !path.includes(".mjs")) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "info",
            category: "style",
            message: "console.log/debug/info left in production code",
            suggestion: "Remove or replace with proper logging (e.g., a logger service).",
          });
        }

        // Very long lines (>200 chars)
        if (trimmed.length > 200) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "info",
            category: "style",
            message: `Line is ${trimmed.length} characters long (consider breaking it up)`,
            suggestion: "Break long lines for readability. Max recommended: 120-150 chars.",
          });
        }

        // Magic numbers
        if (/(?<![\w.])\d{4,}(?![\w.])/.test(trimmed) && !/['"]/.test(trimmed)
            && !/(?:\d{4}-\d{2}-\d{2}|port|version|0x|0b|0o)/i.test(trimmed)) {
          findings.push({
            file: path,
            line: lineNum,
            severity: "info",
            category: "style",
            message: "Magic number detected — consider using a named constant",
            suggestion: "Extract to a const with a descriptive name for better readability.",
          });
        }
      }
    }
  }

  return findings;
}

module.exports = { createCodebrainMCPServer, registerBrowserTools, registerFetchTools, registerMRTools };
