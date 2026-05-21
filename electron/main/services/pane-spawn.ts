import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import log from "electron-log/main.js";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { CODEBRAIN_SYSTEM_PROMPT, WORKER_PROMPT, ORCHESTRATOR_PROMPT, UI_TESTER_PROMPT, GEMINI_WORKER_PROMPT } from "./prompts";
import { resolveCommand } from "../pty-manager";

// Use centralized model registry from constants.ts — single source of truth
import { MODEL_MAP_BY_TYPE, getProviderTypeForModel, PROVIDER_REGISTRY } from "./constants";

// Legacy alias for backward compatibility
const ENHANCED_MODEL_MAP = MODEL_MAP_BY_TYPE;

export interface SpawnPaneConfig {
  agent?: string;
  providerId?: string;
  model?: string;
  cwd?: string;
  paneId?: string;
  args?: string[];
  permissionMode?: string;
  claudeSessionId?: string;
  squadOrchestratorWorkerId?: string;
  role?: string;
  sessionContext?: string;
  env?: Record<string, string>;
  taskId?: string;
  activityId?: string;
}

export async function spawnPaneInternal(
  ctx: AppContext,
  config: SpawnPaneConfig,
): Promise<{ ok: boolean; paneId?: string; providerId?: string; error?: string }> {
  try {
    const cwd = config.cwd ?? ctx.currentWorkspacePath;

    let agent = config.agent;
    let providerId = config.providerId;
    let model = config.model;
    let provider: any = null;

    // ── Provider resolution strategy ──────────────────────────────────────
    // Priority: 0) claude-oauth fast path → 1) Explicit providerId → 2) Model-based → 3) Inheritance → 4) Fallback
    //
    // claude-oauth is a VIRTUAL provider created by the frontend when the Claude CLI
    // is detected. It is NOT in listFull(). We handle it first with a synthetic provider
    // so the rest of the resolution + validation logic works correctly.

    if (!agent) agent = "openclaude";

    // ── Step 0: claude-oauth fast path (virtual provider, not in store) ───
    // When providerId is "claude-oauth", create a synthetic provider that uses
    // the official "claude" agent (native CLI with OAuth). The model list comes
    // from the registry so validation can proceed normally.
    if (providerId === "claude-oauth") {
      agent = "claude";
      const registryTemplate = PROVIDER_REGISTRY.find(t => t.id === "claude-oauth");
      const registryModels = registryTemplate?.models ?? [];
      // If a specific model was requested, include it even if not in the registry
      const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
      // Also include models from the anthropic-compat registry entry
      const anthropicTemplate = PROVIDER_REGISTRY.find(t => t.id === "anthropic");
      const anthropicModels = anthropicTemplate?.models ?? [];
      const mergedModels = [...new Set([...allModels, ...anthropicModels])];
      provider = {
        id: "claude-oauth",
        type: "anthropic-compat",
        host: "claude",
        models: mergedModels,
        env: {},
      } as any;
      providerId = "claude-oauth";
      log.info(`[spawnPaneInternal] claude-oauth virtual provider → agent="claude", ${mergedModels.length} models available`);
    }

    // Step 1: If providerId is given, look it up in store
    if (!provider && providerId && providerId !== "claude-oauth") {
      provider = ctx.providerStore.listFull().find((p) => p.id === providerId) ?? null;
    }

    // Step 2: If model is given, resolve provider from model (BEFORE inheritance)
    if (!provider && model) {
      const targetType = getProviderTypeForModel(model);
      if (targetType) {
        provider = ctx.providerStore.listFull().find((p) => p.type === targetType) ?? null;
        if (provider) {
          providerId = provider.id;
          log.info(`[spawnPaneInternal] Model "${model}" → provider type "${targetType}" → provider "${provider.id}"`);
        }
      }
    }

    // Step 3: Provider inheritance from last spawned pane (only if NO model/provider given)
    // IMPORTANT: If a model IS given but no provider was found, DO NOT inherit —
    // the inherited provider might not support the requested model (e.g. MIMO for Claude models).
    if (!providerId && !model) {
      let latest = 0;
      let callerCfg: any = null;
      for (const [pid, pcfg] of ctx.paneConfigs) {
        const reg = ctx.paneRegistry.get(pid);
        if (reg && reg.spawnedAt > latest) {
          latest = reg.spawnedAt;
          callerCfg = pcfg;
        }
      }
      if (callerCfg) {
        if (!agent) agent = callerCfg.agent;
        providerId = callerCfg.providerId;
        model = callerCfg.model;
        provider = providerId ? ctx.providerStore.listFull().find((p) => p.id === providerId) ?? null : null;
      }
    }

    // Step 4: Final fallback — only when NO provider found AND no specific model requested.
    // When a model IS requested but no provider supports it, we keep provider=null
    // so the model validation below can produce a clear error instead of silently
    // overriding to MIMO.
    if (!provider && !model) {
      if (agent === "gemini") {
        provider = ctx.providerStore.listFull().find((p) => p.host === "gemini" || p.id?.toLowerCase().includes("gemini")) ?? null;
      }
      if (!provider) {
        provider = ctx.providerStore.listFull().find((p) => p.type === "mimo-compat") ?? null;
      }
      if (!provider) provider = ctx.providerStore.listFull().find((p) => p.type === "anthropic-compat") ?? null;
      if (!provider) provider = ctx.providerStore.listFull().find((p) => p.type === "gemini-compat") ?? null;
      if (!provider) provider = ctx.providerStore.listFull().find((p) => p.host === "claude") ?? null;
      if (!provider) provider = ctx.providerStore.listFull().find((p) => p.host === "openclaude") ?? null;
      if (provider) providerId = provider.id;
    }

    // (old provider auto-detection removed — now handled by the strategy above)

    // Validate model
    if (provider && model) {
      const providerModels = provider.models ?? [];
      const enhancedModels = ENHANCED_MODEL_MAP[provider.type ?? ""] ?? [];
      const modelKnown = providerModels.includes(model) || enhancedModels.includes(model);
      if (providerModels.length > 0 && !modelKnown) {
        const targetType = getProviderTypeForModel(model);
        if (targetType && targetType !== provider.type) {
          const betterProvider = ctx.providerStore.listFull().find((p) => p.type === targetType);
          if (betterProvider) {
            log.info(`[spawnPaneInternal] Model "${model}" belongs to "${targetType}", switching from provider "${provider.id}" to "${betterProvider.id}"`);
            provider = betterProvider;
            providerId = betterProvider.id;
          } else {
            // No provider in the store supports this model type.
            // Check if ANY provider in the store has this specific model.
            const anyProvider = ctx.providerStore.listFull().find((p) => {
              const pModels = p.models ?? [];
              const eModels = ENHANCED_MODEL_MAP[p.type ?? ""] ?? [];
              return pModels.includes(model) || eModels.includes(model);
            });
            if (anyProvider) {
              log.info(`[spawnPaneInternal] Model "${model}" found in provider "${anyProvider.id}", switching from "${provider.id}"`);
              provider = anyProvider;
              providerId = anyProvider.id;
            } else {
              // Model not supported by any configured provider — return error
              const allSupported = ctx.providerStore.listFull().flatMap(p => (p.models ?? []).map(m => `${p.id}:${m}`));
              return {
                ok: false,
                error: `Model "${model}" is not supported by any configured provider. Configured: ${allSupported.join(", ") || "none"}`,
              };
            }
          }
        } else {
          // Same provider type but model not in provider's list
          // Check if ANY provider has this specific model
          const anyProvider = ctx.providerStore.listFull().find((p) => {
            const pModels = p.models ?? [];
            const eModels = ENHANCED_MODEL_MAP[p.type ?? ""] ?? [];
            return pModels.includes(model) || eModels.includes(model);
          });
          if (anyProvider) {
            log.info(`[spawnPaneInternal] Model "${model}" found in provider "${anyProvider.id}", switching from "${provider.id}"`);
            provider = anyProvider;
            providerId = anyProvider.id;
          } else {
            const fallback = enhancedModels[0] || providerModels[0];
            log.warn(`[spawnPaneInternal] Model "${model}" not found in provider "${provider.id}" or any other provider. Falling back to: ${fallback}`);
            model = fallback;
          }
        }
      }
    } else if (!provider && model) {
      // Model was specified but no provider found — error
      return {
        ok: false,
        error: `No provider configured for model "${model}". Model type: ${getProviderTypeForModel(model) ?? "unknown"}. Please add a provider in Settings.`,
      };
    } else if (provider && !model) {
      // Use enhanced model list when available (avoids stale stored names like "gemini-3.1-pro")
      const enhanced = ENHANCED_MODEL_MAP[provider.type ?? ""];
      model = (enhanced && enhanced.length > 0 ? enhanced : provider.models)?.[0];
    }

    // Safety: only override agent for provider types that have NO official CLI.
    // MIMO has no CLI → force openclaude.
    // Anthropic-compat may be claude-oauth (official Claude CLI) → DON'T override.
    // If the user chose agent: "claude" with anthropic-compat, they want the official CLI.
    if (provider && agent === "claude") {
      const ptype = provider.type ?? "";
      if (ptype === "mimo-compat") {
        log.info(`[spawnPaneInternal] Overriding agent "claude" → "openclaude" for provider type "${ptype}" (no official CLI exists)`);
        agent = "openclaude";
      }
    }

    // Filter masked values from frontend config.env
    const configEnv = Object.fromEntries(
      Object.entries(config.env ?? {}).filter(([, v]) => !/^\*+$/.test(v))
    );
    const env: Record<string, string> = { ...(provider?.env ?? {}), ...configEnv };

    const args = [...(config.args ?? [])];
    const isClaudeCompatible = agent === "openclaude" || agent === "claude" || agent === "gemini";

    if (isClaudeCompatible && !args.includes("--permission-mode")) {
      args.push("--permission-mode", config.permissionMode ?? "bypassPermissions");
    }

    if (isClaudeCompatible && config.claudeSessionId && !args.includes("--resume")) {
      args.push("--resume", config.claudeSessionId);
    }

    const { nanoid } = await import("nanoid");
    const paneId = config.paneId ?? nanoid();

    // MCP config — write .mcp.json to the project CWD so Claude auto-discovers it.
    // Claude Code v2.1 discovers .mcp.json by scanning cwd and parent dirs.
    // We do NOT pass --mcp-config because that flag overrides auto-discovery and
    // only works when the file is in a location Claude specifically trusts.
    if (isClaudeCompatible && !ctx.mcpServerInfo && ctx.mcpServerReady) {
      try { await ctx.mcpServerReady; } catch {}
    }
    if (isClaudeCompatible && ctx.mcpServerInfo && !args.includes("--mcp-config")) {
      const mcpConfigPath = path.join(cwd, ".mcp.json");
      const mcpContent = JSON.stringify({
        mcpServers: { codebrain: { type: "sse", url: ctx.mcpServerInfo.sseUrl } },
      }, null, 2);
      try {
        fs.writeFileSync(mcpConfigPath, mcpContent, "utf-8");
        log.info(`[spawnPaneInternal] Wrote .mcp.json to ${mcpConfigPath}`);
      } catch (e) {
        log.warn("[spawnPaneInternal] Failed to write .mcp.json to cwd, skipping MCP config:", e);
      }
    }

    // System prompt injection
    if (isClaudeCompatible && !args.includes("--system-prompt")) {
      let sysPrompt = CODEBRAIN_SYSTEM_PROMPT;
      sysPrompt += `\n\n## Seu Workspace\n\nVocê está trabalhando no diretório:\n\`${cwd}\`\n\nTodos os caminhos de arquivo são relativos a este diretório. Ao criar, ler ou editar arquivos, use este diretório como base.`;
      sysPrompt += `\n\n## Seu ID de Pane\n\nSeu paneId é: \`${paneId}\`\n\nUse este ID como campo "from" ao enviar mensagens via pane_send_message, e como campo "paneId" ao ler mensagens via pane_read_messages.`;

      let rolePrompt = "";
      if (config.role === "orchestrator") {
        rolePrompt = ORCHESTRATOR_PROMPT;
      } else if (config.role === "ui-tester") {
        rolePrompt = UI_TESTER_PROMPT || WORKER_PROMPT;
      } else if (model && model.startsWith("gemini")) {
        rolePrompt = GEMINI_WORKER_PROMPT || WORKER_PROMPT;
      } else {
        rolePrompt = WORKER_PROMPT;
      }
      if (rolePrompt) sysPrompt += `\n\n---\n\n${rolePrompt}`;
      if (config.sessionContext) sysPrompt += `\n\n---\n\n${config.sessionContext}`;

      const allProviders = ctx.providerStore.listFull();
      const providersInfo = allProviders
        .filter((p) => p.id !== "claude-oauth")
        .map((p) => {
          const enhanced = ENHANCED_MODEL_MAP[p.type ?? ""];
          const models = (enhanced && enhanced.length > 0 ? enhanced : p.models)?.join(", ") || "nenhum modelo listado";
          return `* ${p.label} (id: "${p.id}", type: "${p.type}"): ${models}`;
        })
        .join("\n");
      sysPrompt += `\n\n## Providers e Modelos Disponíveis\n\n${providersInfo}`;

      // Add spawn guide with actual provider data
      const spawnModels = allProviders
        .filter((p) => p.id !== "claude-oauth")
        .map((p) => {
          const enhanced = ENHANCED_MODEL_MAP[p.type ?? ""];
          const models = (enhanced && enhanced.length > 0 ? enhanced : p.models) ?? [];
          const agent = p.host || "openclaude";
          return models.map((m: string) => `  - **${m}** → providerId: "${p.id}", agent: "${agent}"`).join("\n");
        })
        .filter(Boolean)
        .join("\n");
      sysPrompt += `\n\n## Spawning Novos Panes (Agentes)\n\nQuando o usuário pedir para spawnar, abrir, ou criar um novo agente/terminal/pane, use:\n\n\`\`\`javascript\nmcp__codebrain__pane_spawn({\n  agent: "<agent>",      // "openclaude" | "claude" | "gemini" | "shell"\n  providerId: "<id>",    // id do provider (veja abaixo)\n  model: "<model>",      // modelo específico (veja abaixo)\n  label: "<nome>",       // label opcional para identificar\n  cwd: "<workspace>"     // workspace atual\n})\n\`\`\`\n\n**⚠️ PRIORIDADE ao escolher agente:**\n1. **Padrão (sem especificar)** → \`openclaude\` com o primeiro provider disponível (MIMO > Gemini > outro). NUNCA use \`shell\` quando o usuário pede um agente de IA.\n2. **"claude plano" / "claude direto" / "plano"** → \`agent: "claude"\` (Claude Code CLI oficial, OAuth nativo, SEM openclaude)\n3. **Nome de modelo como "claude-sonnet", "opus"** → use \`openclaude\` com o provider Anthropic. O nome do modelo NÃO troca o agente.\n\n**Agentes disponíveis:**\n- \`openclaude\` — OpenClaude CLI (usa providers configurados: MIMO, Gemini, Anthropic, OpenAI, etc). **USE ESTE POR PADRÃO.**\n- \`claude\` — Claude Code CLI oficial — SOMENTE quando usuário diz "plano" ou "claude direto"\n- \`gemini\` — Google Gemini CLI\n- \`shell\` — Terminal shell puro (bash/cmd). **SOMENTE para comandos de sistema, NUNCA para agentes de IA.**\n\n**Modelos → Parâmetros de spawn:**\n\n${spawnModels}\n\n**Exemplos:**\n- MIMO 2.5 Pro (padrão): \`pane_spawn({ agent: "openclaude", providerId: "mimo", model: "mimo-v2.5-pro" })\`\n- Claude Sonnet via API: \`pane_spawn({ agent: "openclaude", providerId: "anthropic", model: "claude-sonnet-4-6" })\`\n- Claude direto do plano: \`pane_spawn({ agent: "claude", model: "claude-sonnet-4-6" })\`\n- Gemini Flash: \`pane_spawn({ agent: "openclaude", providerId: "gemini", model: "gemini-2.5-flash" })\`\n- Shell puro: \`pane_spawn({ agent: "shell" })\``;

      // Write prompt to temp file to avoid Windows error 206 (command line too long)
      const tmpDir = path.join(ctx.currentWorkspacePath || os.homedir(), ".codebrain", "tmp");
      try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
      const promptFile = path.join(tmpDir, `sysprompt-${paneId}.txt`);
      fs.writeFileSync(promptFile, sysPrompt, "utf-8");
      args.push("--system-prompt-file", promptFile);
    }

    // Provider-specific env vars
    const providerType = provider?.type;
    const isMimo = providerType === "mimo-compat";
    const isOpenAICompat = providerType === "openai-compat";
    const isGeminiCompat = providerType === "gemini-compat";
    const isAnthropicCompat = providerType === "anthropic-compat";

    if (isClaudeCompatible) {
      if (provider?.label) env["CLAUDE_CODE_PROVIDER_NAME"] = provider.label;
      if (model) env["CLAUDE_CODE_MODEL_NAME"] = model;
      if (provider) env["CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED"] = "1";

      // --provider flag is ONLY valid for the official Claude CLI (agent === "claude").
      // OpenClaude handles provider routing via env vars, not CLI flags.
      // Skip --provider for Anthropic-compat and MIMO providers — the env vars
      // (ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY) already handle routing, and
      // many Claude CLI builds don't recognize the --provider flag.
      if (agent === "claude" && provider?.type && !args.includes("--provider")) {
        let providerArg = "";
        switch (provider.type as string) {
          case "openai-compat": providerArg = "openai"; break;
          case "gemini-compat": providerArg = "gemini"; break;
          case "bedrock-compat": providerArg = "bedrock"; break;
          case "vertex-compat": providerArg = "vertex"; break;
          case "ollama-compat": providerArg = "ollama"; break;
          case "anthropic-compat":
          case "mimo-compat":
          case "anthropic":
            // Skip --provider — env vars handle routing
            break;
          default: break;
        }
        if (providerArg) args.push("--provider", providerArg);
      }

      if (isMimo) {
        if (model) {
          env["MODEL"] = model;
          env["ANTHROPIC_MODEL"] = model;
          env["OPENAI_MODEL"] = model;
          if (!args.includes("--model")) args.push("--model", model);
        }
        if (provider?.baseUrl) {
          env["ANTHROPIC_BASE_URL"] = provider.baseUrl;
          env["OPENAI_BASE_URL"] = provider.baseUrl;
        } else if (env["ANTHROPIC_BASE_URL"]) {
          env["OPENAI_BASE_URL"] = env["ANTHROPIC_BASE_URL"];
        }
        const mimoKey = env["ANTHROPIC_AUTH_TOKEN"] || env["MIMO_API_KEY"] || "";
        if (mimoKey) {
          env["ANTHROPIC_AUTH_TOKEN"] = mimoKey;
          env["MIMO_API_KEY"] = mimoKey;
          env["OPENAI_API_KEY"] = mimoKey;
        }
      } else if (isGeminiCompat) {
        env["CLAUDE_CODE_USE_GEMINI"] = "1";
        if (model) {
          env["GEMINI_MODEL"] = model;
          env["MODEL"] = model;
          env["CLAUDE_CODE_MODEL_NAME"] = model;
          if (!args.includes("--model")) args.push("--model", model);
        }
        // Set all possible Gemini API key env var names
        // (CLI may read GOOGLE_API_KEY or ANTHROPIC_API_KEY instead of GEMINI_API_KEY)
        const geminiKey = env["GEMINI_API_KEY"] || env["GOOGLE_API_KEY"] || "";
        if (geminiKey) {
          env["GEMINI_API_KEY"] = geminiKey;
          env["GOOGLE_API_KEY"] = geminiKey;
          env["ANTHROPIC_API_KEY"] = geminiKey;
        }
        if (env["GEMINI_BASE_URL"]) env["CLAUDE_CODE_DISABLE_PROXY"] = "1";
      } else if (isOpenAICompat) {
        if (model) {
          env["MODEL"] = model;
          env["OPENAI_MODEL"] = model;
        }
        if (provider?.baseUrl) env["OPENAI_BASE_URL"] = provider.baseUrl;
        const base = provider?.baseUrl?.toLowerCase() ?? "";
        const openaiKey = env["OPENAI_API_KEY"] || "";
        if (openaiKey) {
          if (base.includes("x.ai")) env["XAI_API_KEY"] = openaiKey;
          if (base.includes("deepseek")) env["DEEPSEEK_API_KEY"] = openaiKey;
        }
      } else if (isAnthropicCompat) {
        const anthropicKey = env["ANTHROPIC_API_KEY"] || env["ANTHROPIC_AUTH_TOKEN"] || "";
        if (model) {
          env["MODEL"] = model;
          env["ANTHROPIC_MODEL"] = model;
          if (!args.includes("--model")) args.push("--model", model);
        }
        // API key users: set base URL and key for proxy redirect below
        if (anthropicKey) {
          env["ANTHROPIC_API_KEY"] = anthropicKey;
          env["ANTHROPIC_AUTH_TOKEN"] = anthropicKey;
          if (provider?.baseUrl) {
            env["ANTHROPIC_BASE_URL"] = provider.baseUrl;
          }
        } else {
          // OAuth users (Claude Pro/Team plan): don't override ANTHROPIC_BASE_URL
          // so the Claude CLI uses its native OAuth login flow
          log.info("[spawnPaneInternal] AnthropicCompat: no API key — using Claude CLI native OAuth");
        }
      }
    }

    // ── API Proxy: redirect API calls through local proxy for token tracking ──
    // The proxy intercepts responses and extracts token usage data.
    // ALL providers redirect through the proxy (Anthropic, MIMO, Gemini, OpenAI).
    // For Gemini, the proxy also handles /v1/models health check (OpenAI-compatible)
    // that OpenClaude's Gemini adapter requires during initialization.
    if (ctx.apiProxyUrl) {
      if (isMimo || (isAnthropicCompat && (env["ANTHROPIC_API_KEY"] || env["ANTHROPIC_AUTH_TOKEN"]))) {
        const realBaseUrl = (env["ANTHROPIC_BASE_URL"] as string) || provider?.baseUrl || "https://api.anthropic.com";
        ctx.apiProxy?.setTargetUrl(realBaseUrl);
        env["ANTHROPIC_BASE_URL"] = ctx.apiProxyUrl;
        log.info(`[spawnPaneInternal] API Proxy redirect (Anthropic): ${realBaseUrl} → ${ctx.apiProxyUrl}`);
      }
      if (isGeminiCompat) {
        const realGeminiUrl = env["GEMINI_BASE_URL"] || provider?.baseUrl || "https://generativelanguage.googleapis.com";
        ctx.apiProxy?.setGeminiTargetUrl(realGeminiUrl);
        env["GEMINI_BASE_URL"] = ctx.apiProxyUrl;
        // Also set OPENAI_BASE_URL — OpenClaude's Gemini adapter validates via OpenAI-compatible /v1/models
        env["OPENAI_BASE_URL"] = ctx.apiProxyUrl;
        env["CLAUDE_CODE_DISABLE_PROXY"] = "1";
        log.info(`[spawnPaneInternal] API Proxy redirect (Gemini): ${realGeminiUrl} → ${ctx.apiProxyUrl}`);
      }
    }

    if (ctx.mcpServerInfo && (agent === "openclaude" || agent === "claude")) {
      env["CODEBRAIN_MCP_URL"] = ctx.mcpServerInfo.streamableHttpUrl;
      env["CODEBRAIN_MCP_SSE_URL"] = ctx.mcpServerInfo.sseUrl;
      env["CODEBRAIN_MCP_PORT"] = String(ctx.mcpServerInfo.port);
    }

    if (isClaudeCompatible && (isAnthropicCompat || isMimo) && !args.includes("--settings")) {
      const settings: Record<string, unknown> = { alwaysThinkingEnabled: false, effortLevel: "low" };
      if (model) settings.model = model;
      args.push("--settings", JSON.stringify(settings));
    }

    log.info("[spawnPaneInternal]", { agent, providerId, model, providerType, cwd });

    // Check if Claude CLI binary is missing (would silently fallback to openclaude)
    const cmdCheck = resolveCommand(agent as any, args);
    if (cmdCheck.fellBackToOpenClaude) {
      log.error("═══════════════════════════════════════════════════════════════");
      log.error("[spawnPaneInternal] ⚠️  CLAUDE CLI NÃO INSTALADO!");
      log.error(`[spawnPaneInternal] O binário "claude" não foi encontrado no PATH.`);
      log.error(`[spawnPaneInternal] CAINDO PARA OPENCLAUDE — não é o Claude Code CLI original!`);
      log.error(`[spawnPaneInternal] Para instalar: npm install -g @anthropic-ai/claude-code`);
      log.error("═══════════════════════════════════════════════════════════════");
    }

    if (isMimo) {
      log.info("[spawnPaneInternal] MIMO ANTHROPIC_AUTH_TOKEN:", env["ANTHROPIC_AUTH_TOKEN"] ? "SET" : "MISSING");
      log.info("[spawnPaneInternal] MIMO MIMO_API_KEY:", env["MIMO_API_KEY"] ? "SET" : "MISSING");
      log.info("[spawnPaneInternal] MIMO ANTHROPIC_BASE_URL:", env["ANTHROPIC_BASE_URL"] ?? "MISSING");
      log.info("[spawnPaneInternal] MIMO OPENAI_BASE_URL:", env["OPENAI_BASE_URL"] ?? "MISSING");
      log.info("[spawnPaneInternal] MIMO ANTHROPIC_MODEL:", env["ANTHROPIC_MODEL"] ?? "MISSING");
    }
    if (isGeminiCompat) {
      log.info("[spawnPaneInternal] Gemini GEMINI_API_KEY:", env["GEMINI_API_KEY"] ? "SET" : "MISSING");
      log.info("[spawnPaneInternal] Gemini GEMINI_BASE_URL:", env["GEMINI_BASE_URL"] ?? "MISSING");
      log.info("[spawnPaneInternal] Gemini GOOGLE_API_KEY:", env["GOOGLE_API_KEY"] ? "SET" : "MISSING");
      log.info("[spawnPaneInternal] Gemini GEMINI_MODEL:", env["GEMINI_MODEL"] ?? "MISSING");
      log.info("[spawnPaneInternal] Gemini MODEL:", env["MODEL"] ?? "MISSING");
      log.info("[spawnPaneInternal] Gemini CLAUDE_CODE_USE_GEMINI:", env["CLAUDE_CODE_USE_GEMINI"] ?? "MISSING");
    }

    const spawnedPaneId = await ctx.ptyManager.spawn({
      paneId,
      agent: agent as any,
      cwd,
      args,
      env,
      permissionMode: config.permissionMode,
      claudeSessionId: config.claudeSessionId,
      role: config.role,
    });

    ctx.paneConfigs.set(paneId, {
      agent,
      cwd,
      args,
      providerId: providerId ?? undefined,
      model: model ?? undefined,
      role: config.role,
      squadOrchestratorWorkerId: config.squadOrchestratorWorkerId,
      taskId: config.taskId,
      activityId: config.activityId,
    });
    ctx.paneRegistry.set(paneId, { paneId, cwd, spawnedAt: Date.now() });

    safeSend(ctx, "pane:added", {
      paneId,
      agent,
      cwd,
      providerId: providerId ?? undefined,
      model: model ?? undefined,
    });

    // Fire hook: pane_spawned
    ctx.hooksManager.fire("pane_spawned", { agent, cwd, providerId, model, role: config.role }, paneId);

    // Track provider health — success
    if (providerId) {
      const health = ctx.providerHealth.get(providerId) || { providerId, successCount: 0, errorCount: 0 };
      health.successCount++;
      health.lastSuccessAt = Date.now();
      ctx.providerHealth.set(providerId, health);
    }

    return { ok: true, paneId, providerId: providerId ?? undefined };
  } catch (err) {
    // Track provider health — failure
    if (config.providerId) {
      const health = ctx.providerHealth.get(config.providerId) || { providerId: config.providerId, successCount: 0, errorCount: 0 };
      health.errorCount++;
      health.lastError = err instanceof Error ? err.message : String(err);
      health.lastErrorAt = Date.now();
      ctx.providerHealth.set(config.providerId, health);
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
