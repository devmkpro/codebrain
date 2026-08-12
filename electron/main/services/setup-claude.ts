/**
 * Auto-setup for Claude Code integration.
 *
 * Runs on every Electron startup to ensure:
 * 1. ~/.claude/helpers/statusline.cjs is up-to-date (statusline works globally)
 * 2. ~/.claude/settings.json has statusLine + codebrain sections
 * 3. ~/.mcp.json points to the stdio server (CLI mode)
 *
 * This makes Codebrain "just work" after install/update — no manual setup needed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { app } from "electron";
import log from "electron-log/main.js";
import { buildStdioServerConfig, isStdioConfigCurrent, resolveStdioEntry } from "./mcp-runtime";

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Resolve the absolute path to the MCP stdio server.
 *
 * Delegates to the shared resolver in mcp-runtime.ts so every config file
 * (~/.mcp.json, ~/.claude.json, workspace .mcp.json, .vscode/mcp.json) points
 * at the same entry point with the same runtime.
 */
function getStdioPath(): string {
  return resolveStdioEntry() ?? "";
}

/**
 * Resolve the Codebrain project root — where package.json and packages/mcp/index.js live.
 * Works in both dev mode (app.getAppPath()) and packaged mode (process.resourcesPath).
 */
function getCodebrainRoot(): string {
  if (app.isPackaged) return process.resourcesPath;
  return app.getAppPath();
}

/**
 * Get the real version from package.json (never "unknown").
 */
function getRealVersion(): string | null {
  try {
    const pkgPath = path.join(getCodebrainRoot(), "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? null;
  } catch { return null; }
}

/**
 * Get the real MCP tool count by counting `server.tool(` in packages/mcp/index.js (never 0).
 */
function getRealTotalTools(): number {
  try {
    const indexJs = path.join(getCodebrainRoot(), "packages", "mcp", "index.js");
    const src = fs.readFileSync(indexJs, "utf-8");
    return (src.match(/server\.tool\(/g) || []).length;
  } catch { return 0; }
}

/**
 * Sync version + totalTools in ~/.claude/settings.json from real project values.
 * Called on every startup and on provider change. Safe to call repeatedly.
 *
 * IMPORTANT: This is the ONLY place where global settings get the real values.
 * The bundled .claude/settings.json is committed with placeholders ("unknown"/0)
 * because version and tool count are only known at runtime. This function
 * overwrites any placeholder values with the real computed values.
 */
export function syncClaudeSettingsVersion(): void {
  try {
    const userClaudeDir = path.join(os.homedir(), ".claude");
    const settingsDest = path.join(userClaudeDir, "settings.json");
    if (!fs.existsSync(settingsDest)) return;

    const userSettings: Record<string, any> = JSON.parse(fs.readFileSync(settingsDest, "utf-8"));
    const pkgVersion = getRealVersion();
    const totalTools = getRealTotalTools();

    if (!pkgVersion && totalTools === 0) return;

    let changed = false;

    // Sync version (never accept "unknown")
    if (pkgVersion) {
      if (userSettings.codebrain && userSettings.codebrain.version !== pkgVersion) {
        userSettings.codebrain.version = pkgVersion;
        changed = true;
      }
      if (userSettings.env && userSettings.env.CODEBRAIN_VERSION !== pkgVersion) {
        userSettings.env.CODEBRAIN_VERSION = pkgVersion;
        changed = true;
      }
    }

    // Sync totalTools (never accept 0 if we can count real tools)
    if (totalTools > 0 && userSettings.codebrain) {
      if (!userSettings.codebrain.mcp) userSettings.codebrain.mcp = {};
      if (userSettings.codebrain.mcp.totalTools !== totalTools) {
        userSettings.codebrain.mcp.totalTools = totalTools;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2), "utf-8");
      log.info(`[setup-claude] Synced version ${pkgVersion}, ${totalTools} tools to ~/.claude/settings.json`);
    }
  } catch (err) {
    log.warn("[setup-claude] Version sync failed (non-fatal):", err);
  }
}

/**
 * Auto-install Claude Code config to user home.
 * Safe to call on every startup — only updates what's missing or outdated.
 */
export function setupClaudeIntegration(): void {
  try {
    const isPackaged = app.isPackaged;
    const bundledDir = isPackaged
      ? path.join(process.resourcesPath, "codebrain-claude")
      : path.resolve(__dirname, "..", "..", ".claude");

    const userClaudeDir = path.join(os.homedir(), ".claude");
    fs.mkdirSync(userClaudeDir, { recursive: true });

    // ── 0. Write ~/.mcp.json FIRST — does NOT depend on bundledDir ──
    // This MUST run on every startup regardless of whether bundledDir exists.
    // If bundledDir is missing (dev mode), we still need the correct stdio path
    // so Claude Code can connect to the MCP server.
    {
      const homeMcpPath = path.join(os.homedir(), ".mcp.json");
      const stdioServer = buildStdioServerConfig();
      const mcpConfig = JSON.stringify({ mcpServers: { codebrain: stdioServer } }, null, 2);

      // Only skip if the file already has the exact correct launch config.
      // Always overwrite stale/wrong paths — this is the #1 cause of "MCP failed".
      let shouldWrite = true;
      if (fs.existsSync(homeMcpPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(homeMcpPath, "utf-8"));
          if (isStdioConfigCurrent(existing?.mcpServers?.codebrain)) shouldWrite = false;
        } catch {
          // Invalid JSON — overwrite
        }
      }

      if (shouldWrite) {
        fs.writeFileSync(homeMcpPath, mcpConfig, "utf-8");
        log.info("[setup-claude] Wrote ~/.mcp.json with stdio transport:", stdioServer.args[0]);
      }
    }

    // ── 0.1 Fix stale MCP paths in ~/.claude.json (per-project configs) ──
    // Claude Code stores per-project mcpServers in ~/.claude.json.
    // A common bug is "resources\resources\mcp-stdio" (double "resources").
    // This scans ALL project entries and fixes any stale paths to the correct stdio.cjs.
    {
      const claudeJsonPath = path.join(os.homedir(), ".claude.json");
      if (fs.existsSync(claudeJsonPath)) {
        try {
          const stdioServer = buildStdioServerConfig();
          const parsed = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8"));
          let pathFixCount = 0;

          // Claude Code keeps per-project config under `projects`; older builds of
          // this repair loop scanned the top level and therefore fixed nothing.
          // Scan both so stale entries written by any version get repaired.
          const containers: Array<Record<string, any>> = [];
          if (parsed?.projects && typeof parsed.projects === "object") containers.push(parsed.projects);
          if (parsed && typeof parsed === "object") containers.push(parsed);

          for (const container of containers) {
            for (const projectVal of Object.values(container)) {
              if (typeof projectVal !== "object" || projectVal === null) continue;
              const entry = (projectVal as any).mcpServers?.codebrain;
              if (!entry || entry.url) continue; // leave HTTP configs alone
              if (!Array.isArray(entry.args) || typeof entry.args[0] !== "string") continue;
              // Repair when the recorded launch target no longer resolves —
              // covers the old "resources/resources/mcp-stdio" double path, an
              // uninstalled system Node, and paths left behind by an update.
              if (isStdioConfigCurrent(entry)) continue;
              if (fs.existsSync(entry.args[0]) && entry.command === stdioServer.command) continue;
              (projectVal as any).mcpServers.codebrain = { ...stdioServer };
              pathFixCount++;
            }
          }

          if (pathFixCount > 0) {
            fs.writeFileSync(claudeJsonPath, JSON.stringify(parsed, null, 2), "utf-8");
            log.info(`[setup-claude] Repaired ${pathFixCount} stale MCP entr(ies) in ~/.claude.json`);
          }
        } catch (err) {
          log.warn("[setup-claude] ~/.claude.json MCP path repair skipped (non-fatal):", err);
        }
      }
    }

    // ── Steps 1-3 depend on bundledDir (helpers, skills, settings) ──
    if (!fs.existsSync(bundledDir)) {
      log.info("[setup-claude] Bundled .claude dir not found, skipping helper/skill sync");
      return;
    }

    // ── 1. Copy dirs: skills, helpers, agents, commands, config ──
    const dirsToCopy = ["skills", "helpers", "agents", "commands", "config"];
    for (const dirName of dirsToCopy) {
      const srcDir = path.join(bundledDir, dirName);
      if (!fs.existsSync(srcDir)) continue;
      const destDir = path.join(userClaudeDir, dirName);
      copyDirRecursive(srcDir, destDir);
    }

    // ── 2. Append CLAUDE.md if not already present ──
    const claudeMdSrc = path.join(bundledDir, "CLAUDE.md");
    const claudeMdDest = path.join(userClaudeDir, "CLAUDE.md");
    if (fs.existsSync(claudeMdSrc)) {
      const srcContent = fs.readFileSync(claudeMdSrc, "utf-8");
      if (fs.existsSync(claudeMdDest)) {
        const existing = fs.readFileSync(claudeMdDest, "utf-8");
        if (!existing.includes("Codebrain")) {
          fs.appendFileSync(claudeMdDest, "\n\n" + srcContent, "utf-8");
        }
      } else {
        fs.writeFileSync(claudeMdDest, srcContent, "utf-8");
      }
    }

    // ── 3. Merge statusLine + codebrain into ~/.claude/settings.json ──
    const settingsSrc = path.join(bundledDir, "settings.json");
    const settingsDest = path.join(userClaudeDir, "settings.json");
    if (fs.existsSync(settingsSrc)) {
      const bundledSettings = JSON.parse(fs.readFileSync(settingsSrc, "utf-8"));
      let userSettings: Record<string, unknown> = {};
      try {
        userSettings = JSON.parse(fs.readFileSync(settingsDest, "utf-8"));
      } catch {
        // No existing settings or invalid JSON — start fresh
      }

      let changed = false;

      // Always update statusLine to get latest fallback logic
      if (bundledSettings.statusLine) {
        userSettings.statusLine = bundledSettings.statusLine;
        changed = true;
      }

      // Always sync codebrain section — version + totalTools from REAL values
      // IMPORTANT: NEVER spread bundledSettings.codebrain as-is because it contains
      // placeholder values ("unknown"/0) that are committed to the repo. Always
      // compute from package.json and index.js at runtime.
      {
        const pkgVersion = getRealVersion();
        const totalTools = getRealTotalTools();

        if (!userSettings.codebrain) {
          // Create fresh codebrain section with REAL values (not bundled placeholders)
          userSettings.codebrain = {
            version: pkgVersion || "unknown",
            mcp: { totalTools: totalTools || 0 },
          };
          changed = true;
        } else {
          // Update existing — only overwrite if current value is a placeholder
          const cb = userSettings.codebrain as any;
          if (pkgVersion && (cb.version === "unknown" || !cb.version || cb.version !== pkgVersion)) {
            cb.version = pkgVersion;
            changed = true;
          }
          if (!cb.mcp) cb.mcp = {};
          if (totalTools > 0 && (cb.mcp.totalTools === 0 || !cb.mcp.totalTools)) {
            cb.mcp.totalTools = totalTools;
            changed = true;
          }
        }
      }

      // Always sync CODEBRAIN_VERSION env var from package.json (never "unknown")
      {
        const pkgVersion = getRealVersion();
        if (pkgVersion) {
          if (!userSettings.env) userSettings.env = {};
          if ((userSettings.env as any).CODEBRAIN_VERSION !== pkgVersion) {
            (userSettings.env as any).CODEBRAIN_VERSION = pkgVersion;
            changed = true;
          }
        }
      }

      if (changed) {
        fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2), "utf-8");
      }
    }

    log.info("[setup-claude] Claude Code integration setup complete");
  } catch (err) {
    log.warn("[setup-claude] Setup failed (non-fatal):", err);
  }
}
