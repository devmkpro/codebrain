"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const SKILLS_DIR = path.join(os.homedir(), ".codebrain", "skills");
const REGISTRY_URL = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main/index.json";
const REGISTRY_BASE = "https://gitlab.com/maikeofc18/codebrain-skills/-/raw/main";

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
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
  return {
    async skillList({ type } = {}) {
      ensureSkillsDir();
      try {
        const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => {
            const skillDir = path.join(SKILLS_DIR, d.name);
            const manifest = readManifest(skillDir);
            return manifest ? { id: manifest.id, name: manifest.name, type: manifest.type, version: manifest.version, description: manifest.description, tags: manifest.tags || [] } : null;
          })
          .filter(Boolean);

        if (type) return entries.filter(e => e.type === type);
        return entries;
      } catch {
        return [];
      }
    },

    async skillGet({ id }) {
      const skillDir = path.join(SKILLS_DIR, id);
      if (!fs.existsSync(skillDir)) return { ok: false, error: `Skill '${id}' not found` };
      const manifest = readManifest(skillDir);
      if (!manifest) return { ok: false, error: `Invalid skill: missing skill.json` };

      const content = {};
      try {
        for (const f of fs.readdirSync(skillDir)) {
          if (f.endsWith(".md") || f.endsWith(".json")) {
            content[f] = fs.readFileSync(path.join(skillDir, f), "utf-8");
          }
        }
      } catch {}

      return { ok: true, manifest, content };
    },

    async skillInstall({ id }) {
      try {
        ensureSkillsDir();
        const skillDir = path.join(SKILLS_DIR, id);

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

        return { ok: true, manifest };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    async skillUninstall({ id }) {
      const skillDir = path.join(SKILLS_DIR, id);
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
