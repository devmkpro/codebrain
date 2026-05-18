#!/usr/bin/env node
/**
 * Codebrain Statusline for Claude Code
 *
 * Renders an ANSI-colored status display when Claude Code opens in a
 * Codebrain project. Reads session data from stdin (JSON from Claude Code)
 * and collects project metrics from the filesystem.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── ANSI Colors ──────────────────────────────────────────────────────────

const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  italic:   '\x1b[3m',
  under:    '\x1b[4m',

  // Foreground
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  blue:     '\x1b[34m',
  magenta:  '\x1b[35m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  gray:     '\x1b[90m',
  brightRed:    '\x1b[91m',
  brightGreen:  '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue:   '\x1b[94m',
  brightMagenta:'\x1b[95m',
  brightCyan:   '\x1b[96m',

  // Background
  bgRed:    '\x1b[41m',
  bgGreen:  '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue:   '\x1b[44m',
  bgMagenta:'\x1b[45m',
  bgCyan:   '\x1b[46m',
  bgGray:   '\x1b[100m',
  bgBrightBlue: '\x1b[104m',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function box(text, color) {
  return `${color}${C.bold} ${text} ${C.reset}`;
}

function tag(label, value, labelColor, valueColor) {
  return `${labelColor}${C.bold}${label}${C.reset}${valueColor || ''}${value}${C.reset}`;
}

function progressBar(ratio, width = 10) {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  if (ratio > 0.9) return `${C.brightRed}${bar}${C.reset}`;
  if (ratio > 0.7) return `${C.brightYellow}${bar}${C.reset}`;
  return `${C.brightGreen}${bar}${C.reset}`;
}

function statusDot(ok) {
  return ok ? `${C.brightGreen}\u25cf${C.reset}` : `${C.red}\u25cb${C.reset}`;
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// ── Stdin Reader (Claude Code session data) ──────────────────────────────

let stdinData = {};
function readStdin() {
  try {
    if (process.stdin.isTTY) return;
    const chunks = [];
    const fd = process.stdin.fd;
    // Non-blocking read — if no data available, return immediately
    const buf = Buffer.alloc(4096);
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
    } catch { return; }
    if (bytesRead > 0) {
      stdinData = JSON.parse(buf.slice(0, bytesRead).toString('utf-8'));
    }
  } catch { /* no stdin data */ }
}

readStdin();

// ── Project Detection ────────────────────────────────────────────────────

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const claudeDir = path.join(projectDir, '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');

function getSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

// ── Git Info ─────────────────────────────────────────────────────────────

function getGitInfo() {
  const cwd = projectDir;
  const branch = safe(() =>
    execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', timeout: 3000 }).trim(),
    'unknown'
  );
  const changes = safe(() =>
    execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 3000 }).trim(),
    ''
  );
  const changeCount = changes ? changes.split('\n').filter(l => l.trim()).length : 0;
  const lastCommit = safe(() =>
    execSync('git log -1 --format="%h %s"', { cwd, encoding: 'utf-8', timeout: 3000 }).trim(),
    ''
  );
  return { branch, changeCount, lastCommit };
}

// ── Metric Collectors ────────────────────────────────────────────────────

function countAgents() {
  const agentsDir = path.join(claudeDir, 'agents');
  try {
    let count = 0;
    for (const dir of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (dir.isDirectory()) {
        const sub = path.join(agentsDir, dir.name);
        count += fs.readdirSync(sub).filter(f => f.endsWith('.md')).length;
      }
    }
    return count;
  } catch { return 0; }
}

function countCommands() {
  const cmdDir = path.join(claudeDir, 'commands');
  try {
    let count = 0;
    for (const dir of fs.readdirSync(cmdDir, { withFileTypes: true })) {
      if (dir.isDirectory()) {
        count += fs.readdirSync(path.join(cmdDir, dir.name)).filter(f => f.endsWith('.md')).length;
      }
    }
    return count;
  } catch { return 0; }
}

function countSkills() {
  const skillsDir = path.join(claudeDir, 'skills');
  try {
    return fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).length;
  } catch { return 0; }
}

function countConfigs() {
  const configDir = path.join(claudeDir, 'config');
  try {
    return fs.readdirSync(configDir).filter(f => f.endsWith('.json')).length;
  } catch { return 0; }
}

function getHookCount(settings) {
  try {
    const hooks = settings.hooks || {};
    let count = 0;
    for (const event of Object.values(hooks)) {
      if (Array.isArray(event)) {
        for (const entry of event) {
          count += (entry.hooks || []).length;
        }
      }
    }
    return count;
  } catch { return 0; }
}

function getMcpToolCount(settings) {
  try {
    return settings.codebrain?.mcp?.totalTools || 0;
  } catch { return 0; }
}

function getMcpCategories(settings) {
  try {
    return (settings.codebrain?.mcp?.categories || []).length;
  } catch { return 0; }
}

function getRoles(settings) {
  try {
    return settings.codebrain?.squads?.roles || [];
  } catch { return []; }
}

function getVersion(settings) {
  return settings.codebrain?.version || settings.env?.CODEBRAIN_VERSION || '?';
}

function countMemoryEntries() {
  try {
    const memDir = path.join(projectDir, '.claude', 'memory');
    if (!fs.existsSync(memDir)) return 0;
    let count = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry));
        else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) count++;
      }
    };
    walk(memDir);
    return count;
  } catch { return 0; }
}

// ── Session Data (from stdin) ────────────────────────────────────────────

function getModel() {
  return stdinData.model || stdinData.session?.model || null;
}

function getContextWindow() {
  return stdinData.context_window || stdinData.session?.context_window || null;
}

function getContextUsed() {
  return stdinData.context_used || stdinData.session?.context_used || null;
}

function getCost() {
  return stdinData.cost || stdinData.session?.cost || null;
}

// ── Render ───────────────────────────────────────────────────────────────

function render() {
  const settings = getSettings();
  const git = getGitInfo();
  const version = getVersion(settings);
  const mcpTools = getMcpToolCount(settings);
  const mcpCats = getMcpCategories(settings);
  const agents = countAgents();
  const commands = countCommands();
  const skills = countSkills();
  const configs = countConfigs();
  const hooks = getHookCount(settings);
  const roles = getRoles(settings);
  const memoryEntries = countMemoryEntries();

  const model = getModel();
  const contextWindow = getContextWindow();
  const contextUsed = getContextUsed();
  const cost = getCost();

  const lines = [];

  // ── Line 1: Header ────────────────────────────────────────────────────

  const brain = `${C.brightCyan}${C.bold}\u26A1${C.reset}`;
  const title = `${C.brightCyan}${C.bold}CODEBRAIN${C.reset}`;
  const verTag = box(`v${version}`, C.bgGray);

  let line1 = `  ${brain} ${title} ${verTag}`;

  // Git info
  const gitDot = git.changeCount > 0 ? C.brightYellow : C.brightGreen;
  const gitInfo = `${gitDot}${C.bold}\u2442${C.reset} ${C.white}${git.branch}${C.reset}`;
  const changesInfo = git.changeCount > 0
    ? ` ${C.yellow}(${git.changeCount} \u0394)${C.reset}`
    : ` ${C.green}(clean)${C.reset}`;

  line1 += `  ${gitInfo}${changesInfo}`;

  if (git.lastCommit) {
    line1 += `  ${C.gray}\u2502 ${git.lastCommit}${C.reset}`;
  }

  lines.push(line1);

  // ── Line 2: MCP + Agents + Skills ─────────────────────────────────────

  const mcpTag = tag('MCP', ` ${mcpTools} tools / ${mcpCats} categories`, C.brightMagenta, C.white);
  const agentTag = tag('Agents', ` ${agents}`, C.brightBlue, C.white);
  const cmdTag = tag('Cmds', ` ${commands}`, C.brightCyan, C.white);
  const skillTag = tag('Skills', ` ${skills}`, C.brightGreen, C.white);
  const configTag = tag('Config', ` ${configs}`, C.brightYellow, C.white);
  const hookTag = tag('Hooks', ` ${hooks}`, C.brightRed, C.white);

  let line2 = `  ${C.gray}\u251C\u2500${C.reset} ${mcpTag}  ${agentTag}  ${cmdTag}  ${skillTag}  ${configTag}  ${hookTag}`;

  // Roles
  if (roles.length > 0) {
    const roleStr = roles.map(r => {
      const colors = {
        orchestrator: C.brightMagenta,
        backend: C.brightBlue,
        frontend: C.brightCyan,
        'ui-tester': C.brightGreen,
        'gemini-worker': C.brightYellow,
      };
      return `${colors[r] || C.white}${r}${C.reset}`;
    }).join(`${C.gray} \u00B7 ${C.reset}`);
    line2 += `  ${C.gray}\u2502${C.reset} ${roleStr}`;
  }

  lines.push(line2);

  // ── Line 3: Squad Config + Memory + Providers ─────────────────────────

  const providers = settings.codebrain?.providers || [];
  const memBackend = settings.env?.CODEBRAIN_MEMORY_BACKEND || '?';

  let line3 = `  ${C.gray}\u251C\u2500${C.reset} `;
  line3 += tag('Memory', ` ${memoryEntries} entries (${memBackend})`, C.brightGreen, C.white);
  line3 += `  ${tag('Providers', ` ${providers.join(', ') || 'none'}`, C.brightMagenta, C.white)}`;

  const maxWorkers = settings.codebrain?.squads?.maxWorkers || '?';
  const topology = settings.codebrain?.squads?.defaultTopology || '?';
  line3 += `  ${tag('Squad', ` max ${maxWorkers} workers / ${topology}`, C.brightBlue, C.white)}`;

  lines.push(line3);

  // ── Line 4: Session Info (from stdin) ─────────────────────────────────

  let line4 = `  ${C.gray}\u2514\u2500${C.reset} `;

  if (model) {
    // Color model name based on provider
    let modelColor = C.white;
    if (model.includes('claude') || model.includes('sonnet') || model.includes('opus') || model.includes('haiku')) {
      modelColor = C.brightMagenta;
    } else if (model.includes('gemini')) {
      modelColor = C.brightBlue;
    } else if (model.includes('mimo')) {
      modelColor = C.brightCyan;
    } else if (model.includes('gpt') || model.includes('openai')) {
      modelColor = C.brightGreen;
    }
    line4 += tag('Model', ` ${model}`, modelColor, C.white);
  } else {
    line4 += tag('Model', ` (not detected)`, C.gray, C.dim);
  }

  if (contextWindow && contextUsed) {
    const ratio = contextUsed / contextWindow;
    const pct = Math.round(ratio * 100);
    const bar = progressBar(ratio, 12);
    const usedStr = contextUsed >= 1e6
      ? `${(contextUsed / 1e6).toFixed(1)}M`
      : `${Math.round(contextUsed / 1e3)}K`;
    const totalStr = contextWindow >= 1e6
      ? `${(contextWindow / 1e6).toFixed(1)}M`
      : `${Math.round(contextWindow / 1e3)}K`;
    line4 += `  ${tag('Context', ` ${bar} ${pct}% (${usedStr}/${totalStr})`, C.brightYellow, C.white)}`;
  }

  if (cost !== null && cost !== undefined) {
    const costNum = typeof cost === 'number' ? cost : parseFloat(cost);
    if (!isNaN(costNum)) {
      const costColor = costNum > 1 ? C.brightRed : costNum > 0.1 ? C.brightYellow : C.brightGreen;
      line4 += `  ${tag('Cost', ` $${costNum.toFixed(4)}`, costColor, C.white)}`;
    }
  }

  // Session uptime hint
  line4 += `  ${C.gray}[${new Date().toLocaleTimeString()}]${C.reset}`;

  lines.push(line4);

  // ── Separator ─────────────────────────────────────────────────────────

  const separator = `  ${C.gray}${'─'.repeat(72)}${C.reset}`;
  lines.unshift(separator);
  lines.push(separator);

  // ── Output ────────────────────────────────────────────────────────────

  console.log(lines.join('\n'));
}

// ── Main ─────────────────────────────────────────────────────────────────

try {
  render();
} catch (err) {
  console.log(`${C.yellow}[Codebrain Statusline] Error: ${err.message}${C.reset}`);
}
