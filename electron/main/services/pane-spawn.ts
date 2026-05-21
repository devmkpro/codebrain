import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import log from "electron-log/main.js";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { resolveCommand } from "../pty-manager";
import { MODEL_MAP_BY_TYPE, getProviderTypeForModel } from "./constants";
import { resolveProvider } from "./spawn/provider-resolver";
import { buildSystemPrompt } from "./spawn/prompt-builder";

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

    // ── Provider resolution (delegated to provider-resolver module) ────────────
    const resolved = resolveProvider(ctx, {
      agent: config.agent,
      providerId: config.providerId,
      model: config.model,
    });

    if (resolved.error) {
      return { ok: false, error: resolved.error };
    }

    let agent = resolved.agent;
    let provider = resolved.provider;
    let providerId = resolved.providerId;
    let model = resolved.model;

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

    // System prompt injection (delegated to prompt-builder module)
    if (isClaudeCompatible && !args.includes("--system-prompt")) {
      const promptFile = buildSystemPrompt(ctx, {
        paneId,
        cwd,
        model,
        role: config.role,
        sessionContext: config.sessionContext,
      });
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
      if (isMimo || isAnthropicCompat) {
        // Includes claude-oauth: proxy forwards all headers (including OAuth bearer token).
        // Use registerAnthropicTarget() for per-token routing — no shared-state race condition.
        const realBaseUrl = (env["ANTHROPIC_BASE_URL"] as string) || provider?.baseUrl || "https://api.anthropic.com";
        const tokenKey = env["ANTHROPIC_API_KEY"] || env["ANTHROPIC_AUTH_TOKEN"] || null;
        ctx.apiProxy?.registerAnthropicTarget(tokenKey, realBaseUrl);
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
