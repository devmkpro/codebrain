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
import { workspaceAccessInstruction } from "../../workspace-config-store";

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
  agent?: string;
}

interface SkillManifest {
  id: string;
  name: string;
  type: string;
  description?: string;
  triggers?: string[];
  entrypoint?: string;
}

interface LoadedSkill {
  manifest: SkillManifest;
  content: string | null; // prompt.md content, null if unreadable
}

/**
 * Reads skills from all skill directories in priority order:
 *   1. Project-local:  <cwd>/.codebrain/skills/
 *   2. Global:         ~/.codebrain/skills/
 *
 * Deduplicates by skill id (project takes priority over global).
 * Returns both manifest and full prompt.md content for each skill.
 */
function loadSkills(cwd: string): LoadedSkill[] {
  const skillDirs: string[] = [];

  // 1. Project-local skills
  const projectSkillsDir = path.join(cwd || "", ".codebrain", "skills");
  if (fs.existsSync(projectSkillsDir)) skillDirs.push(projectSkillsDir);

  // 2. Global skills (~/.codebrain/skills/)
  const globalSkillsDir = path.join(os.homedir(), ".codebrain", "skills");
  if (fs.existsSync(globalSkillsDir)) skillDirs.push(globalSkillsDir);

  const loaded: LoadedSkill[] = [];
  const seenIds = new Set<string>();

  for (const dir of skillDirs) {
    try {
      for (const entry of fs.readdirSync(dir)) {
        const skillDir = path.join(dir, entry);
        const manifestPath = path.join(skillDir, "skill.json");
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest: SkillManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          if (!manifest.id || seenIds.has(manifest.id)) continue;
          seenIds.add(manifest.id);

          // Read prompt content
          const entrypoint = manifest.entrypoint ?? "prompt.md";
          const promptPath = path.join(skillDir, entrypoint);
          let content: string | null = null;
          try {
            if (fs.existsSync(promptPath)) content = fs.readFileSync(promptPath, "utf-8");
          } catch {}

          loaded.push({ manifest, content });
        } catch {}
      }
    } catch {}
  }

  return loaded;
}

/**
 * Builds the skills section of the system prompt.
 *
 * Strategy differs by agent:
 * - Claude Code CLI ("claude"): has the native Skill() tool that reads ~/.claude/skills/*.md
 *   → inject summary table + Skill() invocation instructions only (content already synced)
 * - All other CLIs (openclaude, gemini, codex, etc.): no Skill() tool
 *   → inject the FULL prompt.md content of each skill inline so the agent can execute it
 */
function buildSkillsSection(cwd: string, agent?: string): string {
  const skills = loadSkills(cwd);
  if (skills.length === 0) return "";

  const isClaudeCodeCli = agent === "claude";

  // Summary table — used by all agents
  const rows = skills
    .map(s => {
      const triggers = (s.manifest.triggers ?? []).join(", ") || "—";
      return `| \`${s.manifest.id}\` | ${s.manifest.description ?? s.manifest.name} | ${triggers} |`;
    })
    .join("\n");

  if (isClaudeCodeCli) {
    // Claude Code has Skill() tool — just the table + invocation rule
    return `\n\n## Skills Disponíveis — USE AUTOMATICAMENTE

Você tem skills especializadas. **SEMPRE invoque a skill correta via \`Skill()\` tool ANTES de responder**, sem esperar o usuário pedir. Detecte pela intenção do pedido:

| Skill | Descrição | Triggers (palavras-chave) |
|---|---|---|
${rows}

**REGRA OBRIGATÓRIA:** Se o pedido do usuário corresponder a qualquer trigger acima → invoque imediatamente com \`Skill({ skill: "id-da-skill" })\`. Não pergunte, não explique — invoque direto.`;
  }

  // Non-Claude-Code CLIs: inject full skill content inline
  // The agent executes the skill steps directly from the prompt.
  let section = `\n\n## Skills Disponíveis — EXECUTE AUTOMATICAMENTE

Você tem skills especializadas com guias completos abaixo. **Ao detectar um trigger, execute diretamente os passos da skill correspondente** sem esperar o usuário pedir.

| Skill | Descrição | Triggers (palavras-chave) |
|---|---|---|
${rows}

**REGRA OBRIGATÓRIA:** Se o pedido do usuário corresponder a qualquer trigger → execute imediatamente os passos da skill. Não pergunte, não explique — execute direto.

---

`;

  for (const { manifest, content } of skills) {
    if (!content) continue;
    const triggers = (manifest.triggers ?? []).join(", ") || "—";
    section += `### Skill: \`${manifest.id}\` — ${manifest.description ?? manifest.name}\n`;
    section += `**Triggers:** ${triggers}\n\n`;
    section += content.trim();
    section += "\n\n---\n\n";
  }

  return section;
}

/**
 * Lists active agents in the same workspace so the new agent knows its teammates
 * and can coordinate from the start.
 */
function buildActiveAgentsContext(ctx: AppContext, workspace: string, ownPaneId: string): string {
  try {
    const livePanes = ctx.ptyManager.list().filter((p: any) => {
      if (p.paneId === ownPaneId) return false; // skip self
      if (ctx.detachedPaneIds.has(p.paneId)) return false;
      const paneWs = p.workspacePath ?? p.cwd ?? "";
      if (paneWs && workspace) {
        try {
          const path = require("node:path");
          return path.resolve(paneWs) === path.resolve(workspace);
        } catch { return false; }
      }
      return false;
    });

    if (livePanes.length === 0) return "";

    let block = `\n\n## Agentes Ativos no Workspace — SEUS COLEGAS

Os seguintes agentes estão ativos agora no mesmo workspace. Coordene com eles via \`pane_send_message\`:

`;

    for (const p of livePanes) {
      const label = (p as any).label || p.agent || "agente";
      const model = p.model ? ` [${p.model}]` : "";
      const status = (p as any).status || "running";
      block += `- **${label}**${model} — paneId: \`${p.paneId}\` (${status})\n`;
    }

    block += `
**REGRA:** Quando finalizar sua tarefa, envie um resumo aos colegas via \`pane_send_message\`. Quando receber mensagem de um colega, responda imediatamente. Use \`pane_list()\` para ver o status atual dos panes.
`;

    return block;
  } catch {
    return "";
  }
}

/**
 * Reads existing memories and patterns for the workspace and builds a
 * context block that is injected into the system prompt — forces agents
 * to be aware of shared knowledge from the start.
 */
function buildMemoryContext(ctx: AppContext, workspace: string): string {
  try {
    const store = ctx.memoryStore as any;

    // Fetch recent memories for this workspace (semantic + episodic + procedural)
    const memResult = store.list({ workspace, limit: 20 });
    const memories: any[] = memResult?.memories ?? [];

    // Fetch top patterns (sorted by quality_score DESC in the store)
    const patResult = store.listPatterns({ limit: 15 });
    const patterns: any[] = patResult?.patterns ?? [];

    if (memories.length === 0 && patterns.length === 0) {
      // Even with no memories yet, enforce the read-first protocol
      return `\n\n## Memória Compartilhada do Workspace\n\n> **REGRA OBRIGATÓRIA:** Antes de iniciar QUALQUER tarefa, execute:\n> \`\`\`\n> mcp__codebrain__memory_search({ query: "<palavras-chave da tarefa>" })\n> mcp__codebrain__pattern_list({})\n> \`\`\`\n> A memória compartilhada é o único mecanismo de coordenação entre agentes no mesmo workspace. Ignorar este passo causa conflitos e retrabalho.\n\nNenhuma memória ou pattern registrado ainda para este workspace. Você é o primeiro agente aqui — comece a gravar descobertas com \`memory_write\` e patterns com \`pattern_write\`.`;
    }

    let block = `\n\n## Memória Compartilhada do Workspace — LEIA ANTES DE AGIR

> **REGRA OBRIGATÓRIA:** Você DEVE consultar \`mcp__codebrain__memory_search\` e \`mcp__codebrain__pattern_list\` ANTES de iniciar qualquer tarefa. Nunca repita trabalho que já está na memória. Sempre grave descobertas importantes via \`mcp__codebrain__memory_write\`.

### Contexto atual do workspace \`${workspace}\`

`;

    if (memories.length > 0) {
      block += `**Memórias recentes (${memories.length}):**\n`;
      for (const m of memories) {
        const tags = (m.tags ?? []).length > 0 ? ` [${m.tags.join(", ")}]` : "";
        const preview = (m.content ?? "").slice(0, 200).replace(/\n/g, " ");
        block += `- **[${m.type ?? "working"}]** \`${m.key ?? m.id}\`${tags}: ${preview}${m.content?.length > 200 ? "…" : ""}\n`;
      }
    }

    if (patterns.length > 0) {
      block += `\n**Patterns aprendidos (${patterns.length}) — USE-OS:**\n`;
      for (const p of patterns) {
        const score = typeof p.quality_score === "number" ? ` (score: ${p.quality_score.toFixed(2)})` : "";
        const preview = (p.description ?? "").slice(0, 180).replace(/\n/g, " ");
        block += `- **[${p.pattern_type ?? "general"}]**${score}: ${preview}${p.description?.length > 180 ? "…" : ""}\n`;
      }
    }

    block += `
**PROTOCOLO OBRIGATÓRIO:**
1. **INÍCIO DE CADA TAREFA** → chame \`memory_search\` com palavras-chave relevantes + \`pattern_list\` para ver padrões aplicáveis
2. **DURANTE A TAREFA** → ao descobrir algo importante, grave imediatamente com \`memory_write\`
3. **FIM DE CADA TAREFA** → grave o resultado e lições aprendidas; se descobriu um padrão útil, grave com \`pattern_write\`
4. **NUNCA** comece uma tarefa sem antes verificar se já existe solução na memória
`;

    return block;
  } catch {
    return "";
  }
}

/**
 * Builds the Codebrain system prompt and writes it to a temp file.
 * Returns the path to pass via --system-prompt-file.
 */
export function buildSystemPrompt(ctx: AppContext, config: PromptBuilderConfig): string {
  const { paneId, cwd, model, role, sessionContext, agent } = config;

  const allProviders = ctx.providerStore.listFull();
  const configuredProviders = allProviders.filter((p: any) => p.id !== "claude-oauth");

  // Dynamic workspace section
  let sysPrompt = CODEBRAIN_SYSTEM_PROMPT;
  sysPrompt += `\n\n## Seu Workspace\n\nVocê está trabalhando no diretório:\n\`${cwd}\`\n\nTodos os caminhos de arquivo são relativos a este diretório.`;
  sysPrompt += `\n\n## Seu ID de Pane\n\nSeu paneId é: \`${paneId}\`\n\nUse este ID como campo "from" ao enviar mensagens via pane_send_message, e como campo "paneId" ao ler mensagens via pane_read_messages.`;

  // Inject shared memory + patterns — forces agents to read and reuse knowledge
  sysPrompt += buildMemoryContext(ctx, cwd);

  // Inject active agents in the workspace so this agent knows its teammates
  sysPrompt += buildActiveAgentsContext(ctx, cwd, paneId);

  // Workspace access policy — sandbox for file operations outside workspace
  const accessMode = ctx.workspaceConfigStore.getAccessMode(cwd);
  sysPrompt += `\n\n## Workspace Access Policy\n\n${workspaceAccessInstruction(cwd, accessMode)}`;

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

  sysPrompt += `\n\n## Spawning Novos Panes (Agentes)\n\nQuando o usuário pedir para spawnar, abrir, ou criar um novo agente/terminal/pane, use:\n\n\`\`\`javascript\nmcp__codebrain__pane_spawn({\n  agent: "<agent>",      // "openclaude" | "claude" | "gemini" | "codex" | "shell"\n  model: "<model>",      // modelo específico (veja abaixo)\n  label: "<nome>",       // label opcional para identificar\n  cwd: "<workspace>"     // workspace atual\n})\n\`\`\`\n\n**⚠️ PRIORIDADE ao escolher agente:**\n1. **Modelos Claude (haiku, sonnet, opus)** → \`agent: "claude"\` (Claude Code CLI oficial com OAuth do plano. O sistema detecta o CLI automaticamente.)\n2. **Modelos MIMO** → \`agent: "openclaude"\` com provider MIMO\n3. **Modelos Gemini via API** → \`agent: "openclaude"\` com provider Gemini\n4. **Gemini CLI nativo** (usuário pediu explicitamente "gemini cli") → \`agent: "gemini"\` com providerId: "gemini-cli"\n5. **Modelos OpenAI / Codex** → \`agent: "codex"\` com provider Codex\n6. **Padrão (sem especificar)** → \`openclaude\` com o primeiro provider disponível\n7. **NUNCA use \`shell\`** para agentes de IA\n\n**Agentes disponíveis:**\n- \`claude\` — Claude Code CLI oficial (OAuth plano, auto-detectado). Para modelos Claude (haiku/sonnet/opus).\n- \`openclaude\` — OpenClaude CLI (MIMO, Gemini API, Anthropic API, etc). Padrão para maioria dos modelos.\n- \`gemini\` — Google Gemini CLI nativo. Use SOMENTE quando o usuário pedir explicitamente "gemini cli".\n- \`codex\` — OpenAI Codex CLI. Use quando o usuário pedir modelos OpenAI ou codex.\n- \`shell\` — Terminal shell puro. SOMENTE para comandos de sistema.\n\n**Modelos → Parâmetros de spawn:**\n\n${spawnModels}\n\n**Exemplos:**\n- Claude Haiku (plano): \`pane_spawn({ agent: "claude", model: "claude-haiku-4-5-20251001" })\`\n- Claude Opus (plano): \`pane_spawn({ agent: "claude", model: "claude-opus-4-7" })\`\n- MIMO 2.5 Pro: \`pane_spawn({ agent: "openclaude", model: "mimo-v2.5-pro" })\`\n- Gemini Flash (via API/openclaude): \`pane_spawn({ agent: "openclaude", model: "gemini-2.5-flash" })\`\n- Gemini CLI nativo: \`pane_spawn({ agent: "gemini", providerId: "gemini-cli" })\`\n- Codex (ChatGPT OAuth): \`pane_spawn({ agent: "codex", providerId: "codex-oauth" })\`\n- Shell puro: \`pane_spawn({ agent: "shell" })\``;

  // Runtime metadata injected so the skill banner shows real values
  const providerLabels = configuredProviders.map((p: any) => `${p.host || "openclaude"} (${p.type})`).join(", ") || "none";
  sysPrompt += `\n\n## Codebrain Runtime\n\n- Version: ${_appVersion}\n- MCP Tools: ${MCP_TOOL_COUNT}\n- Providers: ${providerLabels}`;

  // Skills section — inject all installed skills so every agent knows them
  // Claude Code gets summary + Skill() invocation; other CLIs get full content inline
  sysPrompt += buildSkillsSection(cwd, agent);

  // Write to temp file (avoids Windows cmd-line length limit)
  const tmpDir = path.join(cwd || os.homedir(), ".codebrain", "tmp");
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const promptFile = path.join(tmpDir, `sysprompt-${paneId}.txt`);
  fs.writeFileSync(promptFile, sysPrompt, "utf-8");
  return promptFile;
}
