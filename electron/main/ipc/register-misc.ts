import { ipcMain, Notification, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";
import { getEnhancedProviders } from "../services/providers";

/** Read MCP tool names dynamically — single source of truth is packages/mcp/index.js */
function getMcpToolNames(): string[] {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../packages/mcp/index.js"),
      "utf-8"
    );
    const matches = src.match(/server\.tool\(\s*["']([^"']+)["']/g) ?? [];
    return matches.map(m => {
      const r = m.match(/["']([^"']+)["']\s*$/);
      return r ? r[1] : "";
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function getMcpToolCount(): number {
  return getMcpToolNames().length;
}

export function registerMiscHandlers(ctx: AppContext): void {
  ipcMain.on("notify", (_event, title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });

  ipcMain.handle("diagnostics:snapshot", () => ({
    app: {
      version: require("electron").app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: require("os").release(),
    },
    workspace: { active: null },
    providers: getEnhancedProviders(ctx),
    backendPanes: ctx.ptyManager.list(),
    panes: ctx.ptyManager.list(),
    processes: [],
    clis: ctx.cliDetector.getAll(),
    memory: process.memoryUsage(),
    mcp: {
      active: !!ctx.mcpServerInfo,
      port: ctx.mcpServerInfo?.port ?? null,
      sseUrl: ctx.mcpServerInfo?.sseUrl ?? null,
      streamableHttpUrl: ctx.mcpServerInfo?.streamableHttpUrl ?? null,
      // Tool list is read dynamically from packages/mcp/index.js — never hardcode here.
      tools: ctx.mcpServerInfo ? getMcpToolNames() : [],
      toolCount: ctx.mcpServerInfo ? getMcpToolCount() : 0,
    },
  }));

  // Auth stubs
  ipcMain.handle("auth:status", async () => ({ authenticated: true, email: "" }));
  ipcMain.handle("auth:logout", async () => {});
  ipcMain.handle("auth:profile", async () => ({}));
  ipcMain.handle("auth:open-login", async () => shell.openExternal("https://codebrain.sh"));
  ipcMain.handle("auth:open-signup", async () => shell.openExternal("https://codebrain.sh/signup"));
  ipcMain.handle("auth:open-terms", async () => shell.openExternal("https://codebrain.sh/terms"));
  ipcMain.handle("auth:open-privacy", async () => shell.openExternal("https://codebrain.sh/privacy"));
  ipcMain.handle("auth:open-billing", async () => shell.openExternal("https://codebrain.sh/billing"));
}
