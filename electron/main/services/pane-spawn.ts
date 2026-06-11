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
    // Smart cwd resolution: explicit > most active pane workspace > global > home
    let cwd = config.cwd;
    if (!cwd || cwd === require("os").homedir()) {
      // Find the workspace with the most active panes (most likely the caller's workspace)
      const wsCounts = new Map<string, number>();
      for (const [, cfg] of ctx.paneConfigs) {
        if (cfg.cwd && cfg.cwd !== require("os").homedir()) {
          wsCounts.set(cfg.cwd, (wsCounts.get(cfg.cwd) ?? 0) + 1);
        }
      }
      if (wsCounts.size > 0) {
        // Pick workspace with most active panes
        cwd = [...wsCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else {
        cwd = ctx.currentWorkspacePath;
      }
    }

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

    // Wait for MCP server — ALL agents need it.
    // Always await mcpServerReady to get the LATEST port (server may have restarted
    // with a different port since the last spawn).
    if (ctx.mcpServerReady) {
      try {
        const latestInfo = await ctx.mcpServerReady;
        if (latestInfo) ctx.mcpServerInfo = latestInfo;
      } catch {}
    }

    // MCP config — write .mcp.json to the project CWD so Claude auto-discovers it.
    // Claude Code v2.1 discovers .mcp.json by scanning cwd and parent dirs.
    // We do NOT pass --mcp-config because that flag overrides auto-discovery and
    // only works when the file is in a location Claude specifically trusts.
    if (isClaudeCompatible && ctx.mcpServerInfo && !args.includes("--mcp-config")) {
      const mcpConfigPath = path.join(cwd, ".mcp.json");
      const mcpServers: Record<string, any> = {
        codebrain: { type: "streamable-http", url: ctx.mcpServerInfo.streamableHttpUrl },
      };

      // ── Collect all MCPs installed in Claude Code and inject into .mcp.json ──
      // This ensures OpenClaude/MIMO panes have access to the same MCPs as
      // the native Claude CLI (Built-in MCPs + user MCPs from ~/.claude.json).

      // 1. Built-in MCPs: detect known native host executables
      const builtins: Array<{ name: string; batPath: string; npmPkg?: string }> = [
        { name: "claude-in-chrome", batPath: path.join(os.homedir(), ".claude", "chrome", "chrome-native-host.bat") },
      ];
      for (const { name, batPath } of builtins) {
        if (fs.existsSync(batPath)) {
          mcpServers[name] = { type: "stdio", command: batPath, args: [] };
          log.info(`[spawnPaneInternal] Auto-injected built-in MCP: ${name}`);
        }
      }

      // 2. User MCPs from ~/.claude.json (global + current project)
      const claudeJsonPath = path.join(os.homedir(), ".claude.json");
      if (fs.existsSync(claudeJsonPath)) {
        try {
          const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8"));
          // Global user-level MCPs
          const globalMcps: Record<string, any> = claudeJson.mcpServers ?? {};
          for (const [name, cfg] of Object.entries(globalMcps)) {
            if (!mcpServers[name]) {
              mcpServers[name] = cfg;
              log.info(`[spawnPaneInternal] Injected global MCP from ~/.claude.json: ${name}`);
            }
          }
          // Project-level MCPs (for the current cwd)
          const projectMcps: Record<string, any> = claudeJson.projects?.[cwd]?.mcpServers ?? {};
          for (const [name, cfg] of Object.entries(projectMcps)) {
            if (!mcpServers[name]) {
              mcpServers[name] = cfg;
              log.info(`[spawnPaneInternal] Injected project MCP from ~/.claude.json: ${name}`);
            }
          }
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to read ~/.claude.json for MCP injection:", e);
        }
      }

      const mcpContent = JSON.stringify({ mcpServers }, null, 2);
      try {
        fs.writeFileSync(mcpConfigPath, mcpContent, "utf-8");
        log.info(`[spawnPaneInternal] Wrote .mcp.json with ${Object.keys(mcpServers).length} MCPs to ${mcpConfigPath}`);
      } catch (e) {
        log.warn("[spawnPaneInternal] Failed to write .mcp.json to cwd, skipping MCP config:", e);
      }

      // ── Also write MCP config to ~/.claude.json for Claude Code CLI ──
      // Claude Code reads from ~/.claude.json → projects[cwd].mcpServers
      // in addition to .mcp.json in CWD. Ensures MCP is found after restart.
      if (isClaudeCompatible) {
        try {
          const claudeJsonPath = path.join(os.homedir(), ".claude.json");
          let claudeJson: Record<string, any> = {};
          try { claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8")); } catch {}
          if (!claudeJson.projects) claudeJson.projects = {};
          const projectKey = cwd.replace(/\\/g, "/");
          if (!claudeJson.projects[projectKey]) claudeJson.projects[projectKey] = {};
          if (!claudeJson.projects[projectKey].mcpServers) claudeJson.projects[projectKey].mcpServers = {};
          claudeJson.projects[projectKey].mcpServers.codebrain = {
            type: "streamable-http",
            url: ctx.mcpServerInfo.streamableHttpUrl,
          };
          fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2), "utf-8");
          log.info(`[spawnPaneInternal] Updated ~/.claude.json project MCP for ${projectKey}`);
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to update ~/.claude.json MCP config:", e);
        }
      }

      // ── Also write MCP config to ~/.openclaude.json for OpenClaude CLI ──
      // OpenClaude CLI does NOT read .mcp.json from CWD — it reads from
      // ~/.openclaude.json → projects[cwd].mcpServers with "type": "http".
      // Without this, OpenClaude agents never discover the Codebrain MCP server.
      if (agent === "openclaude") {
        try {
          const openClaudeConfigPath = path.join(os.homedir(), ".openclaude.json");
          let openClaudeConfig: Record<string, any> = {};
          try { openClaudeConfig = JSON.parse(fs.readFileSync(openClaudeConfigPath, "utf-8")); } catch {}
          if (!openClaudeConfig.projects) openClaudeConfig.projects = {};
          // OpenClaude uses forward-slash paths as keys
          const projectKey = cwd.replace(/\\/g, "/");
          if (!openClaudeConfig.projects[projectKey]) openClaudeConfig.projects[projectKey] = {};
          if (!openClaudeConfig.projects[projectKey].mcpServers) openClaudeConfig.projects[projectKey].mcpServers = {};
          // Add codebrain server (OpenClaude uses "type": "http", not "streamable-http")
          openClaudeConfig.projects[projectKey].mcpServers.codebrain = {
            type: "http",
            url: ctx.mcpServerInfo.streamableHttpUrl,
          };
          fs.writeFileSync(openClaudeConfigPath, JSON.stringify(openClaudeConfig, null, 2), "utf-8");
          log.info(`[spawnPaneInternal] Updated ~/.openclaude.json project MCP for ${projectKey}`);
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to update ~/.openclaude.json MCP config:", e);
        }
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
          // OpenClaude uses OpenAI-compat format: replace /anthropic suffix with /v1
          // e.g. https://token-plan-ams.xiaomimimo.com/anthropic → https://token-plan-ams.xiaomimimo.com/v1
          const openaiBase = provider.baseUrl.replace(/\/anthropic\/?$/, "/v1");
          env["OPENAI_BASE_URL"] = openaiBase;
        } else if (env["ANTHROPIC_BASE_URL"]) {
          env["OPENAI_BASE_URL"] = env["ANTHROPIC_BASE_URL"].replace(/\/anthropic\/?$/, "/v1");
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
        // ── spawn pattern (2026-06-04) ───────────────────────────────────
        // Claude CLI reads ANTHROPIC_AUTH_TOKEN as bearer token, ANTHROPIC_BASE_URL
        // to route to non-Anthropic providers (MIMO, DeepSeek, Fireworks, etc).
        // The user stores the key as ANTHROPIC_AUTH_TOKEN in provider env.
        // For MIMO: tokenEnvVar="ANTHROPIC_AUTH_TOKEN" → env already has the MIMO key.
        // Fallback: also accept MIMO_API_KEY for backward compat.
        const mimoKey = env["MIMO_API_KEY"] || "";
        if (mimoKey && !env["ANTHROPIC_AUTH_TOKEN"]) {
          env["ANTHROPIC_AUTH_TOKEN"] = mimoKey;
        }
        const anthropicKey = env["ANTHROPIC_AUTH_TOKEN"] || env["ANTHROPIC_API_KEY"] || "";
        if (model) {
          env["MODEL"] = model;
          env["ANTHROPIC_MODEL"] = model;
          // Override ALL Claude CLI model defaults so non-native models (e.g. MIMO) work.
          // Without these, Claude CLI falls back to its built-in claude-* defaults and
          // reports "model not found" for custom models like mimo-v2.5-pro.
          env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = model;
          env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = model;
          env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = model;
          env["ANTHROPIC_SMALL_FAST_MODEL"] = model;
          if (!args.includes("--model")) args.push("--model", model);
        }
        if (anthropicKey) {
          // Key user (MIMO, DeepSeek, etc): set ONLY ANTHROPIC_AUTH_TOKEN — not ANTHROPIC_API_KEY.
          // Setting both causes Claude CLI to warn: "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set".
          // ANTHROPIC_AUTH_TOKEN takes priority over ANTHROPIC_API_KEY in Claude CLI.
          env["ANTHROPIC_AUTH_TOKEN"] = anthropicKey;
          delete env["ANTHROPIC_API_KEY"]; // avoid the double-auth warning
          if (provider?.baseUrl) {
            env["ANTHROPIC_BASE_URL"] = provider.baseUrl;
          }
          log.info(`[spawnPaneInternal] AnthropicCompat: key user, baseUrl=${provider?.baseUrl ?? "default"}`);
        } else {
          // OAuth users (Claude Pro/Team plan): don't set ANTHROPIC_AUTH_TOKEN or
          // ANTHROPIC_BASE_URL — Claude CLI uses its native OAuth login flow.
          log.info("[spawnPaneInternal] AnthropicCompat: no API key — using Claude CLI native OAuth");
        }
      }
    }

    // No API proxy — all providers go direct to their endpoints.

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
    // Config: written to ~/.kimi-code/config.toml (Kimi Code v0.6+)
    // System prompt: injected via --skills-dir pointing to a temp dir with a codebrain skill.
    // Kimi auto-discovers skills from project .kimi/skills/ and ~/.kimi/skills/, and also from
    // any directory passed via --skills-dir.
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

      // Config: write model + MCP to ~/.kimi-code/config.toml
      // Kimi Code v0.6+ reads from ~/.kimi-code/ (not ~/.kimi/)
      const kimiConfigDir = path.join(os.homedir(), ".kimi-code");
      const kimiConfigPath = path.join(kimiConfigDir, "config.toml");
      try {
        fs.mkdirSync(kimiConfigDir, { recursive: true });
        let configText = "";
        try { configText = fs.readFileSync(kimiConfigPath, "utf-8"); } catch {}

        const effectiveModel = model || "kimi-k2.6";

        // Set default_model
        if (!configText.includes("default_model")) {
          configText = `default_model = "${effectiveModel}"\n` + configText;
        } else {
          configText = configText.replace(/^default_model\s*=\s*".+"/m, `default_model = "${effectiveModel}"`);
        }

        // Kimi requires [models."<name>"] with provider, model, and max_context_size.
        // provider = "kimi-for-coding" is the built-in OAuth provider in kimi-code.
        const KIMI_CONTEXT: Record<string, number> = {
          "kimi-k2.6": 1000000, "kimi-k2.5": 1000000,
          "kimi-k2-flash": 131072, "kimi-k2-turbo": 131072,
        };
        const modelSection = `[models."${effectiveModel}"]`;
        if (!configText.includes(modelSection)) {
          const ctxSize = KIMI_CONTEXT[effectiveModel] ?? 1000000;
          configText = configText.trimEnd() + `\n\n${modelSection}\nprovider = "kimi-for-coding"\nmodel = "${effectiveModel}"\nmax_context_size = ${ctxSize}\n`;
        }

        // MCP: write codebrain server block
        if (ctx.mcpServerInfo) {
          // Remove existing codebrain mcp block if present
          configText = configText.replace(/\[mcp_servers\.codebrain\][^\[]*/, "").trimEnd();
          // Kimi uses HTTP transport (Streamable HTTP)
          const mcpBlock = `\n\n[mcp_servers.codebrain]\nurl = "${ctx.mcpServerInfo.streamableHttpUrl}"\ntype = "http"\ndefault_tools_approval_mode = "approve"\n`;
          configText += mcpBlock;
        }

        fs.writeFileSync(kimiConfigPath, configText, "utf-8");
        log.info("[spawnPaneInternal] Kimi config written to", kimiConfigPath);
      } catch (e) {
        log.warn("[spawnPaneInternal] Failed to write Kimi config.toml:", e);
      }

      // System prompt: Kimi has --skills-dir to load skills from a custom directory.
      // Write the Codebrain system prompt + all .codebrain/skills/ as Kimi-native skills.
      if (!args.includes("--skills-dir")) {
        try {
          const promptFile = buildSystemPrompt(ctx, {
            paneId, cwd, model, agent, role: config.role, sessionContext: config.sessionContext,
          });
          const promptContent = fs.readFileSync(promptFile, "utf-8");
          const skillsDir = path.join(cwd, ".codebrain", "tmp", `kimi-skills-${paneId}`);

          // 1. "codebrain" skill = full system prompt (context + MCP tools guide)
          const codebrainSkillDir = path.join(skillsDir, "codebrain");
          fs.mkdirSync(codebrainSkillDir, { recursive: true });
          fs.writeFileSync(path.join(codebrainSkillDir, "skill.json"), JSON.stringify({
            id: "codebrain", name: "Codebrain Context", type: "prompt",
            description: "Codebrain workspace context and MCP tools guide",
            triggers: [],
          }, null, 2), "utf-8");
          fs.writeFileSync(path.join(codebrainSkillDir, "prompt.md"), promptContent, "utf-8");

          // 2. Copy real .codebrain/skills/* so Kimi can invoke them natively
          const cbSkillsSources = [
            path.join(cwd, ".codebrain", "skills"),
            path.join(os.homedir(), ".codebrain", "skills"),
          ];
          const copiedIds = new Set<string>(["codebrain"]); // avoid overwriting system prompt skill
          for (const srcDir of cbSkillsSources) {
            if (!fs.existsSync(srcDir)) continue;
            for (const entry of fs.readdirSync(srcDir)) {
              const entryPath = path.join(srcDir, entry);
              const manifestPath = path.join(entryPath, "skill.json");
              if (!fs.existsSync(manifestPath)) continue;
              try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
                if (!manifest.id || copiedIds.has(manifest.id)) continue;
                copiedIds.add(manifest.id);
                const destSkillDir = path.join(skillsDir, manifest.id);
                fs.mkdirSync(destSkillDir, { recursive: true });
                // Copy all files in the skill dir
                for (const file of fs.readdirSync(entryPath)) {
                  fs.copyFileSync(path.join(entryPath, file), path.join(destSkillDir, file));
                }
              } catch {}
            }
          }

          args.push("--skills-dir", skillsDir);
          log.info(`[spawnPaneInternal] Kimi skills dir: ${skillsDir} (${copiedIds.size} skills)`);
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to write Kimi skills dir:", e);
        }
      }

      log.info("[spawnPaneInternal] Kimi model:", model ?? "MISSING");
    }

    // ── Cursor CLI branch ─────────────────────────────────────────────────────
    // Binary: cursor-agent (installs to %LOCALAPPDATA%\cursor-agent\ on Windows)
    // MCP: reads .cursor/mcp.json in cwd. Auto-approve via --approve-mcps flag.
    //      Also supports `cursor-agent mcp enable <id>` for persistent approval.
    // System prompt: injected via .cursor/rules/codebrain.mdc (Cursor rules).
    // Docs: https://docs.cursor.com/cli/overview
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

      // Sandbox disabled for bypassPermissions
      if (!args.includes("--sandbox")) {
        args.push("--sandbox", "disabled");
      }
      // Auto-approve MCP servers so cursor-agent doesn't prompt interactively
      if (!args.includes("--approve-mcps")) {
        args.push("--approve-mcps");
      }

      // MCP: write codebrain server to .cursor/mcp.json in cwd
      // cursor-agent reads this at startup (same format as Cursor IDE)
      if (ctx.mcpServerInfo) {
        const cursorDir = path.join(cwd, ".cursor");
        const mcpJsonPath = path.join(cursorDir, "mcp.json");
        try {
          fs.mkdirSync(cursorDir, { recursive: true });
          let existing: Record<string, any> = {};
          try { existing = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8")); } catch {}
          const mcpServers = existing.mcpServers ?? {};
          // cursor-agent supports both SSE and HTTP transports.
          // Use Streamable HTTP (modern, works with all agents).
          mcpServers.codebrain = { url: ctx.mcpServerInfo.streamableHttpUrl, type: "http" };
          existing.mcpServers = mcpServers;
          fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2), "utf-8");
          log.info("[spawnPaneInternal] Cursor MCP config written to", mcpJsonPath);
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to write .cursor/mcp.json:", e);
        }
      }

      // System prompt: write .cursor/rules/codebrain.mdc (Cursor rules file)
      // cursor-agent loads all *.mdc files from .cursor/rules/ at startup
      try {
        const promptFile = buildSystemPrompt(ctx, {
          paneId, cwd, model, agent, role: config.role, sessionContext: config.sessionContext,
        });
        const promptContent = fs.readFileSync(promptFile, "utf-8");
        const rulesDir = path.join(cwd, ".cursor", "rules");
        fs.mkdirSync(rulesDir, { recursive: true });
        fs.writeFileSync(path.join(rulesDir, "codebrain.mdc"), promptContent, "utf-8");
        log.info("[spawnPaneInternal] Cursor rules written to .cursor/rules/codebrain.mdc");
      } catch (e) {
        log.warn("[spawnPaneInternal] Failed to write .cursor/rules/codebrain.mdc:", e);
      }

      log.info("[spawnPaneInternal] Cursor model:", model ?? "MISSING");
      log.info("[spawnPaneInternal] Cursor args:", args.join(" "));
    }

    // ── Copilot CLI branch (GitHub) ───────────────────────────────────────────
    // MCP: copilot supports --additional-mcp-config <json-string> CLI flag.
    // System prompt: custom instructions loaded from AGENTS.md or passed via --i (initial prompt).
    // Copilot also reads ~/.copilot/mcp-config.json but we prefer the CLI flag to avoid
    // polluting global state.
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

      // MCP: pass codebrain server via --additional-mcp-config JSON flag
      if (ctx.mcpServerInfo && !args.includes("--additional-mcp-config")) {
        // Copilot expects: {"mcpServers": {"name": {...}}}
        const mcpJson = JSON.stringify({
          mcpServers: {
            codebrain: { url: ctx.mcpServerInfo.streamableHttpUrl, type: "http" }
          }
        });
        args.push("--additional-mcp-config", mcpJson);
        log.info("[spawnPaneInternal] Copilot MCP via --additional-mcp-config");
      }

      // System prompt: write AGENTS.md to cwd (Copilot reads custom instructions from it)
      // --no-custom-instructions disables this, so only write if not suppressed
      if (!args.includes("--no-custom-instructions")) {
        try {
          const promptFile = buildSystemPrompt(ctx, {
            paneId, cwd, model, agent, role: config.role, sessionContext: config.sessionContext,
          });
          const promptContent = fs.readFileSync(promptFile, "utf-8");
          // Write to .copilot/codebrain-context.md and include it via AGENTS.md import
          const copilotDir = path.join(cwd, ".copilot");
          fs.mkdirSync(copilotDir, { recursive: true });
          fs.writeFileSync(path.join(copilotDir, "codebrain-context.md"), promptContent, "utf-8");
          // AGENTS.md: include the codebrain context file
          const agentsPath = path.join(cwd, "AGENTS.md");
          let agentsContent = "";
          try { agentsContent = fs.readFileSync(agentsPath, "utf-8"); } catch {}
          const importLine = `[import]: # (.copilot/codebrain-context.md)`;
          if (!agentsContent.includes(".copilot/codebrain-context.md")) {
            fs.writeFileSync(agentsPath, `${importLine}\n\n${agentsContent}`, "utf-8");
          }
          log.info("[spawnPaneInternal] Copilot context written to .copilot/codebrain-context.md");
        } catch (e) {
          log.warn("[spawnPaneInternal] Failed to write Copilot AGENTS.md:", e);
        }
      }

      log.info("[spawnPaneInternal] Copilot model:", model ?? "MISSING");
    }

    // ── Codex CLI branch (NOT Claude-compatible) ───────────────────────────────
    // All config via CLI -c flags (short values) + model_instructions_file (path).
    // NO CODEX_HOME override — uses real ~/.codex/ with user's auth tokens.
    // Pattern reverse-engineered from the app (2026-05-30).
    if (isCodex) {
      const tomlStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

      // Sandbox + approval
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
    // Pattern for Gemini CLI spawn.
    // Key implementation notes:
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

      // ── CRITICAL env vars ───────────────────────────────
      // Without GEMINI_CLI_NO_RELAUNCH, Gemini CLI restarts when it detects
      // settings.json change (our MCP write), losing the config.
      // Without GEMINI_CLI_TRUST_WORKSPACE, CLI blocks on trust prompt.
      env["GEMINI_CLI_NO_RELAUNCH"] = "true";
      env["GEMINI_CLI_TRUST_WORKSPACE"] = "true";

      // MCP config → .gemini/settings.json (spawn pattern with atomic write)
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
          // Atomic write: write to tmp file, then rename
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

    // Feature 9: run pre-spawn command hooks (best-effort, non-blocking on failure)
    await ctx.hooksManager.runPreSpawnHooks(paneId, agent, cwd ?? "");
    ctx.hooksManager.fire("pane_spawned" as any, { paneId, agent, cwd, phase: "pre" });

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
