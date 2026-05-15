"use strict";

const EventEmitter = require("events");

/**
 * Creates a bridge between MCP server tools and the PtyManager.
 * The bridge translates MCP tool calls into PTY operations.
 *
 * @param {import("../../electron/main/pty-manager").PtyManager} ptyManager
 * @param {Object} opts
 * @param {function} opts.onPaneCreated - callback when a new pane is spawned via MCP
 * @returns {Object} bridge object for createCodebrainMCPServer
 */
function createMCPBridge(ptyManager, opts = {}) {
  const roleMap = new Map(); // paneId -> "worker" | "orchestrator"
  const idleWaiters = new Map(); // paneId -> { resolve, timer }
  const todoState = { tasks: [], activeIndex: -1 };

  // Listen for idle events from the PTY manager
  ptyManager.on("idle", ({ paneId, idle }) => {
    const waiter = idleWaiters.get(paneId);
    if (waiter) {
      clearTimeout(waiter.timer);
      idleWaiters.delete(paneId);
      waiter.resolve({ idle: true, lastOutput: idle?.lastOutput });
    }
  });

  // Track pane labels/roles for metadata
  const paneLabels = new Map(); // paneId -> string label

  // Browser control helpers — delegate to main process IPC
  async function browserCmd(type, payload = {}) {
    if (!opts.sendBrowserCmd) throw new Error("browser control not available");
    const paneId = opts.resolveBrowserPaneId ? opts.resolveBrowserPaneId(payload.paneId) : payload.paneId;
    if (!paneId) throw new Error("no browser pane found");
    const { paneId: _, ...cmdPayload } = payload;
    return opts.sendBrowserCmd(paneId, { type, ...cmdPayload });
  }

  return {
    async spawnPane({ agent, cwd, providerId, model }) {
      try {
        // Use spawnPaneFn from main process if available (handles provider resolution,
        // env setup, CLI flag injection, system prompt injection)
        if (opts.spawnPaneFn) {
          const result = await opts.spawnPaneFn({ agent, cwd, providerId, model });
          if (result.ok && result.paneId) {
            roleMap.set(result.paneId, "worker");
          }
          return result;
        }

        // Fallback to direct ptyManager.spawn()
        const config = {
          agent: agent || "openclaude",
          cwd: cwd || undefined,
          providerId: providerId || undefined,
          model: model || undefined,
        };
        const paneId = await ptyManager.spawn(config);
        roleMap.set(paneId, "worker");
        if (opts.onPaneCreated) {
          opts.onPaneCreated({ paneId, agent: config.agent, cwd: config.cwd, providerId, model });
        }
        return { paneId };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    async writePane(paneId, text, submit = true) {
      if (!ptyManager.hasPane(paneId)) return { ok: false, error: "pane not found" };
      // Use writeSilent to suppress PTY echo — the sent text won't appear
      // duplicated in the terminal input. The echo is filtered out in the
      // onData handler via the pendingEcho tracking.
      ptyManager.writeSilent(paneId, submit ? text + "\r" : text);
      return { ok: true };
    },

    async readPane(paneId, lastN = 200) {
      const lines = ptyManager.read(paneId, lastN);
      return { lines };
    },

    async waitPaneIdle(paneId, timeout = 300000) {
      return new Promise((resolve, reject) => {
        // Check if pane already has no recent activity
        const existing = idleWaiters.get(paneId);
        if (existing) {
          clearTimeout(existing.timer);
        }

        const timer = setTimeout(() => {
          idleWaiters.delete(paneId);
          resolve({ idle: true, timedOut: true });
        }, timeout);

        idleWaiters.set(paneId, { resolve, timer });
      });
    },

    async listPanes() {
      const panes = ptyManager.list();
      return panes.map((p) => ({
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

    async todoManager(args) {
      switch (args.action) {
        case "set_tasks":
          todoState.tasks = (args.tasks || []).map((t, i) => ({
            name: t,
            status: i === 0 ? "active" : "pending",
          }));
          todoState.activeIndex = 0;
          return { ok: true, tasks: todoState.tasks };

        case "add_task":
          if (args.task) {
            todoState.tasks.push({ name: args.task, status: "pending" });
          }
          return { ok: true, tasks: todoState.tasks };

        case "move_to_task": {
          const idx = todoState.tasks.findIndex((t) => t.name === args.moveToTask);
          if (idx === -1) return { ok: false, error: "task not found" };
          // Mark all tasks before this one as done
          for (let i = 0; i < idx; i++) {
            todoState.tasks[i].status = "done";
          }
          todoState.tasks[idx].status = "active";
          if (args.taskNameActive) {
            todoState.tasks[idx].displayName = args.taskNameActive;
          }
          todoState.activeIndex = idx;
          return { ok: true, tasks: todoState.tasks, activeIndex: idx };
        }

        case "read_list":
          return { ok: true, tasks: todoState.tasks, activeIndex: todoState.activeIndex };

        case "mark_all_done":
          for (const t of todoState.tasks) {
            t.status = "done";
          }
          todoState.activeIndex = -1;
          return { ok: true, tasks: todoState.tasks };

        default:
          return { ok: false, error: `unknown action: ${args.action}` };
      }
    },

    // ── Browser Control Methods ─────────────────────────────────────────────
    async browserNavigate(url, paneId) {
      return browserCmd("navigate", { url, paneId });
    },
    async browserOpen(url) {
      // Browser panes are created via the renderer, not via PTY spawn.
      // Use the browser:open IPC handler which tells the renderer to create a BrowserPane.
      if (!opts.createBrowserPane) throw new Error("browser pane creation not available");
      return opts.createBrowserPane(url);
    },
    async browserBack(paneId) { return browserCmd("back", { paneId }); },
    async browserForward(paneId) { return browserCmd("forward", { paneId }); },
    async browserReload(hard, paneId) { return browserCmd("reload", { hard, paneId }); },
    async browserGetHtml(selector, paneId) { return browserCmd("get-html", { selector, paneId }); },
    async browserGetText(selector, paneId) { return browserCmd("get-text", { selector, paneId }); },
    async browserGetA11yTree(maxDepth, paneId) { return browserCmd("get-a11y-tree", { maxDepth, paneId }); },
    async browserFindByText(text, role, exact, paneId) { return browserCmd("find-by-text", { text, role, exact, paneId }); },
    async browserGetElement(selector, paneId) { return browserCmd("get-element", { selector, paneId }); },
    async browserGetUrl(paneId) { return browserCmd("get-url", { paneId }); },
    async browserClick(selector, paneId) { return browserCmd("click", { selector, paneId }); },
    async browserFill(selector, value, clearFirst, paneId) { return browserCmd("fill", { selector, value, clearFirst, paneId }); },
    async browserSelect(selector, valueOrText, paneId) { return browserCmd("select", { selector, valueOrText, paneId }); },
    async browserCheck(selector, checked, paneId) { return browserCmd("check", { selector, checked, paneId }); },
    async browserClear(selector, paneId) { return browserCmd("clear", { selector, paneId }); },
    async browserFocus(selector, paneId) { return browserCmd("focus", { selector, paneId }); },
    async browserHover(selector, paneId) { return browserCmd("hover", { selector, paneId }); },
    async browserClickAt(x, y, button, paneId) { return browserCmd("click-at", { x, y, button, paneId }); },
    async browserHoverAt(x, y, paneId) { return browserCmd("hover-at", { x, y, paneId }); },
    async browserDrag(x1, y1, x2, y2, steps, paneId) { return browserCmd("drag", { x1, y1, x2, y2, steps, paneId }); },
    async browserScroll(selector, direction, amount, paneId) { return browserCmd("scroll", { selector, direction, amount, paneId }); },
    async browserType(text, delayMs, paneId) { return browserCmd("type", { text, delayMs, paneId }); },
    async browserKey(key, paneId) { return browserCmd("key", { key, paneId }); },
    async browserShortcut(keys, paneId) { return browserCmd("shortcut", { keys, paneId }); },
    async browserWaitFor(selector, timeoutMs, paneId) { return browserCmd("wait-for", { selector, timeoutMs, paneId }); },
    async browserWaitForText(text, selector, timeoutMs, paneId) { return browserCmd("wait-for-text", { text, selector, timeoutMs, paneId }); },
    async browserWaitForUrl(pattern, timeoutMs, paneId) { return browserCmd("wait-for-url", { pattern, timeoutMs, paneId }); },
    async browserWaitForLoad(timeoutMs, paneId) { return browserCmd("wait-for-load", { timeoutMs, paneId }); },
    async browserScreenshot(fullPage, paneId) {
      if (!opts.saveScreenshot) throw new Error("screenshot not available");
      return opts.saveScreenshot(paneId, fullPage);
    },
    async browserScreenshotElement(selector, paneId) {
      if (!opts.saveScreenshotElement) throw new Error("screenshot not available");
      return opts.saveScreenshotElement(selector, paneId);
    },
    async browserAnnotate(path, annotations) {
      // Placeholder — annotation not yet implemented
      return { ok: true, path, note: "annotation not yet implemented" };
    },
    async browserEval(javascript, paneId) { return browserCmd("eval", { javascript, paneId }); },
    async browserClickText(text, role, paneId) { return browserCmd("click-text", { text, role, paneId }); },
    async browserFillForm(fields, paneId) { return browserCmd("fill-form", { fields, paneId }); },
    async browserPageSummary(paneId) { return browserCmd("page-summary", { paneId }); },
    async browserConsoleLog(level, sinceMs, limit, paneId) {
      if (!opts.getConsoleLog) throw new Error("console log not available");
      return { ok: true, entries: opts.getConsoleLog(paneId, level, sinceMs, limit) };
    },
    async browserClearConsole() {
      if (opts.clearBrowserLogs) opts.clearBrowserLogs();
      return { ok: true };
    },
    async browserNetworkLog(urlFilter, method, status, sinceMs, limit, paneId) {
      if (!opts.getNetworkLog) throw new Error("network log not available");
      return { ok: true, entries: opts.getNetworkLog(paneId, urlFilter, method, status, sinceMs, limit) };
    },
    async browserNetworkWait(pattern, method, timeoutMs) {
      if (!opts.sendBrowserCmd) throw new Error("browser control not available");
      // Wait in main process
      const timeout = timeoutMs || 10000;
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          const entries = opts.getNetworkLog ? opts.getNetworkLog() : [];
          const found = entries.find(e => {
            const urlMatch = e.url?.includes(pattern) || e.data?.includes(pattern);
            const methodMatch = !method || e.method === method.toUpperCase();
            return urlMatch && methodMatch;
          });
          if (found) { resolve({ ok: true, entry: found, timedOut: false }); return; }
          if (Date.now() - start > timeout) { resolve({ ok: true, entry: null, timedOut: true }); return; }
          setTimeout(check, 300);
        };
        check();
      });
    },
    async browserClearNetwork() {
      if (opts.clearBrowserLogs) opts.clearBrowserLogs();
      return { ok: true };
    },
  };
}

module.exports = { createMCPBridge };
