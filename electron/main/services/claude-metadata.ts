import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import log from "electron-log/main.js";

/** Installed metadata only: no MCP runtime import, cwd or bundle-relative paths.
 * Electron reads app.asar transparently; resourcesPath contains extraResources,
 * not the app's package.json/packages. Shared by global and pane settings. */
export function readCodebrainMetadata(): { version: string | null; totalTools: number } {
  const roots: string[] = [];
  try { roots.push(app.getAppPath()); } catch {}
  if (process.resourcesPath) roots.push(
    path.join(process.resourcesPath, "app.asar"),
    path.join(process.resourcesPath, "app.asar.unpacked"),
    process.resourcesPath,
  );
  const validVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(value);
  let version: string | null = null;
  let totalTools = 0;
  for (const root of new Set(roots.filter(Boolean))) {
    if (!version) try {
      const value = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
      if (validVersion(value)) version = value;
    } catch {}
    if (!totalTools) try {
      const source = fs.readFileSync(path.join(root, "packages", "mcp", "index.js"), "utf-8");
      totalTools = (source.match(/server\s*\.\s*tool\s*\(/g) || []).length;
    } catch {}
    if (version && totalTools) break;
  }
  if (!version) try { const value = app.getVersion?.(); if (validVersion(value)) version = value; } catch {}
  return { version, totalTools };
}

/** Preserve user/nested settings; never replace known values with placeholders. */
export function ensureClaudeWorkspaceSettings(cwd: string): void {
  try {
    const { version, totalTools } = readCodebrainMetadata();
    if (!version && !totalTools) return;
    const settingsDir = path.join(cwd, ".claude");
    const settingsPath = path.join(settingsDir, "settings.json");
    let existing: Record<string, any> = {};
    let current = "";
    try { current = fs.readFileSync(settingsPath, "utf-8"); existing = JSON.parse(current); } catch {}
    const merged = {
      ...existing,
      ...(version ? { env: { ...(existing.env ?? {}), CODEBRAIN_VERSION: version } } : {}),
      codebrain: {
        ...(existing.codebrain ?? {}),
        ...(version ? { version } : {}),
        ...(totalTools > 0 ? { mcp: { ...(existing.codebrain?.mcp ?? {}), totalTools } } : {}),
      },
    };
    const content = JSON.stringify(merged, null, 2);
    if (content === current) return;
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, content, "utf-8");
    log.info(`[ensureClaudeSettings] Synced .claude/settings.json to ${cwd} (v${version ?? "unavailable"}, ${totalTools} tools)`);
  } catch (err) { log.warn("[ensureClaudeSettings] Failed to sync settings:", err); }
}
