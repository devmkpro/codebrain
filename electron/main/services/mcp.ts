import { ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext, McpServerInfo } from "../context";
import { safeSend, ApiProxy } from "../context";
import { spawnPaneInternal } from "./pane-spawn";
import { sendBrowserCmd, saveScreenshot, saveScreenshotElement, getNetworkLog, getConsoleLog, clearBrowserLogs, resolveBrowserPaneId } from "./browser";

export function writeMcpConfig(ctx: AppContext, info: McpServerInfo): void {
  // Home ~/.mcp.json (stdio transport) is already written by setup-claude.ts.
  // Workspace .mcp.json (SSE transport) must be updated whenever the MCP server
  // restarts with a new port (port=0 → random each time). We iterate all known
  // workspace CWDs from paneConfigs, recent workspaces, and rewrite their
  // .mcp.json with the current URL.

  const updatedPaths = new Set<string>();

  // 1. Update .mcp.json in the current workspace
  if (ctx.currentWorkspacePath) {
    updatedPaths.add(ctx.currentWorkspacePath);
  }

  // 2. Update .mcp.json in all active pane workspaces
  for (const [, cfg] of ctx.paneConfigs) {
    if (cfg.cwd) updatedPaths.add(cfg.cwd);
  }

  // 3. Update .mcp.json in all recent workspaces (survives restarts)
  try {
    if (fs.existsSync(ctx.WORKSPACES_FILE)) {
      const recents: string[] = JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8"));
      for (const ws of recents) {
        if (ws && fs.existsSync(ws)) updatedPaths.add(ws);
      }
    }
  } catch (e) {
    console.warn("[writeMcpConfig] Failed to read recent workspaces:", e);
  }

  const mcpContent = JSON.stringify({
    mcpServers: { codebrain: { type: "sse", url: info.sseUrl } },
  }, null, 2);

  for (const cwd of updatedPaths) {
    try {
      const mcpPath = path.join(cwd, ".mcp.json");
      fs.writeFileSync(mcpPath, mcpContent, "utf-8");
      console.log(`[writeMcpConfig] Updated .mcp.json → ${mcpPath} (port ${info.port})`);
    } catch (e) {
      console.warn(`[writeMcpConfig] Failed to update .mcp.json in ${cwd}:`, e);
    }
  }
}

function buildMcpBridge(ctx: AppContext) {
  return {
    spawnPaneFn: (req: { agent?: string; providerId?: string; model?: string; cwd?: string; systemPromptFile?: string; hidden?: boolean }) =>
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
    costTracker: ctx.costTracker, // Shared singleton — same instance for MCP + IPC
    roleMap: undefined as any, // Will be set by pane-handlers via bridge composition
  };
}

export async function startMcpServer(ctx: AppContext): Promise<void> {
  const { startMCPServer } = require("../../packages/mcp/server.js");
  const bridge = buildMcpBridge(ctx);

  // Wire up tokens:updated event — emit to renderer on every recordUsage() call
  if (ctx.costTracker) {
    ctx.costTracker.onUsageRecorded = (info: { sessionId: string; model: string; inputTokens: number; outputTokens: number; cost: number }) => {
      safeSend(ctx, "tokens:updated", info);
    };
  }

  // Start API proxy for token usage tracking
  // The proxy intercepts Anthropic-compatible API calls from agent CLIs,
  // extracts token usage from responses, and reports to CostTracker.
  try {
    const proxy = new ApiProxy({
      onTokenUsage: (usage: { paneId: string; model: string; inputTokens: number; outputTokens: number }) => {
        // Diagnostic: log exact model name from proxy for debugging pricing
        console.log(`[CostTracker] onTokenUsage: model="${usage.model}" input=${usage.inputTokens} output=${usage.outputTokens}`);

        // Resolve pane attribution: proxy doesn't know which pane made the request,
        // so we try to match by model name from paneConfigs.
        let resolvedPaneId = usage.paneId;
        let paneCfg = ctx.paneConfigs.get(resolvedPaneId);
        if (!paneCfg && usage.model) {
          // Find pane by model name
          for (const [pid, cfg] of ctx.paneConfigs) {
            if (cfg.model === usage.model) {
              resolvedPaneId = pid;
              paneCfg = cfg;
              break;
            }
          }
        }
        const workspace = ctx.currentWorkspacePath || process.cwd();
        const result = ctx.costTracker.recordUsage({
          model: usage.model || paneCfg?.model || "unknown",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          agentId: paneCfg?.agent || resolvedPaneId,
          workspace,
          taskId: paneCfg?.taskId,
        });
        if (!result?.ok) {
          console.warn(`[API Proxy] recordUsage failed: ${result?.error} (model=${usage.model})`);
        }
      },
    });
    const { port } = await proxy.start();
    ctx.apiProxyUrl = `http://127.0.0.1:${port}`;
    ctx.apiProxy = proxy;
    console.log(`[API Proxy] Token tracking proxy started on ${ctx.apiProxyUrl}`);
  } catch (err) {
    console.error("[API Proxy] Failed to start proxy:", err);
    // Non-fatal — agents will still work, just without token tracking
  }

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
