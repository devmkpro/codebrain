import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AppContext, McpServerInfo } from "../context";

export function readRecentWorkspaces(ctx: AppContext): string[] {
  try { return JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8")); } catch { return []; }
}

export function saveRecentWorkspaces(ctx: AppContext, workspaces: string[]): void {
  try { fs.writeFileSync(ctx.WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8"); } catch {}
}

export function touchWorkspace(ctx: AppContext, wsPath: string): void {
  const list = readRecentWorkspaces(ctx).filter((p) => p !== wsPath);
  saveRecentWorkspaces(ctx, [wsPath, ...list].slice(0, 20));
}

/**
 * Generate and write Codebrain context files for a workspace.
 * Creates .claude/codebrain-context.md and .gemini/codebrain-context.md
 * with active agent info, MCP tools availability, and project metadata.
 */
export function writeContextFiles(ctx: AppContext, wsPath: string): void {
  try {
    const now = new Date().toISOString();
    const wsName = path.basename(wsPath);

    // Gather active agents from paneConfigs
    const agents: string[] = [];
    for (const [paneId, cfg] of ctx.paneConfigs) {
      const label = cfg.role || cfg.agent || "agent";
      const model = cfg.model || "default";
      agents.push(`- **${label}** (pane: ${paneId.slice(0, 8)}, model: ${model})`);
    }
    const agentsSection = agents.length > 0 ? agents.join("\n") : "- No active agents";

    // Read project info from package.json if present
    let projectInfo = "Not a Node.js project";
    try {
      const pkgPath = path.join(wsPath, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        projectInfo = `${pkg.name || "unnamed"} v${pkg.version || "0.0.0"}`;
      }
    } catch {}

    const content = `# Codebrain Workspace Context
**Workspace:** ${wsName}
**Path:** ${wsPath}
**Updated:** ${now}

## Active Agents
${agentsSection}

## MCP Tools Available
This workspace has access to the Codebrain MCP server with 97+ tools.
Use memory_search, pattern_list, pane_list to coordinate with other agents.

## Project Info
${projectInfo}
`;

    // Write to .claude/codebrain-context.md
    const claudeDir = path.join(wsPath, ".claude");
    try {
      if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "codebrain-context.md"), content, "utf-8");
    } catch {}

    // Write to .gemini/codebrain-context.md
    const geminiDir = path.join(wsPath, ".gemini");
    try {
      if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
      fs.writeFileSync(path.join(geminiDir, "codebrain-context.md"), content, "utf-8");
    } catch {}
  } catch (err) {
    console.warn("[writeContextFiles] Failed:", err);
  }
}

/**
 * Refresh all provider integration files across every known workspace.
 *
 * Called on startup and whenever the MCP server starts/restarts.
 * Ensures all workspaces have up-to-date config for every AI provider:
 *   - Claude Code  → .mcp.json (SSE transport)
 *   - Codex        → .codex/instructions.md + ~/.codex/config.toml (HTTP transport)
 *   - Gemini CLI   → .gemini/codebrain-context.md
 *   - All          → .claude/codebrain-context.md
 */
export function refreshAllWorkspaces(ctx: AppContext, mcpInfo?: McpServerInfo): void {
  // Collect all known workspaces: current + active panes + recent list
  const wsSet = new Set<string>();

  if (ctx.currentWorkspacePath && fs.existsSync(ctx.currentWorkspacePath)) {
    wsSet.add(ctx.currentWorkspacePath);
  }
  for (const [, cfg] of ctx.paneConfigs) {
    if (cfg.cwd && fs.existsSync(cfg.cwd)) wsSet.add(cfg.cwd);
  }
  try {
    if (fs.existsSync(ctx.WORKSPACES_FILE)) {
      const recents: string[] = JSON.parse(fs.readFileSync(ctx.WORKSPACES_FILE, "utf-8"));
      for (const ws of recents) {
        if (ws && fs.existsSync(ws)) wsSet.add(ws);
      }
    }
  } catch {}

  const port = mcpInfo?.port ?? 61010;
  const sseUrl = mcpInfo?.sseUrl ?? `http://127.0.0.1:${port}/sse`;
  const httpUrl = mcpInfo?.streamableHttpUrl ?? `http://127.0.0.1:${port}/mcp`;

  // ── Per-workspace files ──
  for (const wsPath of wsSet) {
    try {
      // 1. .mcp.json — Streamable HTTP transport (works for all agents: Claude, Kimi, Gemini, Codex, Cursor)
      const mcpJson = JSON.stringify({
        mcpServers: { codebrain: { type: "streamable-http", url: httpUrl } },
      }, null, 2);
      fs.writeFileSync(path.join(wsPath, ".mcp.json"), mcpJson, "utf-8");

      // 2. .codex/instructions.md — Codex workspace context
      const codexDir = path.join(wsPath, ".codex");
      if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
      const codexInstructions = `# Codebrain MCP Integration

This workspace is managed by Codebrain (multi-agent IDE).

## MCP Server
The Codebrain MCP server exposes 97+ tools for agent coordination:
- **HTTP (Streamable):** ${httpUrl}
- **SSE:** ${sseUrl}

## Available Tool Categories
- \`pane_*\` — spawn, write, read, manage agent terminals
- \`memory_*\` — shared SQLite memory across agents
- \`pattern_*\` — pattern learning and reuse
- \`browser_*\` — browser automation (30 tools)
- \`hooks_*\` — lifecycle event system
- \`skill_*\` — skills management
- \`swarm_*\` — swarm orchestration
- \`todo_*\` — shared task tracking

## Usage
Query the MCP server at ${httpUrl} using Streamable HTTP transport.
`;
      fs.writeFileSync(path.join(codexDir, "instructions.md"), codexInstructions, "utf-8");

      // 3. Context files for Claude + Gemini
      writeContextFiles(ctx, wsPath);

      console.log(`[refreshAllWorkspaces] Updated ${wsPath}`);
    } catch (err) {
      console.warn(`[refreshAllWorkspaces] Failed for ${wsPath}:`, err);
    }
  }

  // ── OpenClaude: ~/.openclaude.json (per-project MCP config) ──
  // OpenClaude CLI reads MCP config from ~/.openclaude.json → projects[cwd].mcpServers
  // NOT from .mcp.json in CWD. Must be updated on every MCP restart so all workspaces
  // point to the correct port.
  try {
    const openClaudeConfigPath = path.join(os.homedir(), ".openclaude.json");
    let openClaudeConfig: Record<string, any> = {};
    try { openClaudeConfig = JSON.parse(fs.readFileSync(openClaudeConfigPath, "utf-8")); } catch {}
    if (!openClaudeConfig.projects) openClaudeConfig.projects = {};
    let updated = 0;
    for (const wsPath of wsSet) {
      const projectKey = wsPath.replace(/\\/g, "/");
      if (!openClaudeConfig.projects[projectKey]) openClaudeConfig.projects[projectKey] = {};
      if (!openClaudeConfig.projects[projectKey].mcpServers) openClaudeConfig.projects[projectKey].mcpServers = {};
      const existing = openClaudeConfig.projects[projectKey].mcpServers.codebrain;
      if (!existing || existing.url !== httpUrl) {
        openClaudeConfig.projects[projectKey].mcpServers.codebrain = {
          type: "http",
          url: httpUrl,
        };
        updated++;
      }
    }
    if (updated > 0) {
      fs.writeFileSync(openClaudeConfigPath, JSON.stringify(openClaudeConfig, null, 2), "utf-8");
      console.log(`[refreshAllWorkspaces] Updated ~/.openclaude.json for ${updated} project(s)`);
    }
  } catch (err) {
    console.warn("[refreshAllWorkspaces] Failed to update ~/.openclaude.json:", err);
  }

  // ── Claude Code: ~/.claude.json (per-project MCP config) ──
  // Claude Code reads from ~/.claude.json → projects[cwd].mcpServers
  // in addition to .mcp.json in CWD. Updating here ensures Claude Code
  // agents always find the MCP server after a restart/port change.
  try {
    const claudeJsonPath = path.join(os.homedir(), ".claude.json");
    let claudeJson: Record<string, any> = {};
    try { claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8")); } catch {}
    if (!claudeJson.projects) claudeJson.projects = {};
    let updated = 0;
    for (const wsPath of wsSet) {
      const projectKey = wsPath.replace(/\\/g, "/");
      if (!claudeJson.projects[projectKey]) claudeJson.projects[projectKey] = {};
      if (!claudeJson.projects[projectKey].mcpServers) claudeJson.projects[projectKey].mcpServers = {};
      const existing = claudeJson.projects[projectKey].mcpServers.codebrain;
      if (!existing || existing.url !== httpUrl) {
        claudeJson.projects[projectKey].mcpServers.codebrain = {
          type: "streamable-http",
          url: httpUrl,
        };
        updated++;
      }
    }
    if (updated > 0) {
      fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2), "utf-8");
      console.log(`[refreshAllWorkspaces] Updated ~/.claude.json for ${updated} project(s)`);
    }
  } catch (err) {
    console.warn("[refreshAllWorkspaces] Failed to update ~/.claude.json:", err);
  }

  // ── Global CLI agent configs (one-time per refresh) ──
  // Update ~/.kimi/config.toml, ~/.gemini/settings.json, ~/.codex/config.toml
  // so ALL agents auto-connect to Codebrain MCP with correct transport.

  // Kimi: ~/.kimi/config.toml (legacy) + ~/.kimi-code/config.toml (v0.6+)
  for (const kimiDir of [".kimi", ".kimi-code"]) {
    try {
      const kimiConfigPath = path.join(os.homedir(), kimiDir, "config.toml");
      const kimiDirPath = path.join(os.homedir(), kimiDir);
      if (!fs.existsSync(kimiDirPath)) fs.mkdirSync(kimiDirPath, { recursive: true });
      let configText = "";
      try { configText = fs.readFileSync(kimiConfigPath, "utf-8"); } catch {}
      // Remove existing codebrain block
      configText = configText.replace(/\[mcp_servers\.codebrain\][^\[]*/g, "").trimEnd();
      // Add HTTP transport block
      configText += `\n\n[mcp_servers.codebrain]\nurl = "${httpUrl}"\ntype = "http"\ndefault_tools_approval_mode = "approve"\n`;
      fs.writeFileSync(kimiConfigPath, configText, "utf-8");
      console.log(`[refreshAllWorkspaces] Updated Kimi config: ${kimiConfigPath}`);
    } catch (err) {
      console.warn(`[refreshAllWorkspaces] Failed to update Kimi config (${kimiDir}):`, err);
    }
  }

  // Gemini: ~/.gemini/settings.json
  try {
    const geminiSettingsPath = path.join(os.homedir(), ".gemini", "settings.json");
    const geminiDir = path.join(os.homedir(), ".gemini");
    if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
    let settings: Record<string, any> = {};
    try { settings = JSON.parse(fs.readFileSync(geminiSettingsPath, "utf-8")); } catch {}
    settings.mcpServers = {
      ...(settings.mcpServers || {}),
      codebrain: { url: httpUrl, type: "http" },
    };
    const tmpPath = `${geminiSettingsPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, geminiSettingsPath);
    console.log(`[refreshAllWorkspaces] Updated Gemini config: ${geminiSettingsPath}`);
  } catch (err) {
    console.warn("[refreshAllWorkspaces] Failed to update Gemini config:", err);
  }

  // Codex: ~/.codex/config.toml — inject [mcp_servers.codebrain] if missing
  try {
    const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
    if (fs.existsSync(codexConfigPath)) {
      let toml = fs.readFileSync(codexConfigPath, "utf-8");
      // Only add if not already present (Codex also injects via -c flag at spawn time)
      if (!toml.includes("[mcp_servers.codebrain]")) {
        toml = toml.trimEnd() + `\n\n[mcp_servers.codebrain]\nurl = "${httpUrl}"\ntype = "http"\n`;
        fs.writeFileSync(codexConfigPath, toml, "utf-8");
        console.log(`[refreshAllWorkspaces] Added codebrain MCP to Codex config: ${codexConfigPath}`);
      } else {
        // Update existing block with correct URL
        toml = toml.replace(/\[mcp_servers\.codebrain\][\s\S]*?(?=\n\[|$)/, `\n[mcp_servers.codebrain]\nurl = "${httpUrl}"\ntype = "http"\n`);
        fs.writeFileSync(codexConfigPath, toml, "utf-8");
        console.log(`[refreshAllWorkspaces] Updated Codex config: ${codexConfigPath}`);
      }
    }
  } catch (err) {
    console.warn("[refreshAllWorkspaces] Failed to update Codex config:", err);
  }

  console.log(`[refreshAllWorkspaces] Done — refreshed ${wsSet.size} workspace(s) + global configs`);
}

/**
 * Remove any leftover codebrain MCP entry from ~/.codex/config.toml.
 * Called on startup to clean up stale entries from previous sessions
 * (e.g. if the app crashed without running before-quit cleanup).
 * The MCP is injected via -c flag at spawn time instead (Overclock pattern).
 */
export function clearCodexGlobalConfig(): void {
  try {
    const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
    if (!fs.existsSync(codexConfigPath)) return;
    let toml = fs.readFileSync(codexConfigPath, "utf-8");
    if (!toml.includes("[mcp_servers.codebrain]")) return;
    // Remove the section and its contents up to the next section or end of file
    toml = toml.replace(/\n?\[mcp_servers\.codebrain\][\s\S]*?(?=\n\[|$)/, "");
    fs.writeFileSync(codexConfigPath, toml, "utf-8");
    console.log("[clearCodexGlobalConfig] Removed stale codebrain entry from ~/.codex/config.toml");
  } catch (err) {
    console.warn("[clearCodexGlobalConfig] Failed:", err);
  }
}
