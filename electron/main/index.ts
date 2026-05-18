/**
 * Electron Main Process — Entry Point
 *
 * Bootstrap only: creates window, registers IPC handlers, wires up PTY events,
 * and starts the MCP server. All domain logic lives in services/ and ipc/.
 */
import { app, session } from "electron";
import * as fs from "node:fs";
import log from "electron-log/main.js";

import { platform } from "./platform";
import { setupAutoUpdater, teardownAutoUpdater, isUpdateInstallRequested } from "./auto-updater";
import { createAppContext, safeSend } from "./context";
import { createWindow } from "./window";
import { registerAllIpcHandlers } from "./ipc/register-all";
import { startMcpServer } from "./services/mcp";
import { attachNetworkTracking } from "./services/network";
import { setupHooks } from "./services/hooks";
import { setupClaudeIntegration } from "./services/setup-claude";

log.initialize();

const ctx = createAppContext();

app.whenReady().then(async () => {
  fs.mkdirSync(ctx.DATA_DIR, { recursive: true });

  // Auto-install Claude Code integration (statusline, .mcp.json, helpers)
  setupClaudeIntegration();

  ctx.mainWindow = createWindow();
  registerAllIpcHandlers(ctx);
  setupAutoUpdater(ctx.mainWindow);

  // PTY event forwarding
  ctx.ptyManager.on("output", (paneId: string, data: string) => {
    safeSend(ctx, "pty:output", paneId, data, false);
  });
  ctx.ptyManager.on("output-echo", (paneId: string, data: string) => {
    safeSend(ctx, "pty:output", paneId, data, true);
  });
  ctx.ptyManager.on("exit", (paneId: string, exitCode: number) => {
    safeSend(ctx, "pty:exit", paneId, exitCode);
    ctx.paneConfigs.delete(paneId);
    ctx.paneRegistry.delete(paneId);
  });

  // Wire lifecycle hooks system
  setupHooks(ctx.hooksManager, ctx.ptyManager, ctx);

  // Network tracking
  attachNetworkTracking(ctx, session.defaultSession);
  attachNetworkTracking(ctx, session.fromPartition("persist:codebrain-browser"));

  // Start MCP server (non-blocking)
  startMcpServer(ctx).catch((err) => log.error("[MCP] startup error:", err));

  // Detect CLI tools
  ctx.cliDetector.redetect();

  app.on("activate", () => {
    const { BrowserWindow } = require("electron");
    if (BrowserWindow.getAllWindows().length === 0) {
      ctx.mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (!platform.isMacOS) {
    teardownAutoUpdater();
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (ctx.mcpServerInfo) {
    ctx.mcpServerInfo.close();
    ctx.mcpServerInfo = null;
  }
  ctx.ptyManager.killAll();
  if (isUpdateInstallRequested()) return;
  teardownAutoUpdater();
});
