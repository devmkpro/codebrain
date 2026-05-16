import * as fs from "node:fs";
import type { AppContext } from "../context";

export function readRecentWorkspaces(ctx: AppContext): string[] {
  try { return JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8")); } catch { return []; }
}

export function saveRecentWorkspaces(ctx: AppContext, workspaces: string[]): void {
  try { fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8"); } catch {}
}

export function touchWorkspace(ctx: AppContext, wsPath: string): void {
  const list = readRecentWorkspaces(ctx).filter((p) => p !== wsPath);
  saveRecentWorkspaces(ctx, [wsPath, ...list].slice(0, 20));
}
