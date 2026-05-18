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
 * Internal fields like systemPrompt / toolList can be 5-20 KB each.
 */
function stripHeavyPaneFields(panes) {
  if (!Array.isArray(panes)) return panes;
  return panes.map(({ systemPrompt, toolList, config, ...rest }) => rest);
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

  // ── mcp__codebrain__pane_spawn ─────────────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_spawn",
    "Open a NEW VISIBLE terminal pane in the CodeBrain workspace grid. Use this instead of your built-in background agent tool if you want the user to see the progress. Returns the paneId.",
    {
      cwd:        z.string().optional().describe("Working directory. Defaults to current workspace."),
      agent:      z.string().optional().describe("Agent binary: claude, codex, gemini, openclaude, shell. Defaults to claude."),
      providerId: z.string().optional().describe("Provider ID to use for the new pane."),
      model:      z.string().optional().describe("Model to use for the new pane."),
      label:      z.string().optional().describe("A short label to identify this pane in pane_list (e.g. 'backend', 'frontend', 'ui-tester'). Helps the orchestrator reuse existing workers."),
    },
    async (args) => {
      try {
        const result = await bridge.spawnPane({
          agent:      args.agent,
          cwd:        args.cwd,
          providerId: args.providerId,
          model:      args.model,
          label:      args.label,
        });
        
        const paneId = result?.paneId;
        if (!paneId || result?.error) {
          return { content: [{ type: "text", text: `error: ${result?.error ?? "spawn failed"}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ paneId, ok: true }) }] };
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

  // ── mcp__codebrain__pane_send_message ──────────────────────────────────────
  server.tool(
    "mcp__codebrain__pane_send_message",
    "Send a message to another agent pane. Use this for inter-agent coordination: notify a worker about API changes, send a task result to the orchestrator, or ask a question to another worker.",
    {
      from:    z.string().describe("Your pane ID (sender)."),
      to:      z.string().describe("Target pane ID (recipient)."),
      content: z.string().describe("Message content — be specific and include all context the recipient needs."),
      type:    z.enum(["task", "update", "question", "result"]).optional()
                 .describe("Message type: task (assign work), update (notify about changes), question (ask something), result (report completion). Default: update."),
    },
    async (args) => {
      try {
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

        // Write trigger to PTY stdin, then send Enter AFTER a small delay.
        // This avoids the race condition where \r arrives before the CLI finishes
        // processing the pasted text (which caused the "broken line" issue).
        if (bridge.writePane) {
          const typeLabel = msgType.toUpperCase();
          const trigger = `[⚡ MENSAGEM DE ${args.from} (${typeLabel}) — use pane_read_messages]`;
          // Step 1: write text WITHOUT submit
          await bridge.writePane(args.to, trigger, false);
          // Step 2: wait for CLI to process the text, then send Enter
          await new Promise(r => setTimeout(r, 150));
          await bridge.writePane(args.to, "", true);
        }

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
        const files = fs.readdirSync(inbox).filter(f => f.endsWith(".json")).sort();
        const messages = [];
        for (const file of files) {
          const filePath = path.join(inbox, file);
          try {
            const raw = fs.readFileSync(filePath, "utf-8");
            const msg = JSON.parse(raw);
            const wantUnreadOnly = args.unreadOnly !== false;
            if (wantUnreadOnly && msg.read) continue;
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
    { type: z.enum(["prompt", "squad"]).optional().describe("Filter by skill type") },
    async (args) => {
      try {
        const result = await bridge.skillList({ type: args.type });
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
    { id: z.string().describe("Skill ID (folder name in ~/.codebrain/skills/)") },
    async (args) => {
      try {
        const result = await bridge.skillGet({ id: args.id });
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

  // ── mcp__codebrain__skill_sync ───────────────────────────────────────────
  server.tool(
    "mcp__codebrain__skill_sync",
    "Sync skills with the GitLab registry. Pull downloads latest skills, push uploads local changes.",
    { direction: z.enum(["pull", "push"]).describe("Sync direction: 'pull' (GitLab→local) or 'push' (local→GitLab)") },
    async (args) => {
      try {
        const result = await bridge.skillSync({ direction: args.direction });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `error: ${String(err)}` }], isError: true };
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
    { max_depth: z.number().optional().describe("Max tree depth (default 10)"), pane_id: z.string().optional() },
    async (args) => {
      try { return { content: [{ type: "text", text: JSON.stringify(await bridge.browserGetA11yTree(args.max_depth, args.pane_id)) }] }; }
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
}

module.exports = { createCodebrainMCPServer, registerBrowserTools };
