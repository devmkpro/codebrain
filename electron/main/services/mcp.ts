import { ipcMain } from "electron";
import type { AppContext, McpServerInfo } from "../context";
import { safeSend } from "../context";
import { spawnPaneInternal } from "./pane-spawn";
import { sendBrowserCmd, saveScreenshot, saveScreenshotElement, getNetworkLog, getConsoleLog, clearBrowserLogs, resolveBrowserPaneId } from "./browser";
import { refreshAllWorkspaces, writeContextFiles } from "./workspace";

// CDP Client for native Chrome browser control
const { CDPClient } = require("../../packages/mcp/bridge/cdp-client.js");

export function writeMcpConfig(ctx: AppContext, info: McpServerInfo): void {
  // Delegate to refreshAllWorkspaces which handles all providers + all workspaces in one pass.
  refreshAllWorkspaces(ctx, info);
}

function buildMcpBridge(ctx: AppContext) {
  // Create CDP client for native Chrome browser control
  const cdpClient = new CDPClient({ log: console.log, debug: false });

  return {
    cdpClient,
    spawnPaneFn: (req: { agent?: string; providerId?: string; model?: string; cwd?: string }) =>
      spawnPaneInternal(ctx, req),
    onPaneCreated: (info: { paneId: string; agent: string; cwd?: string; providerId?: string; model?: string }) => {
      safeSend(ctx, "pane:added", info);
    },
    sendBrowserCmd: (paneId: string, cmd: Record<string, unknown>) => sendBrowserCmd(ctx, paneId, cmd),
    saveScreenshot: (paneId?: string, fullPage?: boolean) => saveScreenshot(ctx, paneId, fullPage),
    saveScreenshotElement: (selector: string, paneId?: string) => saveScreenshotElement(ctx, selector, paneId),
    getNetworkLog: (paneId?: string, urlFilter?: string, method?: string, status?: string, sinceMs?: number, limit?: number) =>
      getNetworkLog(ctx, paneId, urlFilter, method, status, sinceMs, limit),
    getConsoleLog: (paneId?: string, level?: string, sinceMs?: number, limit?: number) =>
      getConsoleLog(ctx, paneId, level, sinceMs, limit),
    clearBrowserLogs: () => clearBrowserLogs(ctx),
    resolveBrowserPaneId: (paneId?: string) => resolveBrowserPaneId(ctx, paneId, ctx.currentWorkspacePath),
    createBrowserPane: (url: string) => {
      return new Promise<{ ok: boolean; paneId: string; error?: string }>((resolve, reject) => {
        const workspacePath = ctx.currentWorkspacePath;
        const timer = setTimeout(() => reject(new Error("timeout creating browser pane")), 10000);
        const handler = (_evt: unknown, createdPaneId: string) => {
          clearTimeout(timer);
          ipcMain.off("codebrain:browser:pane-created", handler);
          ctx.browserPaneIds.add(createdPaneId);
          ctx.browserPaneWorkspace.set(createdPaneId, workspacePath);
          setTimeout(async () => {
            try {
              const navResult = await sendBrowserCmd(ctx, createdPaneId, { type: "navigate", url });
              resolve({ ...navResult, paneId: createdPaneId } as any);
            } catch (err) { resolve({ ok: false, error: String(err), paneId: createdPaneId }); }
          }, 1000);
        };
        ipcMain.on("codebrain:browser:pane-created", handler);
        safeSend(ctx, "codebrain:browser:create-pane", { url });
      });
    },
    getCurrentWorkspacePath: () => ctx.currentWorkspacePath,
    memoryStore: ctx.memoryStore,
    paneConfigs: ctx.paneConfigs,
    providerHealth: ctx.providerHealth,
    hooksManager: ctx.hooksManager,
    configStore: ctx.configStore, // For notification settings
    workspaceConfigStore: ctx.workspaceConfigStore, // For workspace access mode sandbox
    updateContextFiles: (wsPath: string) => writeContextFiles(ctx, wsPath),
    getOAuthToken: (provider: "github" | "gitlab") => {
      try {
        const { getOAuthToken } = require("./oauth");
        return getOAuthToken(ctx, provider);
      } catch { return null; }
    },
    emitNotification: (data: { type: string; title: string; body?: string; level?: string; mr_id?: number; mr_url?: string; provider?: string }) => {
      try {
        const store = ctx.memoryStore;
        if (!store) return;
        store.createNotification(data);
      } catch {}
    },
    roleMap: undefined as any, // Will be set by pane-handlers via bridge composition
  };
}

export async function startMcpServer(ctx: AppContext): Promise<void> {
  const { startMCPServer } = require("../../packages/mcp/server.js");
  const bridge = buildMcpBridge(ctx);

  const tryStart = async () => {
    const promise = startMCPServer(ctx.ptyManager, bridge);
    ctx.mcpServerReady = promise;
    const info: McpServerInfo = await promise;
    ctx.mcpServerInfo = info;
    writeMcpConfig(ctx, info);
    console.log(`[MCP] Server started on port ${info.port}`);
    console.log(`[MCP] SSE: ${info.sseUrl}`);
    console.log(`[MCP] Streamable HTTP: ${info.streamableHttpUrl}`);

    // Notify active panes about MCP server (re)start so they can re-initialize.
    // This is a best-effort hint — agents that lost MCP context will see the message
    // and can attempt to re-read their .mcp.json (which now has the correct port).
    notifyActivePanesMcpRestart(ctx, info);
  };

  try {
    await tryStart();
  } catch (err) {
    console.error("[MCP] Failed to start server:", err);
    setTimeout(async () => {
      console.log("[MCP] Retrying server start...");
      try {
        await tryStart();
        console.log(`[MCP] Server started on retry`);
      } catch (err2) {
        console.error("[MCP] Retry also failed:", err2);
      }
    }, 2000);
  }
}

/**
 * Send a silent hint to all active PTY panes about the MCP server port.
 * This helps agents that lost MCP context (e.g. after server restart)
 * to re-initialize their MCP connection.
 *
 * Uses writeSilent() so the message doesn't appear in the terminal output.
 */
function notifyActivePanesMcpRestart(ctx: AppContext, info: McpServerInfo): void {
  try {
    const panes = ctx.ptyManager?.list?.() ?? [];
    if (panes.length === 0) return;

    const hint = `\n[MCP] Server restarted on port ${info.port}. If MCP tools are unavailable, re-initialize your MCP connection.\n`;
    for (const pane of panes) {
      try {
        ctx.ptyManager.writeSilent(pane.paneId, hint);
      } catch {}
    }
    console.log(`[MCP] Notified ${panes.length} active panes about restart`);
  } catch (err) {
    console.warn("[MCP] Failed to notify panes about restart:", err);
  }
}
