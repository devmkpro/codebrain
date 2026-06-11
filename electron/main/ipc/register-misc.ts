import { ipcMain, Notification, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";
import { getEnhancedProviders } from "../services/providers";
import { getTokenTracker } from "../services/token-tracker";

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

  ipcMain.handle("diagnostics:snapshot", () => {
    const mem = process.memoryUsage();
    const panes = ctx.ptyManager.list();
    return {
      app: {
        version: require("electron").app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        osRelease: require("os").release(),
      },
      workspace: { active: null },
      providers: getEnhancedProviders(ctx),
      backendPanes: panes,
      panes,
      processes: [],
      clis: ctx.cliDetector.getAll(),
      memory: mem,
      mcp: {
        active: !!ctx.mcpServerInfo,
        port: ctx.mcpServerInfo?.port ?? null,
        sseUrl: ctx.mcpServerInfo?.sseUrl ?? null,
        streamableHttpUrl: ctx.mcpServerInfo?.streamableHttpUrl ?? null,
        tools: ctx.mcpServerInfo ? getMcpToolNames() : [],
        toolCount: ctx.mcpServerInfo ? getMcpToolCount() : 0,
      },
    };
  });

  // Performance HUD snapshot — RSS + CPU per pane
  ipcMain.handle("diagnostics:perfSnap", async () => {
    const mem = process.memoryUsage();
    const electronRssMB = Math.round(mem.rss / 1024 / 1024);
    const panes = ctx.ptyManager.list();
    // Collect per-pane process info where available
    const paneSnaps = panes.map((p: any) => {
      const pid = ctx.ptyManager.getPid?.(p.paneId) ?? null;
      return {
        paneId: p.paneId,
        agent: p.agent ?? "agent",
        pid,
        rssMB: 0, // real RSS needs OS-level query per PID; approximate with 0 for now
        cpu: 0,
      };
    });
    return {
      totalRssMB: electronRssMB,
      electronRssMB,
      panesRssMB: 0,
      paneCount: panes.length,
      panes: paneSnaps,
    };
  });

  // Feature 8: Token tracking IPC handlers
  ipcMain.handle("tokens:recordTokens", (_event, args: { paneId: string; input: number; output: number; cacheRead?: number; cacheWrite?: number; costUsd?: number; workspacePath?: string }) => {
    getTokenTracker().recordTokens(args.paneId, args.input, args.output, args.cacheRead ?? 0, args.cacheWrite ?? 0, args.costUsd ?? 0, args.workspacePath ?? "");
    return { ok: true };
  });

  ipcMain.handle("tokens:byPane", (_event, args: { paneId: string }) => {
    return { ok: true, data: getTokenTracker().aggregateByPane(args.paneId) };
  });

  ipcMain.handle("tokens:byWorkspace", (_event, args: { workspacePath: string; sinceMs?: number }) => {
    return { ok: true, data: getTokenTracker().aggregateByWorkspace(args.workspacePath, args.sinceMs ?? 0) };
  });

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
