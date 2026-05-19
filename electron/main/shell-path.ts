/**
 * Shell PATH Enrichment
 *
 * When Electron is launched from a GUI shortcut on Linux/macOS,
 * process.env.PATH is minimal (e.g. /usr/bin:/bin). This module
 * reads the real PATH from the user's shell profile and merges it
 * into process.env so that PTY children and spawned agents can find
 * binaries like node, openclaude, etc.
 */
import { execSync } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import log from "electron-log/main.js";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

/**
 * Merge two PATH strings, deduplicating entries.
 * Entries from `priority` come first, then unique entries from `fallback`.
 */
function mergePaths(priority: string, fallback: string, sep: string): string {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of [...priority.split(sep), ...fallback.split(sep)]) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result.join(sep);
}

/**
 * Check if the current PATH looks suspiciously short (GUI-launched Electron).
 * A normal terminal PATH on Linux has 10+ entries; a GUI PATH has ~2-4.
 */
function isPathDepleted(pathValue: string, sep: string): boolean {
  const entries = pathValue.split(sep).filter(Boolean);
  return entries.length < 8;
}

/**
 * Enrich process.env.PATH by reading the user's shell profile.
 * Safe to call multiple times (idempotent).
 * On Windows this is a no-op (Windows GUI apps inherit the full PATH).
 */
export function enrichShellPath(): void {
  if (IS_WIN) return;

  const sep = ":";
  const currentPath = process.env.PATH ?? "";

  // Always try to enrich — even if PATH looks "ok", NVM/FNM paths might be missing
  try {
    const home = os.homedir();
    const shell = process.env.SHELL || (IS_MAC ? "/bin/zsh" : "/bin/bash");

    // Try shell profile sourcing first (handles NVM, FNM, volta, etc.)
    let shellPath = "";
    try {
      // -l = login shell (sources .profile/.bash_profile/.zprofile)
      // -c = run command
      // This is the most reliable way to get the full PATH
      const cmd = `${shell} -lc 'echo \$PATH'`;
      shellPath = execSync(cmd, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    } catch (e) {
      log.debug("[shell-path] shell profile read failed:", e instanceof Error ? e.message : String(e));
    }

    if (shellPath && shellPath.length > currentPath.length) {
      const enriched = mergePaths(shellPath, currentPath, sep);
      if (enriched !== currentPath) {
        process.env.PATH = enriched;
        log.info(
          `[shell-path] Enriched PATH from ${currentPath.split(sep).length} → ${enriched.split(sep).length} entries`,
        );
      }
      return;
    }

    // Fallback: add common NVM/FNM/version-manager paths manually
    const extraPaths: string[] = [];

    // NVM
    const nvmDir = process.env.NVM_DIR || `${home}/.nvm`;
    if (fs.existsSync(nvmDir)) {
      // Find the default/active node version
      try {
        const versionsDir = `${nvmDir}/versions/node`;
        if (fs.existsSync(versionsDir)) {
          const versions = fs.readdirSync(versionsDir).sort().reverse();
          if (versions.length > 0) {
            extraPaths.push(`${versionsDir}/${versions[0]}/bin`);
          }
        }
      } catch {}
    }

    // FNM
    const fnmDir = `${home}/.local/share/fnm`;
    if (fs.existsSync(fnmDir)) {
      try {
        const multishells = `${fnmDir}/multishells`;
        if (fs.existsSync(multishells)) {
          const shells = fs.readdirSync(multishells).sort().reverse();
          for (const s of shells.slice(0, 3)) {
            const binDir = `${multishells}/${s}`;
            if (fs.existsSync(`${binDir}/node`)) {
              extraPaths.push(binDir);
              break;
            }
          }
        }
      } catch {}
      // FNM default location
      extraPaths.push(`${home}/.local/share/fnm`);
    }

    // Volta
    const voltaHome = process.env.VOLTA_HOME || `${home}/.volta`;
    if (fs.existsSync(`${voltaHome}/bin`)) {
      extraPaths.push(`${voltaHome}/bin`);
    }

    // pnpm global
    const pnpmHome = process.env.PNPM_HOME || `${home}/.local/share/pnpm`;
    if (fs.existsSync(pnpmHome)) {
      extraPaths.push(pnpmHome);
    }

    // Common bin dirs
    const commonDirs = [
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.bun/bin`,
      "/usr/local/bin",
      "/opt/homebrew/bin",
    ];
    for (const d of commonDirs) {
      if (fs.existsSync(d)) extraPaths.push(d);
    }

    if (extraPaths.length > 0) {
      const enriched = mergePaths(extraPaths.join(sep), currentPath, sep);
      if (enriched !== currentPath) {
        process.env.PATH = enriched;
        log.info(
          `[shell-path] Enriched PATH with ${extraPaths.length} fallback dirs: ${currentPath.split(sep).length} → ${enriched.split(sep).length} entries`,
        );
      }
    }
  } catch (err) {
    log.warn("[shell-path] PATH enrichment failed:", err instanceof Error ? err.message : String(err));
  }
}
