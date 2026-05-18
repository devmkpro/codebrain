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
  // Dev mode — prefer the bundle if it exists
  const bundledPath = path.resolve(__dirname, "..", "..", "..", "resources", "mcp-stdio", "stdio.cjs");
  if (fs.existsSync(bundledPath)) return bundledPath;
  // Dev fallback — direct source
  return path.resolve(__dirname, "..", "..", "..", "packages", "mcp", "stdio.js");
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

    if (!fs.existsSync(bundledDir)) {
      log.info("[setup-claude] Bundled .claude dir not found, skipping setup");
      return;
    }

    const userClaudeDir = path.join(os.homedir(), ".claude");
    fs.mkdirSync(userClaudeDir, { recursive: true });

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

      // Add codebrain section if not present
      if (!userSettings.codebrain && bundledSettings.codebrain) {
        userSettings.codebrain = bundledSettings.codebrain;
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2), "utf-8");
      }
    }

    // ── 4. Write ~/.mcp.json for Claude Code CLI (stdio transport) ──
    const homeMcpPath = path.join(os.homedir(), ".mcp.json");
    const stdioPath = getStdioPath();

    // Escape backslashes for JSON on Windows
    const escapedStdioPath = stdioPath.replace(/\\/g, "\\\\");
    const mcpConfig = JSON.stringify({
      mcpServers: {
        codebrain: {
          command: "node",
          args: [stdioPath],
        },
      },
    }, null, 2);

    // Only write if missing or different (avoid overwriting user customizations)
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
      log.info("[setup-claude] Wrote ~/.mcp.json with stdio transport");
    }

    log.info("[setup-claude] Claude Code integration setup complete");
  } catch (err) {
    log.warn("[setup-claude] Setup failed (non-fatal):", err);
  }
}
