"use strict";

/**
 * Stdio MCP entry point for CodeBrain.
 *
 * Allows Claude Code CLI to connect to CodeBrain MCP tools without
 * the Electron app running. Starts the MCP server over stdio transport.
 *
 * Tools available: memory*, patterns*, skills, hooks, todo, file, swarm (partial)
 * Tools unavailable: pane*, browser* (require Electron app)
 *
 * *memory/patterns require better-sqlite3 compiled for system Node.
 *  If it fails (e.g. compiled for Electron), memory tools are disabled
 *  but the server still starts with all other tools.
 */

const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");
const { createCodebrainMCPServer, registerBrowserTools } = require("./index.js");
const { createMCPBridge } = require("./bridge.js");

async function main() {
  const workspacePath = process.env.CODEBRAIN_WORKSPACE
    ? path.resolve(process.env.CODEBRAIN_WORKSPACE)
    : process.cwd();

  // ── Memory store (optional — may fail if better-sqlite3 is Electron-only) ─
  let memoryStore;
  try {
    const { createMemoryStore } = require("../memory/store.js");
    const dbDir = path.join(os.homedir(), ".codebrain", "memory");
    const dbPath = path.join(dbDir, "codebrain.db");
    memoryStore = createMemoryStore(dbPath);
  } catch (err) {
    console.error("[codebrain-mcp] Memory store unavailable:", err.message);
    console.error("[codebrain-mcp] Memory/pattern tools will be disabled.");
  }

  // ── Bridge opts (CLI mode — no Electron) ──────────────────────────────
  const opts = {
    memoryStore,
    getCurrentWorkspacePath: () => workspacePath,
    spawnPaneFn: async () => ({ ok: false, error: "Pane tools require Codebrain app" }),
    onPaneCreated: () => {},
    sendBrowserCmd: async () => ({ ok: false, error: "Browser tools require Codebrain app" }),
    saveScreenshot: async () => ({ ok: false, error: "Browser tools require Codebrain app" }),
    saveScreenshotElement: async () => ({ ok: false, error: "Browser tools require Codebrain app" }),
    getNetworkLog: async () => ({ ok: false, entries: [] }),
    getConsoleLog: async () => ({ ok: false, entries: [] }),
    clearBrowserLogs: async () => ({ ok: false }),
    resolveBrowserPaneId: () => null,
    createBrowserPane: async () => ({ ok: false, error: "Browser tools require Codebrain app" }),
    paneConfigs: new Map(),
    providerHealth: new Map(),
    hooksManager: null,
  };

  // ── Stub ptyManager (EventEmitter for pane-handlers idle listener) ───
  const ptyManager = new EventEmitter();
  ptyManager.write = async () => { throw new Error("PTY not available in CLI mode"); };
  ptyManager.read = async () => [];
  ptyManager.readRaw = async () => new Uint8Array();
  ptyManager.readRawText = async () => "";
  ptyManager.kill = async () => {};
  ptyManager.list = async () => [];
  ptyManager.resize = async () => {};
  ptyManager.spawn = async () => ({ ok: false, error: "PTY not available in CLI mode" });
  ptyManager.onOutput = () => () => {};
  ptyManager.onExit = () => () => {};

  // ── Create MCP server ────────────────────────────────────────────────
  const bridge = createMCPBridge(ptyManager, opts);
  const mcpServer = createCodebrainMCPServer(bridge);
  registerBrowserTools(mcpServer, bridge);

  // ── Stdio transport ──────────────────────────────────────────────────
  const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error("[codebrain-mcp] Stdio MCP server started (CLI mode)");
}

main().catch((err) => {
  console.error("[codebrain-mcp] Fatal:", err);
  process.exit(1);
});
