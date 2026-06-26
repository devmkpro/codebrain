"use strict";

/**
 * Auto-Memory Bridge — Import Claude Code's native memory files into Codebrain.
 *
 * Claude Code stores project-specific memories in ~/.claude/projects/<slug>/memory/*.md
 * with YAML frontmatter + markdown body. This bridge imports those into Codebrain's
 * SQLite memory store, enabling cross-project knowledge sharing.
 *
 * Enables cross-project knowledge sharing by importing Claude Code's native memory files.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ─── Constants ────────────────────────────────────────────────────────

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const NAMESPACE = "claude-memories";

// ─── YAML Frontmatter Parser (minimal) ───────────────────────────────

/**
 * Parse YAML frontmatter from a markdown file.
 * Supports simple key: value pairs (name, description, type).
 * @param {string} content
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yaml = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (m) {
      let val = m[2].trim();
      // Strip quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      frontmatter[m[1]] = val;
    }
  }

  return { frontmatter, body };
}

// ─── Section Splitter ────────────────────────────────────────────────

/**
 * Split markdown body into sections by ## headers.
 * Each section becomes a separate memory entry for granular retrieval.
 * @param {string} body
 * @returns {Array<{ title: string, content: string }>}
 */
function splitSections(body) {
  const sections = [];
  const lines = body.split("\n");
  let currentTitle = "_root";
  let currentLines = [];

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      // Save previous section
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content) sections.push({ title: currentTitle, content });
      }
      currentTitle = h2[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content) sections.push({ title: currentTitle, content });
  }

  return sections;
}

// ─── Project Slug Extraction ─────────────────────────────────────────

/**
 * Extract a readable project name from the Claude Code project slug.
 * Slugs are typically encoded as path segments: C--Users-Maike-Desktop-codebrain
 * @param {string} slug
 * @returns {string}
 */
function slugToName(slug) {
  return slug
    .replace(/^[A-Z]-/, "") // Remove drive letter prefix
    .replace(/--/g, "/")    // Restore path separators
    .replace(/-/g, " ")     // Hyphens to spaces
    .replace(/\s+/g, " ")
    .trim()
    .split("/")
    .pop() || slug; // Take last segment (project name)
}

// ─── Scanner ─────────────────────────────────────────────────────────

/**
 * Scan all Claude Code project memory directories.
 * @returns {Array<{ projectSlug: string, projectName: string, filePath: string }>}
 */
function scanMemoryFiles() {
  const results = [];

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    // ~/.claude/projects/ doesn't exist — no memories to import
    return results;
  }

  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const memDir = path.join(PROJECTS_DIR, dir.name, "memory");
    try {
      const files = fs.readdirSync(memDir);
      for (const file of files) {
        if (file.endsWith(".md") || file.endsWith(".json")) {
          results.push({
            projectSlug: dir.name,
            projectName: slugToName(dir.name),
            filePath: path.join(memDir, file),
          });
        }
      }
    } catch {
      // No memory directory — skip
    }
  }

  return results;
}

// ─── Importer ────────────────────────────────────────────────────────

/**
 * Create an AutoMemoryBridge that imports Claude Code memories into a Codebrain store.
 * @param {object} memoryStore - Codebrain's createMemoryStore() instance
 * @param {object} [opts]
 * @param {string} [opts.workspace] - Workspace scope for imported memories
 * @param {boolean} [opts.overwrite=false] - Overwrite existing entries
 * @param {Function} [opts.onImport] - Callback per imported entry
 */
function createAutoMemoryBridge(memoryStore, opts = {}) {
  const workspace = opts.workspace || "global";
  const overwrite = opts.overwrite || false;
  const onImport = opts.onImport || null;

  /**
   * Import all Claude Code project memories into Codebrain.
   * @returns {{ imported: number, skipped: number, errors: number, projects: string[] }}
   */
  function importAll() {
    const files = scanMemoryFiles();
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const projects = new Set();

    for (const { projectSlug, projectName, filePath } of files) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);
        const fileName = path.basename(filePath, path.extname(filePath));

        // Split into sections for granular entries
        const sections = splitSections(body);

        if (sections.length === 0) continue;

        for (const section of sections) {
          const key = `claude-memory:${projectSlug}:${fileName}:${section.title}`;

          // Check if already imported
          if (!overwrite) {
            const existing = memoryStore.read({ key });
            if (existing) {
              skipped++;
              continue;
            }
          }

          // Determine memory type from frontmatter or content
          const memType = inferType(frontmatter, section.content);

          // Build tags
          const tags = ["claude-memory", "cross-project", projectName];
          if (frontmatter.type) tags.push(frontmatter.type);
          if (section.title !== "_root") tags.push(`section:${section.title}`);

          // Write to Codebrain memory
          memoryStore.write({
            type: memType,
            key,
            content: section.content,
            tags,
            agent_id: "auto-memory-bridge",
            workspace,
            scope: "user", // Cross-workspace scope
          });

          imported++;
          projects.add(projectName);
          if (onImport) onImport({ key, projectName, section: section.title });
        }
      } catch (err) {
        errors++;
      }
    }

    return { imported, skipped, errors, projects: [...projects] };
  }

  /**
   * Import memories from a specific project.
   * @param {string} projectSlug
   * @returns {{ imported: number, skipped: number }}
   */
  function importProject(projectSlug) {
    const memDir = path.join(PROJECTS_DIR, projectSlug, "memory");
    let imported = 0;
    let skipped = 0;

    try {
      const files = fs.readdirSync(memDir);
      for (const file of files) {
        if (!file.endsWith(".md") && !file.endsWith(".json")) continue;
        const filePath = path.join(memDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);
        const fileName = file.replace(/\.(md|json)$/, "");
        const sections = splitSections(body);

        for (const section of sections) {
          const key = `claude-memory:${projectSlug}:${fileName}:${section.title}`;
          if (!overwrite && memoryStore.read({ key })) { skipped++; continue; }

          memoryStore.write({
            type: inferType(frontmatter, section.content),
            key,
            content: section.content,
            tags: ["claude-memory", "cross-project", slugToName(projectSlug)],
            agent_id: "auto-memory-bridge",
            workspace,
            scope: "user",
          });
          imported++;
        }
      }
    } catch { /* project not found */ }

    return { imported, skipped };
  }

  /**
   * Get status of the auto-memory bridge.
   * @returns {{ totalClaudeMemories: number, importedToCodebrain: number, projects: string[] }}
   */
  function status() {
    const files = scanMemoryFiles();
    const projects = new Set(files.map(f => f.projectName));

    // Count imported memories
    let importedToCodebrain = 0;
    try {
      const stats = memoryStore.stats({ workspace });
      importedToCodebrain = stats?.byType ? Object.values(stats.byType).reduce((a, b) => a + b, 0) : 0;
    } catch { /* ignore */ }

    return {
      totalClaudeMemories: files.length,
      importedToCodebrain,
      projects: [...projects],
    };
  }

  return { importAll, importProject, status, scanMemoryFiles };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Infer memory type from frontmatter and content.
 */
function inferType(frontmatter, content) {
  const type = (frontmatter.type || "").toLowerCase();
  if (type.includes("semantic") || type.includes("knowledge")) return "semantic";
  if (type.includes("episodic") || type.includes("event")) return "episodic";
  if (type.includes("procedural") || type.includes("how")) return "procedural";

  // Content-based heuristics
  if (/^(how to|steps:|procedure|guide|instructions)/i.test(content)) return "procedural";
  if (/^(learned|discovered|found that|insight|pattern)/i.test(content)) return "semantic";
  if (/^#\s/.test(content) && content.length > 500) return "semantic";

  return "semantic"; // Default to semantic for imported knowledge
}

module.exports = {
  createAutoMemoryBridge,
  scanMemoryFiles,
  parseFrontmatter,
  splitSections,
  slugToName,
  CLAUDE_DIR,
  PROJECTS_DIR,
};
