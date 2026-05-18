"use strict";

const { createPaneHandlers } = require("./bridge/pane-handlers.js");
const { createBrowserHandlers } = require("./bridge/browser-handlers.js");
const { createTodoHandlers } = require("./bridge/todo-handlers.js");
const { createMemoryHandlers } = require("./bridge/memory-handlers.js");
const { createSwarmHandlers } = require("./bridge/swarm-handlers.js");
const { createFileHandlers } = require("./bridge/file-handlers.js");
const { createWorkerDispatch } = require("./bridge/worker-dispatch.js");
const { createHooksHandlers } = require("./bridge/hooks-handlers.js");
const { createSkillHandlers } = require("./bridge/skill-handlers.js");

/**
 * Creates a bridge between MCP server tools and the PtyManager.
 * Composes pane, browser, todo, memory, and swarm handlers into a single bridge object.
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
