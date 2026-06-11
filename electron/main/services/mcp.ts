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
    setCurrentWorkspacePath: (ws: string) => { ctx.currentWorkspacePath = ws; },
    clearReviewingState: () => {
      (ctx as any)._mrReviewActive = false;
      (ctx as any)._mrReviewActiveWorkspaces = new Set();
    },
    memoryStore: ctx.memoryStore,
    paneConfigs: ctx.paneConfigs,
    providerHealth: ctx.providerHealth,
    hooksManager: ctx.hooksManager,
    // Direct trigger callback — bridge.js registers its trigger function here
    setMrPollTrigger: (fn: () => any) => { (ctx as any)._triggerMrPoll = fn; },
    configStore: ctx.configStore, // For notification settings
    workspaceConfigStore: ctx.workspaceConfigStore, // For workspace access mode sandbox
    updateContextFiles: (wsPath: string) => writeContextFiles(ctx, wsPath),
    getOAuthToken: async (provider: "github" | "gitlab") => {
      try {
        const { getOAuthToken } = require("./oauth");
        return await getOAuthToken(ctx, provider);
      } catch (err) {
        console.error("[OAuth] getOAuthToken failed:", err);
        return null;
      }
    },
    getBotToken: (provider: "github" | "gitlab") => {
      try {
        const config = ctx.configStore?.get?.() || {};
        const key = provider === "gitlab" ? "gitlab_bot_token" : "github_bot_token";
        return config[key] || null;
      } catch {
        return null;
      }
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
  // Create a deferred promise so mcpServerReady is ALWAYS set before any async work.
  // This ensures IPC handlers can await it even if startMCPServer hasn't been called yet.
  let resolveReady: (info: McpServerInfo) => void;
  let rejectReady: (err: any) => void;
  ctx.mcpServerReady = new Promise<McpServerInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  console.log(`[MCP] mcpServerReady promise created (deferred)`);

  const { startMCPServer } = require("../../packages/mcp/server.js");
  const bridge = buildMcpBridge(ctx);

  const tryStart = async () => {
    const info: McpServerInfo = await startMCPServer(ctx.ptyManager, bridge);
    ctx.mcpServerInfo = info;
    writeMcpConfig(ctx, info);
    console.log(`[MCP] Server started on port ${info.port}`);
    console.log(`[MCP] SSE: ${info.sseUrl}`);
    console.log(`[MCP] Streamable HTTP: ${info.streamableHttpUrl}`);

    // Notify active panes about MCP server (re)start so they can re-initialize.
    notifyActivePanesMcpRestart(ctx, info);
    return info;
  };

  try {
    const info = await tryStart();
    resolveReady!(info);
  } catch (err) {
    console.error("[MCP] Failed to start server:", err);
    setTimeout(async () => {
      console.log("[MCP] Retrying server start...");
      try {
        const info = await tryStart();
        resolveReady!(info);
        console.log(`[MCP] Server started on retry`);
      } catch (err2) {
        console.error("[MCP] Retry also failed:", err2);
        rejectReady!(err2);
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
