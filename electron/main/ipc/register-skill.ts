import { ipcMain, app, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AppContext } from "../context";
import { setupClaudeIntegration } from "../services/setup-claude";

const SKILLS_DIR = path.join(os.homedir(), ".codebrain", "skills");
const CLAUDE_CONFIG_DIR = path.join(os.homedir(), ".codebrain", ".claude");
// Use GitLab API (bypasses Cloudflare challenge on raw URLs)
const GITLAB_PROJECT = "maikeofc18%2Fcodebrain-skills";
const REGISTRY_URL = `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT}/repository/files/index.json/raw?ref=main`;
const REGISTRY_BASE_API = `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT}/repository/files`;
// Fallback raw URLs (may be blocked by Cloudflare)
const REGISTRY_URL_RAW = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main/index.json";
const REGISTRY_BASE_RAW = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main";

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

const FETCH_HEADERS = {
  "User-Agent": "Codebrain/1.10.3",
  "Accept": "application/json",
};

/** Build GitLab API URL for a file in the skills repo */
function skillFileUrl(skillId: string, filename: string): string {
  return `${REGISTRY_BASE_API}/skills%2F${encodeURIComponent(skillId)}%2F${encodeURIComponent(filename)}?ref=main`;
}

async function fetchJson(url: string): Promise<any> {
  // Try API URL first, then raw fallback
  const urls = url.includes("/api/v4/") ? [url, url.replace(REGISTRY_BASE_API, REGISTRY_BASE_RAW).replace(/\?.*$/, "")] : [url];
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: FETCH_HEADERS });
      if (!res.ok) continue;
      const text = await res.text();
      // Check for Cloudflare challenge page
      if (text.includes("challenge-platform") || text.includes("Just a moment")) continue;
      return JSON.parse(text);
    } catch { /* try next */ }
  }
  throw new Error(`Failed to fetch: ${url}`);
}

async function fetchText(url: string): Promise<string> {
  const urls = url.includes("/api/v4/") ? [url, url.replace(REGISTRY_BASE_API, REGISTRY_BASE_RAW).replace(/\?.*$/, "")] : [url];
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: FETCH_HEADERS });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("challenge-platform") || text.includes("Just a moment")) continue;
      return text;
    } catch { /* try next */ }
  }
  throw new Error(`Failed to fetch: ${url}`);
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

  // Legacy alias: SettingsModal calls skill:list
  ipcMain.handle("skill:list", async () => {
    ensureSkillsDir();
    try {
      return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      return [];
    }
  });

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
      const manifestUrl = skillFileUrl(args.id, 'skill.json');
      const manifest = await fetchJson(manifestUrl) as SkillManifest;

      // Create skill directory
      if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
      fs.mkdirSync(skillDir, { recursive: true });

      // Save manifest
      fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));

      // Fetch and save entrypoint
      const entryUrl = skillFileUrl(args.id, manifest.entrypoint);
      const entryContent = await fetchText(entryUrl);
      fs.writeFileSync(path.join(skillDir, manifest.entrypoint), entryContent);

      // If squad type, also fetch squad.json
      if (manifest.type === "squad" && manifest.entrypoint !== "squad.json") {
        try {
          const squadUrl = skillFileUrl(args.id, 'squad.json');
          const squadContent = await fetchText(squadUrl);
          fs.writeFileSync(path.join(skillDir, "squad.json"), squadContent);
        } catch {}
      }

      // Fetch README if available
      try {
        const readmeUrl = skillFileUrl(args.id, 'README.md');
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
                const manifestUrl = skillFileUrl(entry.id, 'skill.json');
                const manifest = await fetchJson(manifestUrl) as SkillManifest;
                if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
                fs.mkdirSync(skillDir, { recursive: true });
                fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));
                const entryUrl = skillFileUrl(entry.id, manifest.entrypoint);
                fs.writeFileSync(path.join(skillDir, manifest.entrypoint), await fetchText(entryUrl));
                if (manifest.type === "squad") {
                  try {
                    fs.writeFileSync(path.join(skillDir, "squad.json"), await fetchText(skillFileUrl(entry.id, 'squad.json')));
                  } catch {}
                }
                try {
                  fs.writeFileSync(path.join(skillDir, "README.md"), await fetchText(skillFileUrl(entry.id, 'README.md')));
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
    // Try remote registry first, then fallback to local filesystem scan
    try {
      const index = await fetchJson(REGISTRY_URL);
      if (index?.skills?.length > 0) return { ok: true, index };
    } catch {}

    // Local filesystem scan
    const skills: any[] = [];
    const scannedDirs = [
      { dir: path.join(os.homedir(), ".codebrain", "skills"), scope: "codebrain" },
      { dir: path.join(os.homedir(), ".claude", "skills"), scope: "claude" },
    ];

    for (const { dir, scope } of scannedDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Try to read skill.json manifest
          const manifestPath = path.join(fullPath, "skill.json");
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
              skills.push({
                id: manifest.id || entry.name,
                name: manifest.name || entry.name,
                description: manifest.description || "",
                type: manifest.type || "skill",
                version: manifest.version || "1.0.0",
                tags: manifest.tags || [],
                scope,
                installed: true,
              });
            } catch {
              skills.push({ id: entry.name, name: entry.name, description: "", type: "skill", scope, installed: true });
            }
          } else {
            skills.push({ id: entry.name, name: entry.name, description: "", type: "skill", scope, installed: true });
          }
        } else if (entry.name.endsWith(".md")) {
          // .md skill file in .claude/skills/
          const id = entry.name.replace(/\.md$/, "");
          let description = "";
          try {
            const content = fs.readFileSync(fullPath, "utf-8").slice(0, 200);
            const firstLine = content.split("\n").find(l => l.trim() && !l.startsWith("#"));
            if (firstLine) description = firstLine.trim().slice(0, 120);
          } catch {}
          skills.push({ id, name: id, description, type: "skill", scope, installed: true });
        }
      }
    }

    // Also scan workspaces for AGENTS.md catalog files
    try {
      const navStore = path.join(os.homedir(), ".codebrain", "nav-store.json");
      if (fs.existsSync(navStore)) {
        const nav = JSON.parse(fs.readFileSync(navStore, "utf-8"));
        const workspaces = (nav.state?.tabs || []).map((t: any) => t.workspacePath).filter(Boolean);
        for (const ws of workspaces) {
          const agentsPath = path.join(ws, "AGENTS.md");
          if (fs.existsSync(agentsPath)) {
            let description = "";
            try {
              const content = fs.readFileSync(agentsPath, "utf-8").slice(0, 200);
              const firstLine = content.split("\n").find((l: string) => l.trim() && !l.startsWith("#"));
              if (firstLine) description = firstLine.trim().slice(0, 120);
            } catch {}
            skills.push({
              id: `agents:${path.basename(ws)}`,
              name: `AGENTS.md — ${path.basename(ws)}`,
              description: description || "Workspace agent instructions",
              type: "agent",
              scope: "workspace",
              workspace: ws,
              installed: true,
            });
          }
        }
      }
    } catch {}

    return { ok: true, index: { skills } };
  });

  // ── Claude Config handlers (.claude/ directory) ──

  ipcMain.handle("skill:claudeConfigStatus", async () => {
    return { installed: fs.existsSync(CLAUDE_CONFIG_DIR) };
  });

  ipcMain.handle("skill:installClaudeConfig", async () => {
    try {
      setupClaudeIntegration();
      return { ok: true, path: path.join(os.homedir(), ".claude") };
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

  // ── Feature 7: GitHub catalog (davila7/claude-code-templates) ─────────────
  const GITHUB_API_BASE = "https://api.github.com/repos/davila7/claude-code-templates/contents";
  const CLAUDE_AGENTS_DIR = path.join(os.homedir(), ".claude", "agents");
  const CLAUDE_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

  ipcMain.handle("catalog:list", async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      let agents: Array<{ name: string; slug: string; type: "agent" }> = [];
      let skills: Array<{ name: string; slug: string; type: "skill" }> = [];

      try {
        // Agents: files directly in the repo root ending with .md
        const agentsResp = await fetch(`${GITHUB_API_BASE}`, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Codebrain/1.0" },
          signal: controller.signal,
        });
        if (agentsResp.ok) {
          const items = (await agentsResp.json()) as Array<{ name: string; type: string }>;
          agents = items
            .filter((i) => i.type === "file" && i.name.endsWith(".md"))
            .map((i) => ({ name: i.name.replace(/\.md$/, ""), slug: i.name, type: "agent" as const }));
        }
        // Skills: directories
        const skillsResp = await fetch(`${GITHUB_API_BASE}`, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Codebrain/1.0" },
          signal: controller.signal,
        });
        if (skillsResp.ok) {
          const items = (await skillsResp.json()) as Array<{ name: string; type: string }>;
          skills = items
            .filter((i) => i.type === "dir")
            .map((i) => ({ name: i.name, slug: i.name, type: "skill" as const }));
        }
      } finally {
        clearTimeout(timer);
      }

      return { ok: true, agents, skills };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("catalog:install", async (_event, args: { slug: string; type: "agent" | "skill" }) => {
    const { slug, type } = args;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      if (type === "agent") {
        // Download single .md file to ~/.claude/agents/
        const rawUrl = `https://raw.githubusercontent.com/davila7/claude-code-templates/main/${slug}`;
        const resp = await fetch(rawUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
        const content = await resp.text();
        if (!fs.existsSync(CLAUDE_AGENTS_DIR)) fs.mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true });
        const destPath = path.join(CLAUDE_AGENTS_DIR, slug);
        fs.writeFileSync(destPath, content, "utf-8");
        return { ok: true, path: destPath };
      } else {
        // Download directory listing then all files to ~/.claude/skills/<slug>/
        const listResp = await fetch(`${GITHUB_API_BASE}/${slug}`, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Codebrain/1.0" },
          signal: controller.signal,
        });
        if (!listResp.ok) {
          clearTimeout(timer);
          return { ok: false, error: `HTTP ${listResp.status}: ${listResp.statusText}` };
        }
        const files = (await listResp.json()) as Array<{ name: string; download_url: string | null; type: string }>;
        const destDir = path.join(CLAUDE_SKILLS_DIR, slug);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        for (const file of files) {
          if (file.type !== "file" || !file.download_url) continue;
          const fileResp = await fetch(file.download_url, { signal: controller.signal });
          if (!fileResp.ok) continue;
          const content = await fileResp.text();
          fs.writeFileSync(path.join(destDir, file.name), content, "utf-8");
        }
        clearTimeout(timer);
        return { ok: true, path: destDir };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}
