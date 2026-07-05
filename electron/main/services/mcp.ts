import { ipcMain } from "electron";
import type { AppContext, McpServerInfo } from "../context";
import { safeSend } from "../context";
import { spawnPaneInternal } from "./pane-spawn";
import { sendBrowserCmd, saveScreenshot, saveScreenshotElement, getNetworkLog, getConsoleLog, clearBrowserLogs, resolveBrowserPaneId } from "./browser";
import { refreshAllWorkspaces, writeContextFiles } from "./workspace";
import { PROVIDER_REGISTRY } from "./constants";

// CDP Client for native Chrome browser control
const { CDPClient } = require("../../packages/mcp/bridge/cdp-client.js");

export function writeMcpConfig(ctx: AppContext, info: McpServerInfo): void {
  // Delegate to refreshAllWorkspaces which handles all providers + all workspaces in one pass.
  const { app } = require("electron");
  const projectRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  refreshAllWorkspaces(ctx, info, projectRoot);
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
    memoryStore: ctx.memoryStore,
    providerStore: ctx.providerStore,
    providerRegistry: PROVIDER_REGISTRY,
    paneConfigs: ctx.paneConfigs,
    providerHealth: ctx.providerHealth,
    hooksManager: ctx.hooksManager,
    // Direct trigger callback — bridge.js registers its trigger function here
    setMrPollTrigger: (fn: (opts?: { workspace?: string }) => any) => { (ctx as any)._triggerMrPoll = fn; },
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
    emitNotification: (data: { type: string; title: string; body?: string; level?: string; provider?: string }) => {
      try {
        const store = ctx.memoryStore;
        if (!store) return;
        store.createNotification(data);
      } catch {}
    },
    getGoogleKey: () => {
      try {
        const providers = ctx.providerStore?.listFull?.() || [];
        for (const p of providers) {
          if (p.id && p.id.startsWith("gemini-") && p.env?.GEMINI_API_KEY) return p.env.GEMINI_API_KEY;
          if ((p as any).compat === "gemini-compat" && p.env?.GEMINI_API_KEY) return p.env.GEMINI_API_KEY;
        }
        return null;
      } catch { return null; }
    },
    emitToRenderer: (channel: string, data: any) => { safeSend(ctx, channel, data); },
    roleMap: undefined as any, // Will be set by pane-handlers via bridge composition
  };
}

export async function startMcpServer(ctx: AppContext): Promise<void> {
  const { startMCPServer } = require("../../packages/mcp/server.js");
  const bridge = buildMcpBridge(ctx);

  // Store bridge reference on ctx so IPC handlers (e.g. register-recipe.ts)
  // can access handler methods. This gets ENRICHED once startMCPServer calls createMCPBridge.
  (ctx as any)._mcpBridge = bridge;

  // Callback: startMCPServer → createMCPBridge produces a NEW enriched object.
  // We must update ctx._mcpBridge to the enriched version so IPC handlers find cron, recipes, etc.
  bridge._exposeBridge = (enriched: any) => {
    (ctx as any)._mcpBridge = enriched;
    console.log("[MCP] Enriched bridge stored on ctx._mcpBridge (cron, recipes, etc. available)");
  };

  // Wire clarify_broadcast hook → IPC to renderer
  // When a worker submits awaiting_clarification with suggestions, push to the UI.
  if (ctx.hooksManager) {
    ctx.hooksManager.on("clarify_broadcast", (payload: any) => {
      safeSend(ctx, "clarify:request", payload);
    });
  }

  // _triggerMrPoll is set synchronously inside createMCPBridge (called by startMCPServer).
  // But startMCPServer also starts the HTTP server (async). We need mcpServerReady to
  // resolve once the server is listening so pane-spawn can get the port.
  // Use a deferred promise that resolves after the HTTP server starts.
  let resolveReady: (info: McpServerInfo) => void;
  let rejectReady: (err: any) => void;
  ctx.mcpServerReady = new Promise<McpServerInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  console.log(`[MCP] mcpServerReady deferred promise created, _triggerMrPoll set:`, typeof (ctx as any)._triggerMrPoll);

  const tryStart = async () => {
    const info: McpServerInfo = await startMCPServer(ctx.ptyManager, bridge);
    ctx.mcpServerInfo = info;
    writeMcpConfig(ctx, info);
    console.log(`[MCP] Server started on port ${info.port}`);
    console.log(`[MCP] SSE: ${info.sseUrl}`);
    console.log(`[MCP] Streamable HTTP: ${info.streamableHttpUrl}`);
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
