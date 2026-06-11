import { ipcMain } from "electron";
import * as fs from "fs";
import { stat, readFile, existsSync } from "fs";
import { promisify } from "util";
import * as path from "path";
import type { AppContext } from "../context";

const statAsync = promisify(stat);
const readFileAsync = promisify(readFile);

/**
 * Resolve the .git directory path — handles both regular repos and worktrees.
 * For worktrees, .git is a file containing "gitdir: <path>".
 * Uses async fs to avoid blocking the Electron main process.
 */
async function resolveGitDir(dir: string): Promise<string | null> {
  try {
    const gitPath = path.join(dir, ".git");
    if (!existsSync(gitPath)) return null;
    const st = await statAsync(gitPath);
    if (st.isDirectory()) return gitPath;
    // Worktree: .git is a file with "gitdir: <absolute-path>"
    const content = (await readFileAsync(gitPath, "utf-8")).trim();
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (match) {
      const worktreeGitDir = path.resolve(dir, match[1].trim());
      if (existsSync(worktreeGitDir)) return worktreeGitDir;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect if a directory is a git repo with a remote (eligible for MR review).
 * Handles both regular repos and worktrees.
 * Uses async fs to avoid blocking the Electron main process.
 */
async function isGitRepoWithRemote(dir: string): Promise<boolean> {
  try {
    const gitDir = await resolveGitDir(dir);
    if (!gitDir) return false;
    // For worktrees, config lives in the parent repo's common dir
    const commonDirPath = path.join(gitDir, "commondir");
    const commonDir = existsSync(commonDirPath)
      ? path.join(gitDir, (await readFileAsync(commonDirPath, "utf-8")).trim())
      : gitDir;
    const configPath = path.join(commonDir, "config");
    if (existsSync(configPath)) {
      const content = await readFileAsync(configPath, "utf-8");
      return /\[remote\s+"origin"\]/.test(content);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get repo name from git remote URL.
 * Handles both regular repos and worktrees.
 * Uses async fs to avoid blocking the Electron main process.
 */
async function getRepoName(dir: string): Promise<string | null> {
  try {
    const gitDir = await resolveGitDir(dir);
    if (!gitDir) return path.basename(dir);
    const commonDirPath = path.join(gitDir, "commondir");
    const commonDir = existsSync(commonDirPath)
      ? path.join(gitDir, (await readFileAsync(commonDirPath, "utf-8")).trim())
      : gitDir;
    const configPath = path.join(commonDir, "config");
    if (!existsSync(configPath)) return path.basename(dir);
    const content = await readFileAsync(configPath, "utf-8");
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
      const activeWsSet: Set<string> = (ctx as any)._mrReviewActiveWorkspaces ?? new Set();
      const activeWorkspaces: string[] = [...activeWsSet];

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
      } catch (err: unknown) {
        console.warn("[mr_review:allowed] Failed to read recent workspaces file:", err instanceof Error ? err.message : err);
      }

      // Filter to only git repos with remotes (async to avoid blocking main process)
      const detected: Array<{ path: string; name: string; allowed: boolean }> = [];
      for (const ws of wsSet) {
        if (!ws || !fs.existsSync(ws)) continue;
        if (!(await isGitRepoWithRemote(ws))) continue;
        // Deduplicate (normalize paths)
        const normalized = path.resolve(ws);
        if (detected.find(d => path.resolve(d.path) === normalized)) continue;
        const repoName = await getRepoName(ws);
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
   * Per-workspace debounce (30s) to prevent rapid re-triggering.
   */
  ipcMain.handle("mr_review:trigger", async (_event, args: { workspace: string }) => {
    try {
      const ws = args?.workspace;
      if (!ws) {
        return { ok: false, error: "workspace is required" };
      }

      // Validate workspace is a real git repo before proceeding
      if (!(await isGitRepoWithRemote(ws))) {
        return { ok: false, error: "Workspace is not a valid git repository with a remote" };
      }

      // Wait for MCP server readiness via mcpServerReady promise instead of busy-wait polling.
      // _triggerMrPoll is set synchronously inside createMCPBridge (before HTTP server starts),
      // so once mcpServerReady resolves, the trigger is guaranteed to be available.
      let triggerFn: ((opts?: { workspace?: string }) => any) | undefined = (ctx as any)._triggerMrPoll;
      if (typeof triggerFn !== 'function') {
        if (ctx.mcpServerReady) {
          try {
            await Promise.race([
              ctx.mcpServerReady,
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
            ]);
          } catch {
            // Timeout or startup error — fall through to check one more time
          }
          triggerFn = (ctx as any)._triggerMrPoll;
        }
      }
      if (typeof triggerFn !== 'function') {
        return { ok: false, error: "MCP server not ready. Try again in a few seconds." };
      }

      // Per-workspace debounce: Map<string, number> keyed by workspace path
      const now = Date.now();
      const triggerMap: Map<string, number> = (ctx as any)._mrReviewLastTriggerMap ?? new Map();
      (ctx as any)._mrReviewLastTriggerMap = triggerMap;
      const lastTrigger: number = triggerMap.get(ws) ?? 0;
      if (now - lastTrigger < 30_000) {
        const remaining = Math.ceil((30_000 - (now - lastTrigger)) / 1000);
        return { ok: false, error: `Review já foi disparado há ${Math.round((now - lastTrigger) / 1000)}s. Aguarde ${remaining}s.` };
      }
      triggerMap.set(ws, now);

      // Set active flag for UI indicator
      (ctx as any)._mrReviewActive = true;
      const activeWs: Set<string> = (ctx as any)._mrReviewActiveWorkspaces ?? new Set();
      activeWs.add(ws);
      (ctx as any)._mrReviewActiveWorkspaces = activeWs;

      // Fire-and-forget: do NOT await the trigger — it waits for pane idle (up to 3 min)
      // which would block the IPC response and freeze the renderer.
      const result = triggerFn({ workspace: ws });
      if (result && typeof result.then === "function") {
        result.catch((triggerErr: unknown) => {
          console.error("[mr_review:trigger] triggerFn failed:", triggerErr);
          activeWs.delete(ws);
          if (activeWs.size === 0) (ctx as any)._mrReviewActive = false;
        });
      }

      // Auto-clear reviewing state after 120s (safety net)
      setTimeout(() => {
        activeWs.delete(ws);
        if (activeWs.size === 0) (ctx as any)._mrReviewActive = false;
      }, 120_000);

      return { ok: true, message: `Review triggered for ${ws}` };
    } catch (err: any) {
      // Always clear active state on any failure
      (ctx as any)._mrReviewActive = false;
      (ctx as any)._mrReviewActiveWorkspaces = new Set();
      return { ok: false, error: err.message };
    }
  });

  /**
   * mr_review:apply-fixes — spawn an agent to auto-fix review findings
   */
  ipcMain.handle("mr_review:apply-fixes", async (_event, args: { workspace: string; mrId: number; findings: string }) => {
    try {
      const { workspace, mrId, findings } = args;
      if (!workspace || !findings) {
        return { ok: false, error: "workspace and findings are required" };
      }

      // Use the configured review provider/model
      const config = ctx.configStore?.get?.() || {};
      const provider = config.mr_review_provider as string;
      const model = config.mr_review_model as string;
      if (!provider || !model) {
        return { ok: false, error: "No review model configured" };
      }

      // Import spawnPaneInternal
      const { spawnPaneInternal } = await import("../services/pane-spawn");

      const spawnResult = await spawnPaneInternal(ctx, {
        providerId: provider,
        model,
        cwd: workspace,
      });

      if (!spawnResult?.ok || !spawnResult?.paneId) {
        return { ok: false, error: `Failed to spawn fix agent: ${spawnResult?.error || "unknown"}` };
      }

      const fixPaneId = spawnResult.paneId;

      // Wait for CLI readiness
      await new Promise(r => setTimeout(r, 5000));

      // Write the fix prompt
      const fixPrompt = [
        `You are a code fixer. Apply the following review findings to the codebase.`,
        ``,
        `MR !${mrId} — Workspace: ${workspace}`,
        ``,
        `FINDINGS TO FIX:`,
        findings,
        ``,
        `INSTRUCTIONS:`,
        `1. Read each finding carefully`,
        `2. Locate the relevant files in the codebase`,
        `3. Apply minimal, targeted fixes for each finding`,
        `4. Do NOT change anything unrelated to the findings`,
        `5. After applying all fixes, summarize what you changed`,
        `6. Do NOT commit — just apply the code changes`,
      ].join("\n");

      const ptyManager = ctx.ptyManager;
      if (ptyManager) {
        // Sanitize newlines for readline
        const sanitized = fixPrompt.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
        ptyManager.writeSilent(fixPaneId, sanitized);
        await new Promise(r => setTimeout(r, Math.min(3000, 100 + sanitized.length * 0.5)));
        ptyManager.write(fixPaneId, "\r");
      }

      return { ok: true, paneId: fixPaneId };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
