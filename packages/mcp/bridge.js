"use strict";

const { createPaneHandlers } = require("./bridge/pane-handlers.js");
const { createBrowserHandlers } = require("./bridge/browser-handlers.js");
const { createTodoHandlers } = require("./bridge/todo-handlers.js");

/**
 * Creates a bridge between MCP server tools and the PtyManager.
 * Composes pane, browser, and todo handlers into a single bridge object.
 *
 * @param {import("../../electron/main/pty-manager").PtyManager} ptyManager
 * @param {Object} opts
 */
function createMCPBridge(ptyManager, opts = {}) {
  const paneLabels = new Map();
  const paneHandlers = createPaneHandlers(ptyManager, { ...opts, paneLabels });
  const browserHandlers = createBrowserHandlers(opts);
  const todoHandlers = createTodoHandlers();

  return {
    ...paneHandlers,
    ...browserHandlers,
    ...todoHandlers,
    // Override listPanes to pass paneLabels
    async listPanes() {
      return paneHandlers.listPanes(paneLabels);
    },
  };
}

module.exports = { createMCPBridge };
