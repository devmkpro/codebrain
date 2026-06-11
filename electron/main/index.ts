/**
 * Electron Main Process — Entry Point
 *
 * Bootstrap only: creates window, registers IPC handlers, wires up PTY events,
 * and starts the MCP server. All domain logic lives in services/ and ipc/.
 */
import { app, session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import log from "electron-log/main.js";

import { platform } from "./platform";
import { enrichShellPath } from "./shell-path";
import { setupAutoUpdater, teardownAutoUpdater, isUpdateInstallRequested } from "./auto-updater";
import { createAppContext, safeSend } from "./context";
import { createWindow } from "./window";
import { registerAllIpcHandlers } from "./ipc/register-all";
import { startMcpServer } from "./services/mcp";
import { attachNetworkTracking } from "./services/network";
import { setupHooks } from "./services/hooks";
import { setupClaudeIntegration } from "./services/setup-claude";
import { refreshAllWorkspaces, clearCodexGlobalConfig } from "./services/workspace";
import { setupDiscordRPC, teardownDiscordRPC } from "./discord-rpc";
import { createSessionWatchers } from "./services/session-watchers";

log.initialize();

/**
 * Auto-install bundled skills from resources/  into ~/.codebrain/skills/.
 * Each sub-directory in resources/ that contains a skill.json is treated as a bundled skill.
 * Installs only if the skill is not already present (never overwrites user edits).
 */
function autoInstallBundledSkills(): void {
  try {
    const isPackaged = app.isPackaged;
    const resourcesDir = isPackaged
      ? process.resourcesPath
      : path.join(__dirname, "..", "..", "resources");

    if (!fs.existsSync(resourcesDir)) return;

    const globalSkillsDir = path.join(os.homedir(), ".codebrain", "skills");
    fs.mkdirSync(globalSkillsDir, { recursive: true });

    for (const entry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bundledDir = path.join(resourcesDir, entry.name);
      const manifestPath = path.join(bundledDir, "skill.json");
      if (!fs.existsSync(manifestPath)) continue; // not a skill directory

      const targetDir = path.join(globalSkillsDir, entry.name);
      if (fs.existsSync(targetDir)) continue; // already installed — don't overwrite

      try {
        fs.mkdirSync(targetDir, { recursive: true });
        copyDirRecursive(bundledDir, targetDir);
        log.info(`[Skills] Auto-installed bundled skill: ${entry.name}`);
      } catch (err) {
        log.warn(`[Skills] Failed to install bundled skill '${entry.name}':`, err);
      }
    }
  } catch (err) {
    log.warn("[Skills] autoInstallBundledSkills error:", err);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const ctx = createAppContext();

app.whenReady().then(async () => {
  // Enrich PATH on Linux/macOS — GUI-launched Electron has a minimal PATH
  // that doesn't include NVM/FNM/bun/node paths. Must run before any
  // service that spawns child processes (PTY, MCP, CLI detector).
  enrichShellPath();

  fs.mkdirSync(ctx.DATA_DIR, { recursive: true });

  // Auto-install Claude Code integration (statusline, .mcp.json, helpers)
  setupClaudeIntegration();

  // Auto-install bundled skills (~/.codebrain/skills/<id>)
  autoInstallBundledSkills();

  // Clean up any stale codebrain MCP entry in ~/.codex/config.toml from a previous
  // crashed session. MCP is injected via -c flag at spawn time,
  // never via config.toml — so any leftover entry there causes Codex to error on startup.
  clearCodexGlobalConfig();

  // Refresh all workspace provider files (pre-MCP, uses fixed port default)
  refreshAllWorkspaces(ctx);

  ctx.mainWindow = createWindow();
  registerAllIpcHandlers(ctx);
  setupAutoUpdater(ctx.mainWindow);

  // Discord Rich Presence (fire-and-forget, silent if Discord not running)
  const discordClientId = ctx.configStore.get().discordClientId as string | undefined;
  setupDiscordRPC(discordClientId);

  // PTY event forwarding
  ctx.ptyManager.on("output", (paneId: string, data: string) => {
    safeSend(ctx, "pty:output", paneId, data, false);
  });
  ctx.ptyManager.on("output-echo", (paneId: string, data: string) => {
    safeSend(ctx, "pty:output", paneId, data, true);
  });
  ctx.ptyManager.on("exit", (paneId: string, exitCode: number) => {
    safeSend(ctx, "pty:exit", paneId, exitCode);

    // Auto-save to session history BEFORE deleting config/registry
    try {
      const cfg = ctx.paneConfigs.get(paneId);
      const registry = ctx.paneRegistry.get(paneId);
      const now = Date.now();
      const output = ctx.ptyManager.read(paneId, 200);
      ctx.memoryStore.saveSessionHistory({
        pane_id: paneId,
        label: cfg?.role || cfg?.agent || "unknown",
        agent: cfg?.agent,
        model: cfg?.model,
        provider_id: cfg?.providerId,
        workspace: ctx.currentWorkspacePath,
        started_at: registry?.spawnedAt,
        ended_at: now,
        duration_ms: registry?.spawnedAt ? now - registry.spawnedAt : undefined,
        exit_code: exitCode,
        output_preview: output.slice(-5).join("\n").slice(0, 500),
      });
    } catch (err) {
      log.error("[session] auto-save history failed:", err);
    }

    ctx.sessionWatchers?.unregisterPane(paneId);
    ctx.paneConfigs.delete(paneId);
    ctx.paneRegistry.delete(paneId);
  });

  // Wire lifecycle hooks system
  setupHooks(ctx.hooksManager, ctx.ptyManager, ctx);

  // Session watchers — capture CLI transcripts from Kimi, Antigravity, Cursor, Copilot, Codex, Gemini
  ctx.sessionWatchers = createSessionWatchers(ctx);
  ctx.sessionWatchers.start();
  ctx.hooksManager.on("pane_spawned", (event: any) => {
    const { paneId, data } = event;
    if (!paneId || !data) return;
    ctx.sessionWatchers?.registerPane({
      paneId,
      agent: data.agent || "unknown",
      cwd: data.cwd || ctx.currentWorkspacePath,
      spawnedAt: Date.now(),
    });
  });

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
  teardownDiscordRPC();
  if (ctx.mcpServerInfo) {
    ctx.mcpServerInfo.close();
    ctx.mcpServerInfo = null;
  }
  ctx.ptyManager.killAll();
  // Remove codebrain from ~/.codex/config.toml so Codex doesn't error on a dead server
  clearCodexGlobalConfig();
  if (isUpdateInstallRequested()) return;
  teardownAutoUpdater();
});
