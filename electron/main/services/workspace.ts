import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";

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
