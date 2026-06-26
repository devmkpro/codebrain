"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".codebrain", "skills");
// Legacy alias kept for backward compat
const SKILLS_DIR = GLOBAL_SKILLS_DIR;
const REGISTRY_URL = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main/index.json";
const REGISTRY_BASE = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main";

/**
 * Resolve the skills directory based on scope.
 * - "global" (default) → ~/.codebrain/skills/
 * - "project"          → <cwd>/.codebrain/skills/
 */
function resolveSkillsDir(scope, cwd) {
  if (scope === "project") {
    const projectDir = cwd || process.cwd();
    return path.join(projectDir, ".codebrain", "skills");
  }
  return GLOBAL_SKILLS_DIR;
}

function ensureSkillsDir(dir) {
  if (!dir) dir = GLOBAL_SKILLS_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Sync a skill to ~/.claude/skills/<id>.md so Claude Code CLI can invoke it via Skill() tool.
 * Called automatically after skillCreate and skillInstall.
 */
function syncSkillToClaudeCli(skillDir) {
  try {
    const manifest = readManifest(skillDir);
    if (!manifest || !manifest.id) return;

    const promptFile = path.join(skillDir, manifest.entrypoint ?? "prompt.md");
    if (!fs.existsSync(promptFile)) return;

    const prompt = fs.readFileSync(promptFile, "utf-8");
    const triggers = (manifest.triggers ?? []).map(t => `  - ${t}`).join("\n");

    const mdContent = `---
name: ${manifest.id}
description: ${manifest.description ?? ""}
version: ${manifest.version ?? "1.0.0"}
triggers:
${triggers}
---

${prompt}`;

    const claudeSkillsDir = path.join(os.homedir(), ".claude", "skills");
    if (!fs.existsSync(claudeSkillsDir)) fs.mkdirSync(claudeSkillsDir, { recursive: true });

    const outPath = path.join(claudeSkillsDir, `${manifest.id}.md`);
    fs.writeFileSync(outPath, mdContent, "utf-8");
  } catch (err) {
    // Non-fatal — skill still works via system prompt injection
    console.warn("[skill-handlers] syncSkillToClaudeCli failed:", err?.message);
  }
}

function readManifest(skillDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(skillDir, "skill.json"), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Skill-related bridge handlers for MCP tools.
 * Manages local skill storage and GitLab registry sync.
 */
function createSkillHandlers(opts) {
  /** Resolve effective cwd: explicit arg → getCurrentWorkspacePath → process.cwd() */
  function effectiveCwd(cwd) {
    return cwd || opts.getCurrentWorkspacePath?.() || process.cwd();
  }

  return {
    async skillList({ type, scope, cwd } = {}) {
      const resolvedCwd = effectiveCwd(cwd);
      // List from both global and project dirs, deduplicated by id
      const dirs = scope === "project"
        ? [resolveSkillsDir("project", resolvedCwd)]
        : scope === "global"
          ? [GLOBAL_SKILLS_DIR]
          : [GLOBAL_SKILLS_DIR, resolveSkillsDir("project", resolvedCwd)];

      const seen = new Set();
      const entries = [];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        try {
          for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!d.isDirectory()) continue;
            const skillDir = path.join(dir, d.name);
            const manifest = readManifest(skillDir);
            if (!manifest || seen.has(manifest.id)) continue;
            seen.add(manifest.id);
            const isProject = dir !== GLOBAL_SKILLS_DIR;
            entries.push({ id: manifest.id, name: manifest.name, type: manifest.type, version: manifest.version, description: manifest.description, tags: manifest.tags || [], scope: isProject ? "project" : "global" });
          }
        } catch {}
      }

      if (type) return entries.filter(e => e.type === type);
      return entries;
    },

    async skillGet({ id, scope, cwd }) {
      const resolvedCwd = effectiveCwd(cwd);
      // Search project first, then global
      const dirs = scope === "project"
        ? [resolveSkillsDir("project", resolvedCwd)]
        : scope === "global"
          ? [GLOBAL_SKILLS_DIR]
          : [resolveSkillsDir("project", resolvedCwd), GLOBAL_SKILLS_DIR];

      for (const dir of dirs) {
        const skillDir = path.join(dir, id);
        if (!fs.existsSync(skillDir)) continue;
        const manifest = readManifest(skillDir);
        if (!manifest) continue;
        const content = {};
        try {
          for (const f of fs.readdirSync(skillDir)) {
            if (f.endsWith(".md") || f.endsWith(".json")) {
              content[f] = fs.readFileSync(path.join(skillDir, f), "utf-8");
            }
          }
        } catch {}
        return { ok: true, manifest, content, scope: dir === GLOBAL_SKILLS_DIR ? "global" : "project" };
      }
      return { ok: false, error: `Skill '${id}' not found` };
    },

    async skillCreate({ id, name, type, description, prompt, version, tags, scope, cwd }) {
      if (!id) return { ok: false, error: "id is required" };
      if (!name) return { ok: false, error: "name is required" };
      if (!prompt) return { ok: false, error: "prompt is required" };

      const skillsDir = resolveSkillsDir(scope ?? "global", effectiveCwd(cwd));
      ensureSkillsDir(skillsDir);
      const skillDir = path.join(skillsDir, id);

      if (fs.existsSync(skillDir)) {
        return { ok: false, error: `Skill '${id}' already exists in ${scope ?? "global"} scope. Use skillDelete first or choose a different id.` };
      }

      fs.mkdirSync(skillDir, { recursive: true });

      const manifest = {
        id,
        name,
        type: type ?? "prompt",
        version: version ?? "1.0.0",
        description: description ?? "",
        tags: tags ?? [],
        entrypoint: "prompt.md",
      };

      fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2), "utf-8");
      fs.writeFileSync(path.join(skillDir, "prompt.md"), prompt, "utf-8");

      // Sync to ~/.claude/skills/ so Claude Code CLI can invoke via Skill() tool
      syncSkillToClaudeCli(skillDir);

      return {
        ok: true,
        id,
        scope: scope ?? "global",
        path: skillDir,
        message: `Skill '${id}' created in ${scope ?? "global"} scope at ${skillDir}`,
      };
    },

    async skillDelete({ id, scope, cwd }) {
      const resolvedCwd = effectiveCwd(cwd);
      const dirs = scope === "project"
        ? [resolveSkillsDir("project", resolvedCwd)]
        : scope === "global"
          ? [GLOBAL_SKILLS_DIR]
          : [resolveSkillsDir("project", resolvedCwd), GLOBAL_SKILLS_DIR];

      for (const dir of dirs) {
        const skillDir = path.join(dir, id);
        if (fs.existsSync(skillDir)) {
          fs.rmSync(skillDir, { recursive: true, force: true });
          return { ok: true, id, scope: dir === GLOBAL_SKILLS_DIR ? "global" : "project", path: skillDir };
        }
      }
      return { ok: false, error: `Skill '${id}' not found` };
    },

    async skillInstall({ id }) {
      try {
        ensureSkillsDir(GLOBAL_SKILLS_DIR);
        const skillDir = path.join(GLOBAL_SKILLS_DIR, id);

        const res = await fetch(`${REGISTRY_BASE}/skills/${id}/skill.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = await res.json();

        if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));

        const entryRes = await fetch(`${REGISTRY_BASE}/skills/${id}/${manifest.entrypoint}`);
        if (entryRes.ok) fs.writeFileSync(path.join(skillDir, manifest.entrypoint), await entryRes.text());

        if (manifest.type === "squad") {
          try {
            const squadRes = await fetch(`${REGISTRY_BASE}/skills/${id}/squad.json`);
            if (squadRes.ok) fs.writeFileSync(path.join(skillDir, "squad.json"), await squadRes.text());
          } catch {}
        }

        // Sync to ~/.claude/skills/ so Claude Code CLI can invoke via Skill() tool
        syncSkillToClaudeCli(skillDir);

        return { ok: true, manifest };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async skillUninstall({ id }) {
      const skillDir = path.join(GLOBAL_SKILLS_DIR, id);
      try {
        if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async skillSync({ direction }) {
      try {
        if (direction === "push") {
          return { ok: false, error: "Push not yet implemented. Use GitLab web UI to publish skills." };
        }

        // Pull from registry
        const indexRes = await fetch(REGISTRY_URL);
        if (!indexRes.ok) throw new Error(`HTTP ${indexRes.status}`);
        const index = await indexRes.json();

        const results = [];
        for (const entry of index.skills || []) {
          const skillDir = path.join(SKILLS_DIR, entry.id);
          const localManifest = readManifest(skillDir);

          if (!localManifest || localManifest.version !== entry.version) {
            const manifestRes = await fetch(`${REGISTRY_BASE}/skills/${entry.id}/skill.json`);
            if (!manifestRes.ok) continue;
            const manifest = await manifestRes.json();

            if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true, force: true });
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));

            const entryRes = await fetch(`${REGISTRY_BASE}/skills/${entry.id}/${manifest.entrypoint}`);
            if (entryRes.ok) fs.writeFileSync(path.join(skillDir, manifest.entrypoint), await entryRes.text());

            // Sync to ~/.claude/skills/ so Claude Code CLI can invoke via Skill() tool
            syncSkillToClaudeCli(skillDir);

            results.push({ id: entry.id, action: localManifest ? "updated" : "installed", version: entry.version });
          }
        }

        return { ok: true, results };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },
  };
}

module.exports = { createSkillHandlers };
