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

  // Providers section
  const providersInfo = configuredProviders
    .map((p: any) => {
      const enhanced = ENHANCED_MODEL_MAP[p.type ?? ""];
      const models = (enhanced?.length > 0 ? enhanced : p.models)?.join(", ") || "nenhum modelo listado";
      return `* ${p.label} (id: "${p.id}", type: "${p.type}"): ${models}`;
    })
    .join("\n") || "nenhum provider configurado";
  sysPrompt += `\n\n## Providers e Modelos Disponíveis\n\n${providersInfo}`;

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

  sysPrompt += `\n\n## Spawning Novos Panes (Agentes)\n\nQuando o usuário pedir para spawnar, abrir, ou criar um novo agente/terminal/pane, use:\n\n\`\`\`javascript\nmcp__codebrain__pane_spawn({\n  agent: "<agent>",      // "openclaude" | "claude" | "gemini" | "shell"\n  providerId: "<id>",    // id do provider (veja abaixo)\n  model: "<model>",      // modelo específico (veja abaixo)\n  label: "<nome>",       // label opcional para identificar\n  cwd: "<workspace>"     // workspace atual\n})\n\`\`\`\n\n**⚠️ PRIORIDADE ao escolher agente:**\n1. **Padrão (sem especificar)** → \`openclaude\` com o primeiro provider disponível (MIMO > Gemini > outro). NUNCA use \`shell\` quando o usuário pede um agente de IA.\n2. **"claude plano" / "claude direto" / "plano"** → \`agent: "claude"\` (Claude Code CLI oficial, OAuth nativo, SEM openclaude)\n3. **Nome de modelo como "claude-sonnet", "opus"** → use \`openclaude\` com o provider Anthropic. O nome do modelo NÃO troca o agente.\n\n**Agentes disponíveis:**\n- \`openclaude\` — OpenClaude CLI (usa providers configurados: MIMO, Gemini, Anthropic, OpenAI, etc). **USE ESTE POR PADRÃO.**\n- \`claude\` — Claude Code CLI oficial — SOMENTE quando usuário diz "plano" ou "claude direto"\n- \`gemini\` — Google Gemini CLI\n- \`shell\` — Terminal shell puro (bash/cmd). **SOMENTE para comandos de sistema, NUNCA para agentes de IA.**\n\n**Modelos → Parâmetros de spawn:**\n\n${spawnModels}\n\n**Exemplos:**\n- MIMO 2.5 Pro (padrão): \`pane_spawn({ agent: "openclaude", providerId: "mimo", model: "mimo-v2.5-pro" })\`\n- Claude Sonnet via API: \`pane_spawn({ agent: "openclaude", providerId: "anthropic", model: "claude-sonnet-4-6" })\`\n- Claude direto do plano: \`pane_spawn({ agent: "claude", model: "claude-sonnet-4-6" })\`\n- Gemini Flash: \`pane_spawn({ agent: "openclaude", providerId: "gemini", model: "gemini-2.5-flash" })\`\n- Shell puro: \`pane_spawn({ agent: "shell" })\``;

  // Runtime metadata injected so the skill banner shows real values
  const providerLabels = configuredProviders.map((p: any) => `${p.host || "openclaude"} (${p.type})`).join(", ") || "none";
  sysPrompt += `\n\n## Codebrain Runtime\n\n- Version: ${_appVersion}\n- MCP Tools: ${MCP_TOOL_COUNT}\n- Providers: ${providerLabels}`;

  // Write to temp file (avoids Windows cmd-line length limit)
  const tmpDir = path.join(cwd || os.homedir(), ".codebrain", "tmp");
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const promptFile = path.join(tmpDir, `sysprompt-${paneId}.txt`);
  fs.writeFileSync(promptFile, sysPrompt, "utf-8");
  return promptFile;
}
