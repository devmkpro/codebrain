import { ipcMain, Notification, shell } from "electron";
import type { AppContext } from "../context";
import { getEnhancedProviders } from "../services/providers";

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
      tools: ctx.mcpServerInfo ? [
        "mcp__codebrain__pane_spawn", "mcp__codebrain__pane_write", "mcp__codebrain__pane_read",
        "mcp__codebrain__pane_wait_idle", "mcp__codebrain__pane_list", "mcp__codebrain__pane_set_role",
        "mcp__codebrain__pane_send_message", "mcp__codebrain__pane_read_messages", "mcp__codebrain__todo_manager",
        "mcp__codebrain__browser_navigate", "mcp__codebrain__browser_open", "mcp__codebrain__browser_back",
        "mcp__codebrain__browser_forward", "mcp__codebrain__browser_reload", "mcp__codebrain__browser_get_html",
        "mcp__codebrain__browser_get_text", "mcp__codebrain__browser_get_accessibility_tree",
        "mcp__codebrain__browser_find_by_text", "mcp__codebrain__browser_get_element_info",
        "mcp__codebrain__browser_get_url", "mcp__codebrain__browser_click", "mcp__codebrain__browser_fill",
        "mcp__codebrain__browser_select", "mcp__codebrain__browser_check", "mcp__codebrain__browser_clear",
        "mcp__codebrain__browser_focus", "mcp__codebrain__browser_hover", "mcp__codebrain__browser_click_at",
        "mcp__codebrain__browser_hover_at", "mcp__codebrain__browser_drag", "mcp__codebrain__browser_scroll",
        "mcp__codebrain__browser_type", "mcp__codebrain__browser_key", "mcp__codebrain__browser_shortcut",
        "mcp__codebrain__browser_wait_for", "mcp__codebrain__browser_wait_for_text",
        "mcp__codebrain__browser_wait_for_url", "mcp__codebrain__browser_wait_for_load",
        "mcp__codebrain__browser_screenshot", "mcp__codebrain__browser_screenshot_element",
        "mcp__codebrain__browser_annotate", "mcp__codebrain__browser_console_log",
        "mcp__codebrain__browser_clear_console", "mcp__codebrain__browser_network_log",
        "mcp__codebrain__browser_network_wait", "mcp__codebrain__browser_clear_network",
        "mcp__codebrain__browser_eval",
      ] : [],
      toolCount: ctx.mcpServerInfo ? 47 : 0,
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
