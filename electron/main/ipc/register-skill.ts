import { ipcMain, app, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AppContext } from "../context";

const SKILLS_DIR = path.join(os.homedir(), ".codebrain", "skills");
const CLAUDE_CONFIG_DIR = path.join(os.homedir(), ".codebrain", ".claude");
const REGISTRY_URL = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main/index.json";
const REGISTRY_BASE = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main";

// ── Skill manifest interface ──

interface SkillManifest {
  id: string;
  name: string;
  type: "prompt" | "squad";
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  entrypoint: string;
  tools?: string[];
}

interface SkillEntry {
  manifest: SkillManifest;
  path: string;
  installedAt?: string;
}

// ── Helpers ──

function ensureSkillsDir(): void {
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

function readManifest(skillDir: string): SkillManifest | null {
  const manifestPath = path.join(skillDir, "skill.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

function readEntrypoint(skillDir: string, entrypoint: string): string | null {
  try {
    return fs.readFileSync(path.join(skillDir, entrypoint), "utf-8");
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

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

// ── Registration ──

export function registerSkillHandlers(_ctx: AppContext): void {

  // Keep legacy handlers for backward compat
  ipcMain.handle("skill:status", async () => {
    const skillDir = path.join(os.homedir(), ".claude", "skills", "codebrain-skill");
    return { installed: fs.existsSync(skillDir) };
  });

  ipcMain.handle("skill:openFolder", async () => {
    ensureSkillsDir();
    shell.openPath(SKILLS_DIR);
  });

  ipcMain.handle("skill:installCodebrain", async () => {
    const skillsDir = path.join(os.homedir(), ".claude", "skills");
    const skillDir = path.join(skillsDir, "codebrain-skill");
    try {
      fs.mkdirSync(skillsDir, { recursive: true });
      const isPackaged = app.isPackaged;
      const bundledSkillDir = isPackaged
        ? path.join(process.resourcesPath, "codebrain-skill")
        : path.join(__dirname, "..", "..", "resources", "codebrain-skill");
      if (!fs.existsSync(bundledSkillDir)) {
        return { ok: false, error: `Skill files not found at ${bundledSkillDir}` };
      }
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      fs.mkdirSync(skillDir, { recursive: true });
      for (const file of fs.readdirSync(bundledSkillDir)) {
        fs.copyFileSync(path.join(bundledSkillDir, file), path.join(skillDir, file));
      }
      return { ok: true, action: "instalado", path: skillDir };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:uninstallCodebrain", async () => {
    const skillDir = path.join(os.homedir(), ".claude", "skills", "codebrain-skill");
    try {
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── New: Skill Repository handlers ──

  ipcMain.handle("skill:listInstalled", async (_evt, args?: { type?: string }) => {
    ensureSkillsDir();
    try {
      const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
          const skillDir = path.join(SKILLS_DIR, d.name);
          const manifest = readManifest(skillDir);
          return manifest ? { manifest, path: skillDir } : null;
        })
        .filter((e): e is SkillEntry => e !== null);

      if (args?.type) {
        return entries.filter(e => e.manifest.type === args.type);
      }
      return entries;
    } catch {
      return [];
    }
  });

  ipcMain.handle("skill:get", async (_evt, args: { id: string }) => {
    const skillDir = path.join(SKILLS_DIR, args.id);
    if (!fs.existsSync(skillDir)) return { ok: false, error: `Skill '${args.id}' not found` };
    const manifest = readManifest(skillDir);
    if (!manifest) return { ok: false, error: `Invalid skill: missing skill.json` };

    const content: Record<string, string> = {};
    try {
      const files = fs.readdirSync(skillDir);
      for (const f of files) {
        if (f.endsWith(".md") || f.endsWith(".json")) {
          content[f] = fs.readFileSync(path.join(skillDir, f), "utf-8");
        }
      }
    } catch {}

    return { ok: true, manifest, content };
  });

  ipcMain.handle("skill:installFromRegistry", async (_evt, args: { id: string }) => {
    try {
      ensureSkillsDir();
      const skillDir = path.join(SKILLS_DIR, args.id);

      // Fetch manifest from registry
      const manifestUrl = `${REGISTRY_BASE}/skills/${args.id}/skill.json`;
      const manifest = await fetchJson(manifestUrl) as SkillManifest;

      // Create skill directory
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      fs.mkdirSync(skillDir, { recursive: true });

      // Save manifest
      fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));

      // Fetch and save entrypoint
      const entryUrl = `${REGISTRY_BASE}/skills/${args.id}/${manifest.entrypoint}`;
      const entryContent = await fetchText(entryUrl);
      fs.writeFileSync(path.join(skillDir, manifest.entrypoint), entryContent);

      // If squad type, also fetch squad.json
      if (manifest.type === "squad" && manifest.entrypoint !== "squad.json") {
        try {
          const squadUrl = `${REGISTRY_BASE}/skills/${args.id}/squad.json`;
          const squadContent = await fetchText(squadUrl);
          fs.writeFileSync(path.join(skillDir, "squad.json"), squadContent);
        } catch {}
      }

      // Fetch README if available
      try {
        const readmeUrl = `${REGISTRY_BASE}/skills/${args.id}/README.md`;
        const readme = await fetchText(readmeUrl);
        fs.writeFileSync(path.join(skillDir, "README.md"), readme);
      } catch {}

      return { ok: true, manifest };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:uninstall", async (_evt, args: { id: string }) => {
    const skillDir = path.join(SKILLS_DIR, args.id);
    try {
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:sync", async (_evt, args: { direction: "pull" | "push" }) => {
    try {
      if (args.direction === "pull") {
        // Fetch index from registry
        const index = await fetchJson(REGISTRY_URL) as { skills: Array<{ id: string; version: string }> };
        const results: Array<{ id: string; action: string; version?: string }> = [];

        for (const entry of index.skills) {
          const skillDir = path.join(SKILLS_DIR, entry.id);
          const localManifest = readManifest(skillDir);

          // Install if missing or outdated
          if (!localManifest || localManifest.version !== entry.version) {
            const installResult = await (async () => {
              try {
                const manifestUrl = `${REGISTRY_BASE}/skills/${entry.id}/skill.json`;
                const manifest = await fetchJson(manifestUrl) as SkillManifest;
                if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));
                const entryUrl = `${REGISTRY_BASE}/skills/${entry.id}/${manifest.entrypoint}`;
                fs.writeFileSync(path.join(skillDir, manifest.entrypoint), await fetchText(entryUrl));
                if (manifest.type === "squad") {
                  try {
                    fs.writeFileSync(path.join(skillDir, "squad.json"), await fetchText(`${REGISTRY_BASE}/skills/${entry.id}/squad.json`));
                  } catch {}
                }
                try {
                  fs.writeFileSync(path.join(skillDir, "README.md"), await fetchText(`${REGISTRY_BASE}/skills/${entry.id}/README.md`));
                } catch {}
                return { ok: true };
              } catch (err: any) {
                return { ok: false, error: err?.message };
              }
            })();

            results.push({
              id: entry.id,
              action: localManifest ? "updated" : "installed",
              version: entry.version,
            });
          }
        }

        return { ok: true, results };
      }

      // Push: not implemented yet (requires GitLab API token)
      return { ok: false, error: "Push not yet implemented. Use GitLab web UI to publish skills." };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:registryIndex", async () => {
    try {
      const index = await fetchJson(REGISTRY_URL);
      return { ok: true, index };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Claude Config handlers (.claude/ directory) ──

  ipcMain.handle("skill:claudeConfigStatus", async () => {
    return { installed: fs.existsSync(CLAUDE_CONFIG_DIR) };
  });

  ipcMain.handle("skill:installClaudeConfig", async () => {
    try {
      const isPackaged = app.isPackaged;
      const bundledDir = isPackaged
        ? path.join(process.resourcesPath, "codebrain-claude")
        : path.join(__dirname, "..", "..", ".claude");

      if (!fs.existsSync(bundledDir)) {
        return { ok: false, error: `Claude config not found at ${bundledDir}` };
      }

      // Install to ~/.claude/ (user-level) so Claude Code CLI detects it globally.
      // We only copy: skills/, helpers/, agents/, commands/, config/
      // We do NOT overwrite ~/.claude/settings.json or ~/.claude/CLAUDE.md
      // to preserve user's existing Claude Code configuration.
      const userClaudeDir = path.join(os.homedir(), ".claude");
      const dirsToCopy = ["skills", "helpers", "agents", "commands", "config"];
      const filesToAppend = ["CLAUDE.md"];

      // Copy directories
      for (const dirName of dirsToCopy) {
        const srcDir = path.join(bundledDir, dirName);
        if (!fs.existsSync(srcDir)) continue;
        const destDir = path.join(userClaudeDir, dirName);
        copyDirRecursive(srcDir, destDir);
      }

      // Append CLAUDE.md content if it doesn't already contain Codebrain info
      for (const fileName of filesToAppend) {
        const srcFile = path.join(bundledDir, fileName);
        const destFile = path.join(userClaudeDir, fileName);
        if (!fs.existsSync(srcFile)) continue;
        const srcContent = fs.readFileSync(srcFile, "utf-8");
        if (fs.existsSync(destFile)) {
          const existing = fs.readFileSync(destFile, "utf-8");
          if (!existing.includes("Codebrain")) {
            fs.appendFileSync(destFile, "\n\n" + srcContent, "utf-8");
          }
        } else {
          fs.writeFileSync(destFile, srcContent, "utf-8");
        }
      }

      // Merge statusLine into user settings.json (don't overwrite)
      const settingsSrc = path.join(bundledDir, "settings.json");
      const settingsDest = path.join(userClaudeDir, "settings.json");
      if (fs.existsSync(settingsSrc)) {
        const bundledSettings = JSON.parse(fs.readFileSync(settingsSrc, "utf-8"));
        let userSettings: Record<string, unknown> = {};
        try { userSettings = JSON.parse(fs.readFileSync(settingsDest, "utf-8")); } catch {}
        // Add statusLine if not present
        if (!userSettings.statusLine && bundledSettings.statusLine) {
          userSettings.statusLine = bundledSettings.statusLine;
        }
        // Add codebrain section if not present
        if (!userSettings.codebrain && bundledSettings.codebrain) {
          userSettings.codebrain = bundledSettings.codebrain;
        }
        fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2), "utf-8");
      }

      return { ok: true, path: userClaudeDir };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:uninstallClaudeConfig", async () => {
    try {
      if (fs.existsSync(CLAUDE_CONFIG_DIR)) {
        fs.rmSync(CLAUDE_CONFIG_DIR, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("skill:openClaudeConfigFolder", async () => {
    if (!fs.existsSync(CLAUDE_CONFIG_DIR)) fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
    shell.openPath(CLAUDE_CONFIG_DIR);
  });
}
