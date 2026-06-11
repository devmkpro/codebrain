import { ipcMain, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AppContext } from "../context";
import { readRecentWorkspaces, saveRecentWorkspaces, touchWorkspace, writeContextFiles } from "../services/workspace";

/** Directories that indicate a project root */
const PROJECT_MARKERS = [
  "package.json", ".git", "pyproject.toml", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "Makefile",
  ".codebrain", "tsconfig.json", "composer.json",
];

/**
 * Walk up from `dir` looking for a project marker.
 * Returns the project root path, or null if none found.
 */
function detectProjectRoot(dir: string): string | null {
  let current = dir;
  const root = path.parse(current).root;
  while (current !== root) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    current = path.dirname(current);
  }
  return null;
}

export function registerWorkspaceHandlers(ctx: AppContext): void {
  /**
   * Detect and auto-register a workspace at the given path (or cwd).
   * Walks up looking for project markers, auto-registers the most recent
   * workspace if none found, or falls back to cwd.
   */
  ipcMain.handle("workspace:detect", async (_event, dir?: string) => {
    const targetDir = dir ?? process.cwd();

    // 1. Try to find a project root by walking up from targetDir
    const projectRoot = detectProjectRoot(targetDir);
    if (projectRoot) {
      return { path: projectRoot, autoDetected: true };
    }

    // 2. If no project markers found, check recent workspaces
    const recents = readRecentWorkspaces(ctx);
    if (recents.length > 0 && fs.existsSync(recents[0])) {
      return { path: recents[0], autoDetected: false, fromRecent: true };
    }

    // 3. Fall back to cwd itself
    return { path: targetDir, autoDetected: false, fallback: true };
  });

  ipcMain.handle("workspace:open", async () => {
    if (!ctx.mainWindow) return null;
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      properties: ["openDirectory"],
      title: "Open Workspace",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const wsPath = result.filePaths[0];
    ctx.currentWorkspacePath = wsPath;
    touchWorkspace(ctx, wsPath);
    writeContextFiles(ctx, wsPath);
    return wsPath;
  });

  ipcMain.handle("workspace:set", async (_event, dir: string) => {
    ctx.currentWorkspacePath = dir;
    touchWorkspace(ctx, dir);
    writeContextFiles(ctx, dir);
  });

  ipcMain.handle("workspace:save", async (_event, _config: Record<string, unknown>) => {});

  ipcMain.handle("workspaces:recent", async () => readRecentWorkspaces(ctx));
  ipcMain.handle("workspaces:touch", async (_event, wsPath: string) => touchWorkspace(ctx, wsPath));
  ipcMain.handle("workspaces:remove", async (_event, wsPath: string) => {
    const list = readRecentWorkspaces(ctx).filter((p) => p !== wsPath);
    saveRecentWorkspaces(ctx, list);
  });

  ipcMain.handle("workspace:scan", async (_event, wsPath: string) => {
    try {
      const entries = fs.readdirSync(wsPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(wsPath, e.name),
        isDirectory: e.isDirectory(),
        extension: e.isFile() ? path.extname(e.name) : undefined,
      }));
    } catch { return []; }
  });

  ipcMain.handle("files:list", async (_event, wsPath: string, subPath = "") => {
    try {
      const dir = subPath ? path.join(wsPath, subPath) : wsPath;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
        isDirectory: e.isDirectory(),
        extension: e.isFile() ? path.extname(e.name) : undefined,
      }));
    } catch { return []; }
  });

  ipcMain.handle("files:read", async (_event, wsPath: string, relPath: string) => {
    return fs.readFileSync(path.join(wsPath, relPath), "utf-8");
  });

  ipcMain.handle("files:write", async (_event, wsPath: string, relPath: string, content: string) => {
    const full = path.join(wsPath, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  });

  ipcMain.handle("files:saveDropped", async (_event, name: string, bytes: ArrayBuffer) => {
    const dest = path.join(os.tmpdir(), name);
    fs.writeFileSync(dest, Buffer.from(bytes));
    return dest;
  });

  ipcMain.handle("workspaceConfig:get", (_event, wsPath: string) => ctx.workspaceConfigStore.get(wsPath));
  ipcMain.handle("workspaceConfig:set", (_event, wsPath: string, cfg: Record<string, unknown>) => {
    ctx.workspaceConfigStore.set(wsPath, cfg);
  });
  ipcMain.handle("appConfig:get", () => ctx.configStore.get());
  ipcMain.handle("appConfig:set", (_event, patch: Record<string, unknown>) => {
    ctx.configStore.set(patch);
  });
}
