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
import { MODEL_MAP_BY_TYPE } from "../constants";

const ENHANCED_MODEL_MAP = MODEL_MAP_BY_TYPE;

// Read version from package.json once at module load
let _appVersion = "?";
try {
  const pkgPath = path.join(__dirname, "../../../../package.json");
  _appVersion = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? "?";
} catch {}

/** Total MCP tools registered — updated at import time from the MCP index. */
const MCP_TOOL_COUNT: number = (() => {
  try {
    // Count server.tool() calls in the MCP index — this is the source of truth.
    const indexSrc = fs.readFileSync(
      path.join(__dirname, "../../../../packages/mcp/index.js"),
      "utf-8",
    );
    return (indexSrc.match(/server\.tool\(/g) ?? []).length;
  } catch {
    return 0;
  }
})();

export interface PromptBuilderConfig {
  paneId: string;
  cwd: string;
  model?: string;
  role?: string;
  sessionContext?: string;
}

interface SkillManifest {
  id: string;
  name: string;
  type: string;
  description?: string;
  triggers?: string[];
}

/**
 * Reads installed skills from project (.codebrain/skills/) and global (~/.codebrain/skills/)
 * and builds a system prompt section so every agent knows which skills are available
 * and uses them automatically based on triggers.
 */
function buildSkillsSection(cwd: string): string {
  const skillDirs: string[] = [];

  // Project-local skills
  const projectSkillsDir = path.join(cwd || "", ".codebrain", "skills");
  if (fs.existsSync(projectSkillsDir)) skillDirs.push(projectSkillsDir);

  // Global skills (~/.codebrain/skills/)
  const globalSkillsDir = path.join(os.homedir(), ".codebrain", "skills");
  if (fs.existsSync(globalSkillsDir)) skillDirs.push(globalSkillsDir);

  const skills: SkillManifest[] = [];
  for (const dir of skillDirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const manifestPath = path.join(dir, entry, "skill.json");
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          if (manifest.id && !skills.find(s => s.id === manifest.id)) {
            skills.push(manifest);
          }
        } catch {}
      }
    } catch {}
  }

  if (skills.length === 0) return "";

  const rows = skills
    .map(s => {
      const triggers = (s.triggers ?? []).join(", ") || "—";
      return `| \`${s.id}\` | ${s.description ?? s.name} | ${triggers} |`;
    })
    .join("\n");

  return `\n\n## Skills Disponíveis — USE AUTOMATICAMENTE

Você tem skills especializadas. **SEMPRE invoque a skill correta via \`Skill()\` tool ANTES de responder**, sem esperar o usuário pedir. Detecte pela intenção do pedido:

| Skill | Descrição | Triggers (palavras-chave) |
|---|---|---|
${rows}

**REGRA OBRIGATÓRIA:** Se o pedido do usuário corresponder a qualquer trigger acima → invoque imediatamente com \`Skill({ skill: "id-da-skill" })\`. Não pergunte, não explique — invoque direto.`;
}

/**
 * Builds the Codebrain system prompt and writes it to a temp file.
 * Returns the path to pass via --system-prompt-file.
 */
export function buildSystemPrompt(ctx: AppContext, config: PromptBuilderConfig): string {
  const { paneId, cwd, model, role, sessionContext } = config;

  const allProviders = ctx.providerStore.listFull();
  const configuredProviders = allProviders.filter((p: any) => p.id !== "claude-oauth");

  // Dynamic workspace section
  let sysPrompt = CODEBRAIN_SYSTEM_PROMPT;
  sysPrompt += `\n\n## Seu Workspace\n\nVocê está trabalhando no diretório:\n\`${cwd}\`\n\nTodos os caminhos de arquivo são relativos a este diretório.`;
  sysPrompt += `\n\n## Seu ID de Pane\n\nSeu paneId é: \`${paneId}\`\n\nUse este ID como campo "from" ao enviar mensagens via pane_send_message, e como campo "paneId" ao ler mensagens via pane_read_messages.`;

  // Role-specific prompt
  let rolePrompt = "";
  if (role === "orchestrator") {
    rolePrompt = ORCHESTRATOR_PROMPT;
  } else if (role === "ui-tester") {
    rolePrompt = UI_TESTER_PROMPT || WORKER_PROMPT;
  } else if (model?.startsWith("gemini")) {
    rolePrompt = GEMINI_WORKER_PROMPT || WORKER_PROMPT;
  } else {
    rolePrompt = WORKER_PROMPT;
  }
  if (rolePrompt) sysPrompt += `\n\n---\n\n${rolePrompt}`;
  if (sessionContext) sysPrompt += `\n\n---\n\n${sessionContext}`;

  // Providers section — clean format for user-facing questions
  const providersInfo = configuredProviders
    .map((p: any) => {
      const enhanced = ENHANCED_MODEL_MAP[p.type ?? ""];
      const models = (enhanced?.length > 0 ? enhanced : p.models)?.join(", ") || "nenhum modelo listado";
      return `* **${p.label}** (${p.type}): ${models}`;
    })
    .join("\n") || "nenhum provider configurado";
  sysPrompt += `\n\n## Providers e Modelos Disponíveis\n\n${providersInfo}\n\nQuando perguntar ao usuário qual modelo usar, apresente esta lista acima de forma clara (sem ids técnicos). O usuário escolhe por nome legível (ex: "haiku", "opus", "mimo v2.5 pro").`;

  // Spawn guide with real provider data
  const spawnModels = configuredProviders
    .map((p: any) => {
      const enhanced = ENHANCED_MODEL_MAP[p.type ?? ""];
      const models: string[] = (enhanced?.length > 0 ? enhanced : p.models) ?? [];
      const agentBin = p.host || "openclaude";
      return models.map((m: string) => `  - **${m}** → providerId: "${p.id}", agent: "${agentBin}"`).join("\n");
    })
    .filter(Boolean)
    .join("\n");

  sysPrompt += `\n\n## Spawning Novos Panes (Agentes)\n\nQuando o usuário pedir para spawnar, abrir, ou criar um novo agente/terminal/pane, use:\n\n\`\`\`javascript\nmcp__codebrain__pane_spawn({\n  agent: "<agent>",      // "openclaude" | "claude" | "gemini" | "shell"\n  model: "<model>",      // modelo específico (veja abaixo)\n  label: "<nome>",       // label opcional para identificar\n  cwd: "<workspace>"     // workspace atual\n})\n\`\`\`\n\n**⚠️ PRIORIDADE ao escolher agente:**\n1. **Modelos Claude (haiku, sonnet, opus)** → \`agent: "claude"\` (Claude Code CLI oficial com OAuth do plano. O sistema detecta o CLI automaticamente.)\n2. **Modelos MIMO** → \`agent: "openclaude"\` com provider MIMO\n3. **Modelos Gemini** → \`agent: "openclaude"\` com provider Gemini\n4. **Padrão (sem especificar)** → \`openclaude\` com o primeiro provider disponível\n5. **NUNCA use \`shell\`** para agentes de IA\n\n**Agentes disponíveis:**\n- \`claude\` — Claude Code CLI oficial (OAuth plano, auto-detectado). Para modelos Claude (haiku/sonnet/opus).\n- \`openclaude\` — OpenClaude CLI (MIMO, Gemini, Anthropic API, etc). Para MIMO e Gemini.\n- \`gemini\` — Google Gemini CLI\n- \`shell\` — Terminal shell puro. SOMENTE para comandos de sistema.\n\n**Modelos → Parâmetros de spawn:**\n\n${spawnModels}\n\n**Exemplos:**\n- Claude Haiku (plano): \`pane_spawn({ agent: "claude", model: "claude-haiku-4-5-20251001" })\`\n- Claude Opus (plano): \`pane_spawn({ agent: "claude", model: "claude-opus-4-7" })\`\n- MIMO 2.5 Pro: \`pane_spawn({ agent: "openclaude", model: "mimo-v2.5-pro" })\`\n- Gemini Flash: \`pane_spawn({ agent: "openclaude", model: "gemini-2.5-flash" })\`\n- Shell puro: \`pane_spawn({ agent: "shell" })\``;

  // Runtime metadata injected so the skill banner shows real values
  const providerLabels = configuredProviders.map((p: any) => `${p.host || "openclaude"} (${p.type})`).join(", ") || "none";
  sysPrompt += `\n\n## Codebrain Runtime\n\n- Version: ${_appVersion}\n- MCP Tools: ${MCP_TOOL_COUNT}\n- Providers: ${providerLabels}`;

  // Skills section — inject all installed skills so every agent knows them
  sysPrompt += buildSkillsSection(cwd);

  // Write to temp file (avoids Windows cmd-line length limit)
  const tmpDir = path.join(cwd || os.homedir(), ".codebrain", "tmp");
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const promptFile = path.join(tmpDir, `sysprompt-${paneId}.txt`);
  fs.writeFileSync(promptFile, sysPrompt, "utf-8");
  return promptFile;
}
