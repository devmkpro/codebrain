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
  missionId?: string;
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
    const isCodex = agent === "codex" || provider?.type === "codex";
    const isGeminiCli = agent === "gemini-cli" || agent === "gemini" || provider?.type === "gemini-cli";
    const isClaudeCompatible = !isCodex && !isGeminiCli && (agent === "openclaude" || agent === "claude");

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
        agent,
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
    const isAnthropicCompat = providerType === "anthropic-compat" || providerType === "oauth";

    if (isClaudeCompatible) {
      if (provider?.label) env["CLAUDE_CODE_PROVIDER_NAME"] = provider.label;
      if (model) env["CLAUDE_CODE_MODEL_NAME"] = model;
      if (provider) env["CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED"] = "1";

      // --provider flag tells the CLI which adapter to use.
      // For openai-compat (OpenRouter, OpenAI, etc.) and gemini-compat: ALWAYS pass it,
      // even for OpenClaude — otherwise the CLI auto-detects from the model name prefix
      // (e.g. "anthropic/claude-opus-4.7-fast" → Anthropic adapter → wrong endpoint).
      // For anthropic-compat and mimo-compat: skip — env vars handle routing.
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

        // ── OpenRouter cross-provider model fix ──
        // OpenRouter models like "anthropic/claude-opus-4.7-fast" or "google/gemini-2.5-pro"
        // use OpenRouter's OpenAI-compatible API, but OpenClaude CLI auto-detects the
        // model prefix and routes through its Anthropic/Gemini client instead.
        // We must set the corresponding base URL env vars so OpenClaude sends requests
        // to OpenRouter, not to the default provider endpoints.
        const isOpenRouter = (provider?.id ?? "").startsWith("openrouter") || base.includes("openrouter");
        if (isOpenRouter && openaiKey) {
          if (model?.startsWith("anthropic/")) {
            // Force Anthropic client to route through OpenRouter
            env["ANTHROPIC_BASE_URL"] = provider?.baseUrl || "https://openrouter.ai/api/v1";
            env["ANTHROPIC_API_KEY"] = openaiKey;
            env["ANTHROPIC_MODEL"] = model;
            if (!args.includes("--model")) args.push("--model", model);
            log.info(`[spawnPaneInternal] OpenRouter Anthropic model: setting ANTHROPIC_BASE_URL → ${env["ANTHROPIC_BASE_URL"]}`);
          }
          // Note: google/ models on OpenRouter use OpenAI-compatible format too,
          // but Gemini adapter uses a different API format. We skip GEMINI_BASE_URL
          // override to avoid format mismatch. Users should use OpenAI-format models.
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
      if (isOpenAICompat) {
        const realBaseUrl = env["OPENAI_BASE_URL"] || provider?.baseUrl || "https://api.openai.com/v1";
        const tokenKey = env["OPENAI_API_KEY"] || null;
        ctx.apiProxy?.registerOpenAITarget(tokenKey, realBaseUrl);
        env["OPENAI_BASE_URL"] = ctx.apiProxyUrl;
        log.info(`[spawnPaneInternal] API Proxy redirect (OpenAI-compat): ${realBaseUrl} → ${ctx.apiProxyUrl}`);

        // ── OpenRouter Anthropic model proxy fix ──
        // When OpenRouter serves Anthropic models, OpenClaude uses its Anthropic client
        // (reads ANTHROPIC_BASE_URL). We must also register the Anthropic proxy target
        // so the proxy intercepts and forwards those requests to OpenRouter.
        const isOpenRouter = (provider?.id ?? "").startsWith("openrouter") || (provider?.baseUrl || "").toLowerCase().includes("openrouter");
        if (isOpenRouter && model?.startsWith("anthropic/")) {
          const orBaseUrl = provider?.baseUrl || "https://openrouter.ai/api/v1";
          ctx.apiProxy?.registerAnthropicTarget(tokenKey, orBaseUrl);
          env["ANTHROPIC_BASE_URL"] = ctx.apiProxyUrl;
          log.info(`[spawnPaneInternal] API Proxy redirect (OpenRouter→Anthropic): ${orBaseUrl} → ${ctx.apiProxyUrl}`);
        }
      }
    }

    if (ctx.mcpServerInfo) {
      env["CODEBRAIN_MCP_URL"] = ctx.mcpServerInfo.streamableHttpUrl;
      env["CODEBRAIN_MCP_SSE_URL"] = ctx.mcpServerInfo.sseUrl;
      env["CODEBRAIN_MCP_PORT"] = String(ctx.mcpServerInfo.port);
    }

    if (isClaudeCompatible && (isAnthropicCompat || isMimo) && !args.includes("--settings")) {
      const settings: Record<string, unknown> = { alwaysThinkingEnabled: false, effortLevel: "low" };
      if (model) settings.model = model;
      args.push("--settings", JSON.stringify(settings));
    }

    // ── Kimi CLI branch (Moonshot) ─────────────────────────────────────────────
    // Direct agent — passes model and API key directly.
    // Kimi uses OpenAI-compatible API at api.moonshot.cn.
    const isKimi = agent === "kimi";
    if (isKimi) {
      if (model && !args.includes("-m") && !args.includes("--model")) {
        args.push("-m", model);
      }
      // Forward Moonshot API key
      const moonshotKey = env["MOONSHOT_API_KEY"] || env["OPENAI_API_KEY"] || "";
      if (moonshotKey) {
        env["MOONSHOT_API_KEY"] = moonshotKey;
        env["OPENAI_API_KEY"] = moonshotKey;
      }
      if (provider?.baseUrl) {
        env["OPENAI_BASE_URL"] = provider.baseUrl;
      }
      log.info("[spawnPaneInternal] Kimi model:", model ?? "MISSING");
    }

    // ── Cursor CLI branch ─────────────────────────────────────────────────────
    // Direct agent — uses OpenAI-compatible API.
    const isCursor = agent === "cursor";
    if (isCursor) {
      if (model && !args.includes("-m") && !args.includes("--model")) {
        args.push("-m", model);
      }
      const cursorKey = env["CURSOR_API_KEY"] || env["OPENAI_API_KEY"] || "";
      if (cursorKey) {
        env["CURSOR_API_KEY"] = cursorKey;
        env["OPENAI_API_KEY"] = cursorKey;
      }
      log.info("[spawnPaneInternal] Cursor model:", model ?? "MISSING");
    }

    // ── Copilot CLI branch (GitHub) ───────────────────────────────────────────
    // Direct agent — uses GitHub token for authentication.
    const isCopilot = agent === "copilot";
    if (isCopilot) {
      if (model && !args.includes("-m") && !args.includes("--model")) {
        args.push("-m", model);
      }
      const githubToken = env["GITHUB_TOKEN"] || env["COPILOT_TOKEN"] || "";
      if (githubToken) {
        env["GITHUB_TOKEN"] = githubToken;
        env["COPILOT_TOKEN"] = githubToken;
      }
      log.info("[spawnPaneInternal] Copilot model:", model ?? "MISSING");
    }

    // ── Codex CLI branch (NOT Claude-compatible) ───────────────────────────────
    // All config via CLI -c flags (short values) + model_instructions_file (path).
    // NO CODEX_HOME override — uses real ~/.codex/ with user's auth tokens.
    // Pattern reverse-engineered from Overclock app (2026-05-30).
    if (isCodex) {
      const tomlStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

      // Sandbox + approval (Overclock bypassPermissions pattern)
      if (!args.includes("--sandbox") && !args.includes("--ask-for-approval")) {
        args.push("--sandbox", "danger-full-access", "--ask-for-approval", "never");
      }
      if (!args.includes("--no-alt-screen")) {
        args.push("--no-alt-screen");
      }
      if (model && !args.includes("-m") && !args.includes("--model")) {
        args.push("-m", model);
      }

      // MCP server config via -c flag (short URL, safe for CLI)
      // Wait for MCP server if not yet ready (race condition: Codex spawned before MCP boots)
      if (!ctx.mcpServerInfo && ctx.mcpServerReady) {
        try { await ctx.mcpServerReady; } catch {}
      }
      if (ctx.mcpServerInfo && !args.some((a: string) => a.includes("mcp_servers.codebrain."))) {
        args.push("-c", `mcp_servers.codebrain.url=${tomlStr(ctx.mcpServerInfo.streamableHttpUrl)}`);
        args.push("-c", `mcp_servers.codebrain.default_tools_approval_mode=${tomlStr("approve")}`);
      }

      // System prompt → file, then pass file PATH via -c (avoids error 206 = cmd too long)
      const instructionsFile = buildSystemPrompt(ctx, {
        paneId, cwd, model, agent, role: config.role, sessionContext: config.sessionContext,
      });
      if (!args.some((a: string) => a.includes("model_instructions_file="))) {
        // Normalize to forward slashes for TOML compatibility
        const normalizedPath = instructionsFile.replace(/\\/g, "/");
        args.push("-c", `model_instructions_file=${tomlStr(normalizedPath)}`);
      }

      // API-key provider: forward the key. OAuth provider: rely on `codex login`.
      if (provider?.id !== "codex-oauth") {
        const openaiKey = env["OPENAI_API_KEY"] || "";
        if (openaiKey) env["OPENAI_API_KEY"] = openaiKey;
      }
      // Ollama and other OpenAI-compat local providers: forward base URL
      // so Codex sends requests to the right endpoint (e.g. http://localhost:11434/v1)
      if (provider?.type === "openai-compat" && provider?.baseUrl) {
        env["OPENAI_BASE_URL"] = provider.baseUrl;
        // Ollama doesn't require a real key — set dummy if missing
        if (!env["OPENAI_API_KEY"]) env["OPENAI_API_KEY"] = "ollama";
      }

      log.info("[spawnPaneInternal] Codex model:", model ?? "MISSING");
      log.info("[spawnPaneInternal] Codex auth:", provider?.id === "codex-oauth" ? "ChatGPT OAuth" : (env["OPENAI_API_KEY"] ? "API key" : "MISSING"));
      log.info("[spawnPaneInternal] Codex args:", args.join(" "));
    }

    // ── Gemini CLI branch (native gemini binary, NOT OpenClaude) ──────────────
    // Pattern reverse-engineered from Overclock (2026-05-30).
    // Key differences from Overclock:
    //   1. GEMINI_CLI_NO_RELAUNCH=true prevents CLI from restarting on settings.json change
    //   2. GEMINI_CLI_TRUST_WORKSPACE=true auto-trusts workspace for MCP
    //   3. Atomic write (tmp + rename) for settings.json
    if (isGeminiCli) {
      // CLI flags (short, safe for command line)
      if (!args.includes("--approval-mode")) {
        args.push("--approval-mode", "yolo");
      }
      if (!args.includes("--skip-trust")) {
        args.push("--skip-trust");
      }
      if (model && !args.includes("-m") && !args.includes("--model")) {
        args.push("-m", model);
      }

      // ── CRITICAL env vars (Overclock pattern) ───────────────────────────────
      // Without GEMINI_CLI_NO_RELAUNCH, Gemini CLI restarts when it detects
      // settings.json change (our MCP write), losing the config.
      // Without GEMINI_CLI_TRUST_WORKSPACE, CLI blocks on trust prompt.
      env["GEMINI_CLI_NO_RELAUNCH"] = "true";
      env["GEMINI_CLI_TRUST_WORKSPACE"] = "true";

      // MCP config → .gemini/settings.json (Overclock pattern with atomic write)
      // Wait for MCP server if not yet ready (race condition: Gemini spawned before MCP boots)
      if (!ctx.mcpServerInfo && ctx.mcpServerReady) {
        try { await ctx.mcpServerReady; } catch {}
      }
      let geminiMcpConfigured = false;
      if (ctx.mcpServerInfo) {
        const geminiDir = path.join(cwd, ".gemini");
        const settingsPath = path.join(geminiDir, "settings.json");
        try {
          let settings: Record<string, any> = {};
          try {
            settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
          } catch {}
          const currentMcp = typeof settings.mcpServers === "object" && settings.mcpServers ? settings.mcpServers : {};
          settings.mcpServers = {
            ...currentMcp,
            codebrain: {
              url: ctx.mcpServerInfo.streamableHttpUrl,
              type: "http",
              trust: true,
            },
          };
          // Atomic write: write to tmp file, then rename (Overclock pattern)
          fs.mkdirSync(geminiDir, { recursive: true });
          const tmpPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
          fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
          fs.renameSync(tmpPath, settingsPath);
          geminiMcpConfigured = true;
          log.info(`[spawnPaneInternal] Wrote Gemini MCP config to ${settingsPath}`);
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to write .gemini/settings.json:", e);
        }
      }

      // System prompt → .gemini/codebrain-context.md + add to contextFileName
      const promptFile = buildSystemPrompt(ctx, {
        paneId, cwd, model, agent, role: config.role, sessionContext: config.sessionContext,
      });
      try {
        const promptContent = fs.readFileSync(promptFile, "utf-8");
        const contextRelPath = ".gemini/codebrain-context.md";
        const contextAbsPath = path.join(cwd, contextRelPath);
        const geminiDir = path.join(cwd, ".gemini");
        fs.mkdirSync(geminiDir, { recursive: true });
        fs.writeFileSync(contextAbsPath, promptContent, "utf-8");

        // Add to contextFileName in settings.json
        const settingsPath = path.join(geminiDir, "settings.json");
        let settings: Record<string, any> = {};
        try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}
        const currentContext = Array.isArray(settings.contextFileName)
          ? settings.contextFileName.filter((item: any) => typeof item === "string")
          : typeof settings.contextFileName === "string"
            ? [settings.contextFileName]
            : ["GEMINI.md"];
        settings.contextFileName = Array.from(new Set([...currentContext, contextRelPath]));
        // Atomic write for context file update too
        const tmpPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
        fs.renameSync(tmpPath, settingsPath);
        log.info(`[spawnPaneInternal] Gemini context file: ${contextAbsPath}`);
      } catch (e) {
        log.warn("[spawnPaneInternal] Failed to write Gemini context file:", e);
      }

      // Only add --allowed-mcp-server-names AFTER config is confirmed written
      if (geminiMcpConfigured && !args.includes("--allowed-mcp-server-names")) {
        args.push("--allowed-mcp-server-names", "codebrain");
      }

      // Forward GEMINI_API_KEY
      const geminiKey = env["GEMINI_API_KEY"] || env["GOOGLE_API_KEY"] || "";
      if (geminiKey) {
        env["GEMINI_API_KEY"] = geminiKey;
        env["GOOGLE_API_KEY"] = geminiKey;
      }

      log.info("[spawnPaneInternal] Gemini CLI model:", model ?? "MISSING");
      log.info("[spawnPaneInternal] Gemini CLI args:", args.join(" "));
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
      missionId: config.missionId,
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
