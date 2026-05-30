"use strict";

/**
 * Codebrain Hook Handler for Claude Code
 *
 * Dispatches lifecycle events from Claude Code hooks (settings.json).
 * Handles: route, pre-bash, pre-edit, post-edit, post-bash,
 *          session-start, session-end, stop, compact-manual, compact-auto,
 *          subagent-start, subagent-stop, notify
 *
 * The `route` command is the most important: it reads the user prompt
 * and checks it against skill triggers to auto-suggest relevant skills.
 */

const fs = require("fs");
const path = require("path");

// ── Skill trigger matching ──────────────────────────────────────────────────

const SKILLS_DIR = path.resolve(__dirname, "..", "..", ".codebrain", "skills");

/**
 * Load all installed skills and their triggers from each skill directory.
 * Results are cached for the lifetime of the process (single invocation).
 */
let _skillsCache = null;
function loadSkills() {
  if (_skillsCache) return _skillsCache;
  _skillsCache = [];
  try {
    if (!fs.existsSync(SKILLS_DIR)) return _skillsCache;
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillJsonPath = path.join(SKILLS_DIR, entry.name, "skill.json");
      if (!fs.existsSync(skillJsonPath)) continue;
      try {
        const raw = fs.readFileSync(skillJsonPath, "utf-8");
        const skill = JSON.parse(raw);
        if (skill.triggers && Array.isArray(skill.triggers) && skill.triggers.length > 0) {
          _skillsCache.push({
            id: skill.id || entry.name,
            name: skill.name || entry.name,
            description: skill.description || "",
            type: skill.type || "prompt",
            triggers: skill.triggers,
          });
        }
      } catch (parseErr) {
        // Skip malformed skill.json files
      }
    }
  } catch {
    // Skills dir missing or unreadable — gracefully skip
  }
  return _skillsCache;
}

/**
 * Check the user prompt against all skill triggers.
 * Returns the best matching skill or null.
 * Matching is case-insensitive and supports multi-word triggers.
 */
function matchSkillTrigger(prompt) {
  if (!prompt || typeof prompt !== "string") return null;
  const lowerPrompt = prompt.toLowerCase();
  const skills = loadSkills();

  let bestMatch = null;
  let bestScore = 0;

  for (const skill of skills) {
    for (const trigger of skill.triggers) {
      const lowerTrigger = trigger.toLowerCase();
      // Check if the trigger phrase appears in the prompt
      if (lowerPrompt.includes(lowerTrigger)) {
        // Score by trigger length (longer = more specific = better match)
        const score = lowerTrigger.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = skill;
        }
      }
    }
  }

  return bestMatch;
}

// ── Hook command handlers ───────────────────────────────────────────────────

/**
 * Read the user prompt from environment or stdin.
 * Claude Code passes the prompt via CLAUDE_HOOK_INPUT env var.
 */
function readUserPrompt() {
  // Try CLAUDE_HOOK_INPUT first (primary method for UserPromptSubmit)
  if (process.env.CLAUDE_HOOK_INPUT) {
    return process.env.CLAUDE_HOOK_INPUT;
  }

  // Try reading from stdin (fallback for other transports)
  try {
    const stat = fs.fstatSync(0); // fd 0 = stdin
    if (stat.size > 0) {
      return fs.readFileSync(0, "utf-8").trim();
    }
  } catch {
    // stdin not available or empty
  }

  // Try CLAUDE_PROMPT as another possible env var name
  if (process.env.CLAUDE_PROMPT) {
    return process.env.CLAUDE_PROMPT;
  }

  return "";
}

/**
 * Handle the `route` command (UserPromptSubmit hook).
 * Reads the user prompt, checks against skill triggers,
 * and outputs a system_reminder if a skill matches.
 */
function handleRoute() {
  const prompt = readUserPrompt();
  if (!prompt) {
    // No prompt available — pass through silently
    process.exit(0);
  }

  const skill = matchSkillTrigger(prompt);
  if (!skill) {
    // No skill trigger matched — pass through silently
    process.exit(0);
  }

  // Output a system_reminder that Claude Code will inject into context.
  // This makes Claude suggest using the matched skill without the user asking.
  const reminder = [
    `SKILL DETECTADA: O prompt do usuário parece relacionado à skill "${skill.name}".`,
    `Use /${skill.id} para esta tarefa.`,
    `Descrição: ${skill.description}`,
    `Se o usuário não mencionou explicitamente a skill, sugira-a naturalmente.`,
  ].join(" ");

  // Claude Code hook output format: JSON with type "system_reminder"
  console.log(JSON.stringify({
    type: "system_reminder",
    content: reminder,
  }));
}

// ── Other hook handlers (stubs for future expansion) ────────────────────────

function handlePreBash() {
  // Pre-Bash hook: can inspect/modify the command before execution
  // Output nothing to allow the command
}

function handlePreEdit() {
  // Pre-Edit hook: can inspect/modify file edits before execution
  // Output nothing to allow the edit
}

function handlePostEdit() {
  // Post-Edit hook: can log or react to file edits
}

function handlePostBash() {
  // Post-Bash hook: can log or react to bash commands
}

function handleSessionStart() {
  // SessionStart hook: runs when a Claude Code session begins
  const skills = loadSkills();
  if (skills.length > 0) {
    const skillNames = skills.map(s => `  /${s.id} — ${s.name}`).join("\n");
    console.log(JSON.stringify({
      type: "system_reminder",
      content: `Codebrain skills disponíveis:\n${skillNames}\n\nUse /<skill-id> para invocar uma skill, ou descreva o que precisa — triggers automáticos podem sugerir skills relevantes.`,
    }));
  }
}

function handleSessionEnd() {
  // SessionEnd hook: cleanup
}

function handleStop() {
  // Stop hook: runs when Claude stops generating
}

function handleCompactManual() {
  // Manual compact hook
}

function handleCompactAuto() {
  // Auto compact hook
}

function handleSubagentStart() {
  // Subagent start hook
}

function handleSubagentStop() {
  // Subagent stop hook
}

function handleNotify() {
  // Notification hook
}

// ── Main dispatcher ─────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case "route":
    handleRoute();
    break;
  case "pre-bash":
    handlePreBash();
    break;
  case "pre-edit":
    handlePreEdit();
    break;
  case "post-edit":
    handlePostEdit();
    break;
  case "post-bash":
    handlePostBash();
    break;
  case "session-start":
    handleSessionStart();
    break;
  case "session-end":
    handleSessionEnd();
    break;
  case "stop":
    handleStop();
    break;
  case "compact-manual":
    handleCompactManual();
    break;
  case "compact-auto":
    handleCompactAuto();
    break;
  case "subagent-start":
    handleSubagentStart();
    break;
  case "subagent-stop":
    handleSubagentStop();
    break;
  case "notify":
    handleNotify();
    break;
  default:
    // Unknown command — pass through silently
    break;
}
