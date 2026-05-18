import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ipcMain } from "electron";
import type { AppContext, McpServerInfo } from "../context";
import { safeSend } from "../context";
import { spawnPaneInternal } from "./pane-spawn";
import { sendBrowserCmd, saveScreenshot, saveScreenshotElement, getNetworkLog, getConsoleLog, clearBrowserLogs, resolveBrowserPaneId } from "./browser";

export function writeMcpConfig(ctx: AppContext, info: McpServerInfo): void {
  const config = JSON.stringify({
    mcpServers: { codebrain: { type: "sse", url: info.sseUrl } },
  }, null, 2);
  try { fs.writeFileSync(path.join(os.homedir(), ".mcp.json"), config, "utf-8"); } catch {}
  try {
    if (ctx.currentWorkspacePath && ctx.currentWorkspacePath !== os.homedir()) {
      fs.writeFileSync(path.join(ctx.currentWorkspacePath, ".mcp.json"), config, "utf-8");
    }
  } catch {}
}

function buildMcpBridge(ctx: AppContext) {
  return {
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
    resolveBrowserPaneId: (paneId?: string) => resolveBrowserPaneId(ctx, paneId),
    createBrowserPane: (url: string) => {
      return new Promise<{ ok: boolean; paneId: string; error?: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout creating browser pane")), 10000);
        const handler = (_evt: unknown, createdPaneId: string) => {
          clearTimeout(timer);
          ipcMain.off("codebrain:browser:pane-created", handler);
          ctx.browserPaneIds.add(createdPaneId);
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
