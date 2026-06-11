import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { AppContext } from "../context";

/**
 * Detect if a directory is a git repo with a remote (eligible for MR review).
 */
function isGitRepoWithRemote(dir: string): boolean {
  try {
    const gitDir = path.join(dir, ".git");
    if (!fs.existsSync(gitDir)) return false;
    // Check for remote via config file
    const configPath = fs.statSync(gitDir).isDirectory()
      ? path.join(gitDir, "config")
      : null;
    if (configPath && fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      return /\[remote\s+"origin"\]/.test(content);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get repo name from git remote URL.
 */
function getRepoName(dir: string): string | null {
  try {
    const gitDir = path.join(dir, ".git");
    const configPath = fs.statSync(gitDir).isDirectory()
      ? path.join(gitDir, "config")
      : null;
    if (!configPath || !fs.existsSync(configPath)) return null;
    const content = fs.readFileSync(configPath, "utf-8");
    const match = content.match(/url\s*=\s*(?:https?:\/\/[^/]+\/|git@[^:]+:)(.+?)(?:\.git)?$/m);
    return match ? match[1].replace(/\.git$/, "") : path.basename(dir);
  } catch {
    return path.basename(dir);
  }
}

export function registerMrReviewHandlers(ctx: AppContext): void {
  /**
   * mr_review:status — returns current poll state + allowed workspaces
   */
  ipcMain.handle("mr_review:status", async () => {
    try {
      const config = ctx.configStore?.get?.() || {};
      const allowed: string[] = (config.mr_allowed_workspaces as string[]) || [];
      const autoReview = !!config.mr_auto_review;

      // Check if mr_poll worker is currently running
      const reviewing = !!(ctx as any)._mrReviewActive;
      const activeWsSet: Set<string> = (ctx as any)._mrReviewActiveWorkspaces;
      const activeWorkspaces: string[] = activeWsSet ? [...activeWsSet] : [];

      return {
        ok: true,
        reviewing,
        activeWorkspaces,
        allowedWorkspaces: allowed,
        autoReview,
        hasReviewModel: !!(config.mr_review_provider && config.mr_review_model),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * mr_review:allowed — list allowed workspaces with metadata
   */
  ipcMain.handle("mr_review:allowed", async () => {
    try {
      const config = ctx.configStore?.get?.() || {};
      const allowed: string[] = (config.mr_allowed_workspaces as string[]) || [];

      // Collect ALL known workspace paths from multiple sources
      const wsSet = new Set<string>();

      // 1. Current workspace
      if (ctx.currentWorkspacePath) wsSet.add(ctx.currentWorkspacePath);

      // 2. Active pane configs (terminals currently open)
      for (const [, cfg] of ctx.paneConfigs) {
        if (cfg.cwd) wsSet.add(cfg.cwd);
      }

      // 3. Recent workspaces file
      try {
        if (fs.existsSync(ctx.WORKSPACES_FILE)) {
          const recents: string[] = JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8"));
          for (const ws of recents) {
            if (ws && typeof ws === "string") wsSet.add(ws);
          }
        }
      } catch {}

      // Filter to only git repos with remotes
      const detected: Array<{ path: string; name: string; allowed: boolean }> = [];
      for (const ws of wsSet) {
        if (!ws || !fs.existsSync(ws)) continue;
        if (!isGitRepoWithRemote(ws)) continue;
        // Deduplicate (normalize paths)
        const normalized = path.resolve(ws);
        if (detected.find(d => path.resolve(d.path) === normalized)) continue;
        const repoName = getRepoName(ws);
        detected.push({
          path: ws,
          name: repoName || path.basename(ws),
          allowed: allowed.includes(ws),
        });
      }

      return { ok: true, workspaces: detected };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * mr_review:set-allowed — update allowed workspaces list
   */
  ipcMain.handle("mr_review:set-allowed", async (_event, args: { workspaces: string[] }) => {
    try {
      if (!ctx.configStore) return { ok: false, error: "configStore not available" };
      ctx.configStore.set({ mr_allowed_workspaces: args.workspaces });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * mr_review:trigger — manually trigger review for a specific workspace
   * Includes debounce to prevent rapid re-triggering.
   */
  ipcMain.handle("mr_review:trigger", async (_event, args: { workspace: string }) => {
    try {
      const ws = args?.workspace;
      if (!ws) {
        return { ok: false, error: "workspace is required" };
      }

      // Fix #1: Validate workspace is a real git repo before proceeding
      if (!isGitRepoWithRemote(ws)) {
        return { ok: false, error: "Workspace is not a valid git repository with a remote" };
      }

      // Poll for _triggerMrPoll first, BEFORE setting any state (Fix #4: debounce race)
      let triggerFn = (ctx as any)._triggerMrPoll;
      if (typeof triggerFn !== 'function') {
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 500));
          triggerFn = (ctx as any)._triggerMrPoll;
          if (typeof triggerFn === 'function') break;
        }
      }
      if (typeof triggerFn !== 'function') {
        return { ok: false, error: "MCP server not ready. Try again in a few seconds." };
      }

      // Debounce: only after confirming trigger is available (Fix #4)
      const now = Date.now();
      const lastTrigger: number = (ctx as any)._mrReviewLastTrigger ?? 0;
      if (now - lastTrigger < 30_000) {
        const remaining = Math.ceil((30_000 - (now - lastTrigger)) / 1000);
        return { ok: false, error: `Review já foi disparado há ${Math.round((now - lastTrigger) / 1000)}s. Aguarde ${remaining}s.` };
      }
      (ctx as any)._mrReviewLastTrigger = now;

      // Set active flag for UI indicator
      (ctx as any)._mrReviewActive = true;
      const activeWs: Set<string> = (ctx as any)._mrReviewActiveWorkspaces ?? new Set();
      activeWs.add(ws);
      (ctx as any)._mrReviewActiveWorkspaces = activeWs;

      const result = triggerFn();

      // Auto-clear reviewing state after 120s (safety net)
      setTimeout(() => {
        activeWs.delete(ws);
        if (activeWs.size === 0) (ctx as any)._mrReviewActive = false;
      }, 120_000);

      return { ok: true, message: `Review triggered for ${ws}` };
    } catch (err: any) {
      // Fix #2: Always clear active state on any failure
      (ctx as any)._mrReviewActive = false;
      (ctx as any)._mrReviewActiveWorkspaces = new Set();
      return { ok: false, error: err.message };
    }
  });
}
