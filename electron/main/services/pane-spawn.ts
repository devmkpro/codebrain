import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import log from "electron-log/main.js";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { CODEBRAIN_SYSTEM_PROMPT, WORKER_PROMPT, ORCHESTRATOR_PROMPT, UI_TESTER_PROMPT, GEMINI_WORKER_PROMPT } from "./prompts";

// Hardcoded model-to-provider-type mapping (mirrors getEnhancedProviders)
const ENHANCED_MODEL_MAP: Record<string, string[]> = {
  "gemini-compat": [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools",
    "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite",
    "gemini-3-flash-preview", "gemini-3-pro-preview",
    "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
    "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash-001", "gemini-2.0-flash-lite-001",
    "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest",
    "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts",
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-3.1-flash-tts-preview"
  ],
  "mimo-compat": [
    "mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"
  ],
  "anthropic-compat": [
    "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101",
    "claude-opus-4-1-20250805", "claude-opus-4-20250514",
    "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022",
    "claude-haiku-4-5-20251001", "claude-3-5-haiku-20241022"
  ],
};

function getProviderTypeForModel(m: string): string | null {
  for (const [type, models] of Object.entries(ENHANCED_MODEL_MAP)) {
    if (models.includes(m)) return type;
  }
  if (m.startsWith("gemini-")) return "gemini-compat";
  if (m.startsWith("mimo-")) return "mimo-compat";
  if (m.startsWith("claude-")) return "anthropic-compat";
  return null;
}

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

    // Provider inheritance from last spawned pane
    if (!agent || !providerId || !model) {
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
        if (!providerId && (!agent || agent === callerCfg.agent)) providerId = callerCfg.providerId;
        if (!model && (!agent || agent === callerCfg.agent)) model = callerCfg.model;
      }
    }

    if (!agent) agent = "openclaude";

    // Provider auto-detection
    let provider = providerId ? ctx.providerStore.listFull().find((p) => p.id === providerId) ?? null : null;

    if (!provider && agent) {
      const allProviders = ctx.providerStore.listFull();
      if (agent === "gemini") {
        provider = allProviders.find((p) => p.host === "gemini" || p.id?.toLowerCase().includes("gemini")) ?? null;
      } else if (agent === "openclaude" || agent === "claude") {
        if (model) {
          provider = allProviders.find((p) => p.models?.includes(model) || (ENHANCED_MODEL_MAP[p.type ?? ""] ?? []).includes(model)) ?? null;
          if (!provider) {
            const targetType = getProviderTypeForModel(model);
            if (targetType) {
              provider = allProviders.find((p) => p.type === targetType) ?? null;
              if (provider) {
                log.info(`[spawnPaneInternal] Model "${model}" matched to provider type "${targetType}" via enhanced map → provider "${provider.id}"`);
              }
            }
          }
        }
        if (!provider && !model) {
          provider = allProviders.find((p) => p.type === "mimo-compat") ?? null;
          if (!provider) provider = allProviders.find((p) => p.type === "anthropic-compat") ?? null;
          if (!provider) provider = allProviders.find((p) => p.type === "gemini-compat") ?? null;
          if (!provider) provider = allProviders.find((p) => p.host === "openclaude") ?? null;
        }
      }
      if (provider) providerId = provider.id;
    }

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
            const fallback = enhancedModels[0] || providerModels[0];
            log.warn(`[spawnPaneInternal] Model "${model}" not found in provider "${provider.id}". Available: ${providerModels.join(", ")}. Falling back to: ${fallback}`);
            model = fallback;
          }
        } else {
          const fallback = enhancedModels[0] || providerModels[0];
          log.warn(`[spawnPaneInternal] Model "${model}" not found in provider "${provider.id}". Available: ${providerModels.join(", ")}. Falling back to: ${fallback}`);
          model = fallback;
        }
      }
    } else if (provider && !model) {
      // Use enhanced model list when available (avoids stale stored names like "gemini-3.1-pro")
      const enhanced = ENHANCED_MODEL_MAP[provider.type ?? ""];
      model = (enhanced && enhanced.length > 0 ? enhanced : provider.models)?.[0];
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

    // MCP config
    if (isClaudeCompatible && !ctx.mcpServerInfo && ctx.mcpServerReady) {
      try { await ctx.mcpServerReady; } catch {}
    }
    if (isClaudeCompatible && ctx.mcpServerInfo && !args.includes("--mcp-config")) {
      const mcpConfigPath = path.join(cwd, ".mcp.json");
      try {
        fs.writeFileSync(mcpConfigPath, JSON.stringify({
          mcpServers: { codebrain: { type: "sse", url: ctx.mcpServerInfo.sseUrl } },
        }, null, 2), "utf-8");
      } catch {}
      args.push("--mcp-config", mcpConfigPath);
    }

    const { nanoid } = await import("nanoid");
    const paneId = config.paneId ?? nanoid();

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

      if (provider?.type && !args.includes("--provider")) {
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
            providerArg = "anthropic"; break;
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
        if (model) {
          env["MODEL"] = model;
          env["ANTHROPIC_MODEL"] = model;
        }
      }
    }

    // ── API Proxy: redirect API calls through local proxy for token tracking ──
    // The proxy intercepts responses and extracts token usage data.
    // ALL providers redirect through the proxy (Anthropic, MIMO, Gemini, OpenAI).
    // For Gemini, the proxy also handles /v1/models health check (OpenAI-compatible)
    // that OpenClaude's Gemini adapter requires during initialization.
    if (ctx.apiProxyUrl) {
      if (isMimo || isAnthropicCompat) {
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
