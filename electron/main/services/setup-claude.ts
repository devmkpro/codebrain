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
 * In packaged mode: <install>/resources/mcp-stdio/stdio.cjs
 *   (bundled standalone file outside app.asar — Node.js can load it)
 *
 * In dev mode: <project>/resources/mcp-stdio/stdio.cjs
 *   (created by `npm run bundle:stdio`)
 *
 * Fallback (dev without bundle): <project>/packages/mcp/stdio.js
 */
function getStdioPath(): string {
  if (app.isPackaged) {
    // Primary: bundled standalone file outside app.asar
    const bundledPath = path.join(process.resourcesPath, "mcp-stdio", "stdio.cjs");
    if (fs.existsSync(bundledPath)) return bundledPath;
    // Fallback: unpacked native modules dir (in case user hasn't rebuilt yet)
    const unpackedPath = path.join(process.resourcesPath, "app.asar.unpacked", "packages", "mcp", "stdio.js");
    if (fs.existsSync(unpackedPath)) return unpackedPath;
    // Last resort: resolve from project source (works if user has dev checkout)
    const homeDir = os.homedir();
    const devCheckout = path.join(homeDir, "Desktop", "codebrain", "resources", "mcp-stdio", "stdio.cjs");
    if (fs.existsSync(devCheckout)) return devCheckout;
    const devSource = path.join(homeDir, "Desktop", "codebrain", "packages", "mcp", "stdio.js");
    if (fs.existsSync(devSource)) return devSource;
    // Return the bundled path anyway — will fail with a clear error
    return bundledPath;
  }
  // Dev mode — use app.getAppPath() which returns the actual project root.
  // __dirname is unreliable in dev (electron-vite may resolve it differently).
  const projectRoot = app.getAppPath();
  const bundledPath = path.join(projectRoot, "resources", "mcp-stdio", "stdio.cjs");
  if (fs.existsSync(bundledPath)) return bundledPath;
  // Dev fallback — direct source (only if it actually exists)
  const sourcePath = path.join(projectRoot, "packages", "mcp", "stdio.js");
  if (fs.existsSync(sourcePath)) return sourcePath;
  // Neither exists — return bundled path anyway (will fail with a clear error)
  return bundledPath;
}

/**
 * Lightweight version sync — only updates codebrain.version and env.CODEBRAIN_VERSION
 * in ~/.claude/settings.json from package.json. Safe to call on every provider change.
 */
export function syncClaudeSettingsVersion(): void {
  try {
    const userClaudeDir = path.join(os.homedir(), ".claude");
    const settingsDest = path.join(userClaudeDir, "settings.json");
    if (!fs.existsSync(settingsDest)) return;

    const userSettings: Record<string, unknown> = JSON.parse(fs.readFileSync(settingsDest, "utf-8"));
    const pkgPath = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "package.json")
      : path.resolve(__dirname, "..", "..", "..", "package.json");
    const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    if (!pkgVersion) return;

    let changed = false;
    if (userSettings.codebrain && (userSettings.codebrain as any).version !== pkgVersion) {
      (userSettings.codebrain as any).version = pkgVersion;
      changed = true;
    }
    if (userSettings.env && (userSettings.env as any).CODEBRAIN_VERSION !== pkgVersion) {
      (userSettings.env as any).CODEBRAIN_VERSION = pkgVersion;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2), "utf-8");
      log.info(`[setup-claude] Synced version ${pkgVersion} to ~/.claude/settings.json`);
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
      const stdioPath = getStdioPath();
      const mcpConfig = JSON.stringify({
        mcpServers: {
          codebrain: {
            command: "node",
            args: [stdioPath],
          },
        },
      }, null, 2);

      // Only skip if the file already has the exact correct path.
      // Always overwrite stale/wrong paths — this is the #1 cause of "MCP failed".
      let shouldWrite = true;
      if (fs.existsSync(homeMcpPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(homeMcpPath, "utf-8"));
          const existingArgs = existing?.mcpServers?.codebrain?.args;
          if (Array.isArray(existingArgs) && existingArgs[0] === stdioPath) {
            shouldWrite = false;
          }
        } catch {
          // Invalid JSON — overwrite
        }
      }

      if (shouldWrite) {
        fs.writeFileSync(homeMcpPath, mcpConfig, "utf-8");
        log.info("[setup-claude] Wrote ~/.mcp.json with stdio transport:", stdioPath);
      }
    }

    // ── 0.1 Fix stale MCP paths in ~/.claude.json (per-project configs) ──
    // Claude Code stores per-project mcpServers in ~/.claude.json.
    // A common bug is "resources\resources\mcp-stdio" (double "resources").
    // This scans ALL project entries and fixes any stale paths to the correct stdio.cjs.
    {
      const stdioPath = getStdioPath();
      const claudeJsonPath = path.join(os.homedir(), ".claude.json");
      if (fs.existsSync(claudeJsonPath)) {
        try {
          const raw = fs.readFileSync(claudeJsonPath, "utf-8");
          // Detect the known-broken pattern: resources\resources\mcp-stdio
          const wrongPattern = String.raw`resources\resources\mcp-stdio`;
          const correctPattern = String.raw`resources\mcp-stdio`;
          if (raw.includes(wrongPattern)) {
            const fixed = raw.split(wrongPattern).join(correctPattern);
            fs.writeFileSync(claudeJsonPath, fixed, "utf-8");
            const count = raw.split(wrongPattern).length - 1;
            log.info(`[setup-claude] Fixed ${count} stale MCP path(s) in ~/.claude.json`);
          }

          // Also scan for any codebrain mcpServers args that don't match the current stdio path
          const parsed = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8"));
          let pathFixCount = 0;
          for (const [projectKey, projectVal] of Object.entries(parsed)) {
            if (typeof projectVal !== "object" || projectVal === null) continue;
            const servers = (projectVal as any).mcpServers;
            if (!servers?.codebrain) continue;
            const args = servers.codebrain.args;
            if (!Array.isArray(args) || args.length === 0) continue;
            // Only fix stdio-based configs (not streamable-http)
            if (servers.codebrain.command !== "node") continue;
            if (args[0] !== stdioPath && typeof args[0] === "string") {
              // Check if the path simply doesn't exist but stdioPath does
              if (!fs.existsSync(args[0]) && fs.existsSync(stdioPath)) {
                args[0] = stdioPath;
                pathFixCount++;
              }
            }
          }
          if (pathFixCount > 0) {
            fs.writeFileSync(claudeJsonPath, JSON.stringify(parsed, null, 2), "utf-8");
            log.info(`[setup-claude] Fixed ${pathFixCount} non-existent MCP path(s) in ~/.claude.json`);
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

      // Always sync codebrain section version from package.json
      if (bundledSettings.codebrain) {
        const pkgVersion = (() => {
          try {
            const pkgPath = isPackaged
              ? path.join(process.resourcesPath, "app.asar", "package.json")
              : path.resolve(__dirname, "..", "..", "..", "package.json");
            return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? bundledSettings.codebrain.version;
          } catch { return bundledSettings.codebrain.version; }
        })();

        if (!userSettings.codebrain) {
          userSettings.codebrain = { ...bundledSettings.codebrain, version: pkgVersion };
          changed = true;
        } else if ((userSettings.codebrain as any).version !== pkgVersion) {
          (userSettings.codebrain as any).version = pkgVersion;
          changed = true;
        }
      }

      // Always sync CODEBRAIN_VERSION env var from package.json
      if (bundledSettings.env) {
        const pkgVersion = (() => {
          try {
            const pkgPath = isPackaged
              ? path.join(process.resourcesPath, "app.asar", "package.json")
              : path.resolve(__dirname, "..", "..", "..", "package.json");
            return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? bundledSettings.env.CODEBRAIN_VERSION;
          } catch { return bundledSettings.env.CODEBRAIN_VERSION; }
        })();

        if (!userSettings.env) userSettings.env = {};
        if ((userSettings.env as any).CODEBRAIN_VERSION !== pkgVersion) {
          (userSettings.env as any).CODEBRAIN_VERSION = pkgVersion;
          changed = true;
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
