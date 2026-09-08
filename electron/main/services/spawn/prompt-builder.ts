import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AppContext } from "../../context";
import {
  CODEBRAIN_SYSTEM_PROMPT,
  WORKER_PROMPT,
  ORCHESTRATOR_PROMPT,
  UI_TESTER_PROMPT,
  GEMINI_WORKER_PROMPT,
} from "../prompts";
import { workspaceAccessInstruction } from "../../workspace-config-store";

export interface PromptBuilderConfig {
  paneId: string;
  cwd: string;
  model?: string;
  role?: string;
  sessionContext?: string;
  agent?: string;
  squadCallable?: object[];
  orchestratorInstructions?: string;
}
interface SkillManifest {
  id: string;
  name: string;
  description?: string;
  triggers?: string[];
}

function loadSkills(cwd: string): SkillManifest[] {
  const dirs = [
    path.join(cwd || "", ".codebrain", "skills"),
    path.join(os.homedir(), ".codebrain", "skills"),
  ];
  const skills: SkillManifest[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        const file = path.join(dir, entry, "skill.json");
        if (!fs.existsSync(file)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(file, "utf-8")) as SkillManifest;
          if (!manifest.id || seen.has(manifest.id)) continue;
          seen.add(manifest.id);
          skills.push(manifest);
        } catch {}
      }
    } catch {}
  }
  return skills;
}

function buildSkillsSection(cwd: string): string {
  const skills = loadSkills(cwd);
  if (skills.length === 0) return "";
  const rows = skills.map((skill) => {
    const triggers = skill.triggers?.join(", ") || "-";
    return `| \`${skill.id}\` | ${skill.description || skill.name} | ${triggers} |`;
  }).join("\n");

  return `\n\n## Skills (lazy)\nLoad a matching skill with \`skill_get({ id })\` before using it.\n\n| Skill | Description | Triggers |\n|---|---|---|\n${rows}`;
}

function buildActiveAgentsContext(ctx: AppContext, workspace: string, ownPaneId: string): string {
  try {
    const panes = ctx.ptyManager.list().filter((pane: any) => {
      if (pane.paneId === ownPaneId || ctx.detachedPaneIds.has(pane.paneId)) return false;
      const paneWorkspace = pane.workspacePath ?? pane.cwd ?? "";
      return paneWorkspace && workspace && path.resolve(paneWorkspace) === path.resolve(workspace);
    });
    if (panes.length === 0) return "";
    return `\n\n## Active panes\n${panes.map((pane: any) => `- ${pane.label || pane.agent || "agent"} · ${pane.paneId}`).join("\n")}\nUse \`pane_send_message\` for short updates.`;
  } catch {
    return "";
  }
}

function buildMemoryContext(): string {
  return "\n\n## Shared context\nFor non-trivial work, call `memory_search` and `pattern_list` once before acting. Skip them for greetings and simple factual replies. Save durable decisions, fixes and results with `memory_write`; save reusable conventions with `pattern_write`.";
}

function buildProviderHint(ctx: AppContext): string {
  try {
    const providers = ctx.providerStore.listFull()
      .filter((provider: any) => provider.id !== "claude-oauth")
      .map((provider: any) => `${provider.label || provider.id} (${provider.id})`);
    return providers.length ? `\n\nProviders configured: ${providers.join(", ")}. Use the pane_spawn schema for model details.` : "";
  } catch {
    return "";
  }
}

function buildOrchestratorContext(paneId: string, ctx: AppContext, squadCallable?: object[], instructions?: string): string {
  let block = `\n\n## Orchestrator runtime\nFor delegation, activate \`coordination\`, inspect \`actor_list\`, reuse an idle compatible worker, then \`task_create\` → \`task_assign\` → \`pane_write\`. Never edit files yourself.\nYour paneId is \`${paneId}\`.\n`;
  block += buildProviderHint(ctx);
  if (squadCallable?.length) {
    block += `\n\nSquad workers available (pass the list to pane_spawn):\n\`${JSON.stringify(squadCallable)}\``;
  }
  if (instructions?.trim()) block += `\n\nSquad instructions:\n${instructions.trim()}`;
  return block;
}

function buildDelegatedWorkerContext(paneId: string): string {
  return `\n\n## Delegated tasks\nDirect conversation needs no bootstrap. When a delegated task arrives, activate \`coordination\`, then call \`mission_context({ paneId: "${paneId}" })\` and \`task_list\`; claim the assigned task before editing. Complete with \`handoff_submit\`.`;
}

/** Builds the smallest useful system prompt for a pane and writes it to disk. */
export function buildSystemPrompt(ctx: AppContext, config: PromptBuilderConfig): string {
  const { paneId, cwd, model, role, sessionContext, squadCallable, orchestratorInstructions } = config;
  let sysPrompt = CODEBRAIN_SYSTEM_PROMPT;

  sysPrompt += `\n\n## Workspace\n\`${cwd}\`\nPane: \`${paneId}\``;
  sysPrompt += buildMemoryContext();
  sysPrompt += buildActiveAgentsContext(ctx, cwd, paneId);

  const accessMode = ctx.workspaceConfigStore.getAccessMode(cwd);
  sysPrompt += `\n\n## Workspace access\n${workspaceAccessInstruction(cwd, accessMode)}`;

  const rolePrompt = role === "orchestrator"
    ? ORCHESTRATOR_PROMPT
    : role === "ui-tester"
      ? UI_TESTER_PROMPT || WORKER_PROMPT
      : model?.startsWith("gemini")
        ? GEMINI_WORKER_PROMPT || WORKER_PROMPT
        : WORKER_PROMPT;
  if (rolePrompt) sysPrompt += `\n\n${rolePrompt}`;
  if (sessionContext?.trim()) sysPrompt += `\n\n## Session context\n${sessionContext.trim()}`;

  if (role === "orchestrator") {
    sysPrompt += buildOrchestratorContext(paneId, ctx, squadCallable, orchestratorInstructions);
  } else {
    sysPrompt += buildDelegatedWorkerContext(paneId);
  }

  sysPrompt += buildSkillsSection(cwd);

  const tmpDir = path.join(cwd || os.homedir(), ".codebrain", "tmp");
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const promptFile = path.join(tmpDir, `sysprompt-${paneId}.txt`);
  fs.writeFileSync(promptFile, sysPrompt, "utf-8");
  return promptFile;
}
