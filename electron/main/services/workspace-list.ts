import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";

export function workspacePathKey(value: string): string {
  const resolved = path.resolve(value).replace(/\\/g, "/").replace(/\/$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isWorkspaceDirectory(value: string): boolean {
  try { return Boolean(value) && fs.statSync(value).isDirectory(); } catch { return false; }
}

export function saveRecentWorkspaces(ctx: AppContext, workspaces: string[]): void {
  fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8");
  // Reuse the existing preload subscription. Registry changes invalidate the
  // whole board, not just the workspace that happened to be selected.
  const window = ctx.mainWindow;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send("operations:updated", { workspaceListChanged: true, at: Date.now() });
  }
}

export function readRecentWorkspaces(ctx: AppContext): string[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8"));
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const valid = raw.filter((value): value is string => {
      if (typeof value !== "string" || !isWorkspaceDirectory(value)) return false;
      const key = workspacePathKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (valid.length !== raw.length) {
      // A read-only profile must still be able to display valid entries.
      try { saveRecentWorkspaces(ctx, valid); } catch {}
    }
    return valid;
  } catch { return []; }
}

export function touchWorkspace(ctx: AppContext, wsPath: string): void {
  if (!isWorkspaceDirectory(wsPath)) return;
  const key = workspacePathKey(wsPath);
  const list = readRecentWorkspaces(ctx).filter((item) => workspacePathKey(item) !== key);
  saveRecentWorkspaces(ctx, [wsPath, ...list].slice(0, 20));
}

export function removeWorkspace(ctx: AppContext, wsPath: string): void {
  const key = workspacePathKey(wsPath);
  const list = readRecentWorkspaces(ctx).filter((item) => workspacePathKey(item) !== key);
  saveRecentWorkspaces(ctx, list);
  // Otherwise the removed path remains implicitly "active" in operations.
  if (ctx.currentWorkspacePath && workspacePathKey(ctx.currentWorkspacePath) === key) {
    ctx.currentWorkspacePath = list[0] || "";
  }
}

export function isRegisteredOrActiveWorkspace(ctx: AppContext, workspace: string): boolean {
  if (!isWorkspaceDirectory(workspace)) return false;
  const key = workspacePathKey(workspace);
  return Boolean(ctx.currentWorkspacePath && workspacePathKey(ctx.currentWorkspacePath) === key)
    || readRecentWorkspaces(ctx).some((item) => workspacePathKey(item) === key);
}
