import log from "electron-log/main.js";
import type { AppContext } from "../../context";
import { MODEL_MAP_BY_TYPE, PROVIDER_REGISTRY, getProviderTypeForModel } from "../constants";
import { getEnhancedProviders } from "../providers";

const ENHANCED_MODEL_MAP = MODEL_MAP_BY_TYPE;

export interface ResolvedProvider {
  agent: string;
  provider: any;
  providerId: string | null;
  model: string | undefined;
  error?: string;
}

/**
 * Resolves the provider, model, and agent for a spawn request.
 *
 * Priority:
 *   0) claude-oauth virtual provider fast path
 *   1) Explicit providerId lookup in store
 *   2) Model-based provider lookup
 *   3) Inheritance from last spawned pane (only when neither model nor provider given)
 *   4) Fallback to first available provider in store
 *   + Model validation and correction
 */
export function resolveProvider(
  ctx: AppContext,
  config: { agent?: string; providerId?: string; model?: string },
): ResolvedProvider {
  let agent = config.agent ?? "openclaude";
  let providerId = config.providerId ?? null;
  let model = config.model;
  let provider: any = null;

  // ── Read preferredAgent from configStore (set by user in Settings/Header) ──
  let preferredAgent: string | undefined;
  try {
    const cfg = ctx.configStore?.get?.() as Record<string, unknown> | undefined;
    preferredAgent = (cfg?.preferredAgent as string) || undefined;
  } catch {}

  // ── Early exit: shell agent needs no provider ──────────────────────────────
  if (agent === "shell") {
    return { agent, provider: null, providerId: null, model: undefined };
  }

  // ── Step 0: claude-oauth virtual provider ───────────────────────────────────
  if (providerId === "claude-oauth") {
    agent = "claude";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "claude-oauth");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    const anthropicTemplate = PROVIDER_REGISTRY.find((t) => t.id === "anthropic");
    const anthropicModels = anthropicTemplate?.models ?? [];
    provider = {
      id: "claude-oauth",
      type: "anthropic-compat",
      host: "claude",
      models: [...new Set([...allModels, ...anthropicModels])],
      env: {},
    };
    log.info(`[resolveProvider] claude-oauth → agent="claude", ${provider.models.length} models`);
  }

  // ── Step 0b: codex-oauth virtual provider ────────────────────────────────────
  if (providerId === "codex-oauth") {
    agent = "codex";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "codex-oauth");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    const codexTemplate = PROVIDER_REGISTRY.find((t) => t.id === "codex");
    const codexApiModels = codexTemplate?.models ?? [];
    provider = {
      id: "codex-oauth",
      type: "codex",
      host: "codex",
      models: [...new Set([...allModels, ...codexApiModels])],
      env: {},
    };
    log.info(`[resolveProvider] codex-oauth → agent="codex", ${provider.models.length} models`);
  }

  // ── Step 0c: gemini-cli virtual provider ─────────────────────────────────────
  if (providerId === "gemini-cli") {
    agent = "gemini-cli";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "gemini-cli");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    provider = {
      id: "gemini-cli",
      type: "gemini-cli",
      host: "gemini-cli",
      models: [...new Set([...allModels])],
      env: {},
    };
    log.info(`[resolveProvider] gemini-cli → agent="gemini-cli", ${provider.models.length} models`);
  }

  // ── Step 0d: kimi CLI virtual provider ──────────────────────────────────────
  if (providerId === "kimi") {
    agent = "kimi";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "kimi");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    provider = {
      id: "kimi",
      type: "openai-compat",
      host: "kimi",
      baseUrl: registryTemplate?.baseUrl ?? "https://api.moonshot.cn/v1",
      models: [...new Set([...allModels])],
      env: {},
    };
    log.info(`[resolveProvider] kimi → agent="kimi", ${provider.models.length} models`);
  }

  // ── Step 0e: cursor CLI virtual provider ────────────────────────────────────
  if (providerId === "cursor") {
    agent = "cursor";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "cursor");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    provider = {
      id: "cursor",
      type: "openai-compat",
      host: "cursor",
      models: [...new Set([...allModels])],
      env: {},
    };
    log.info(`[resolveProvider] cursor → agent="cursor", ${provider.models.length} models`);
  }

  // ── Step 0g: copilot CLI virtual provider ───────────────────────────────────
  if (providerId === "copilot") {
    agent = "copilot";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "copilot");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    provider = {
      id: "copilot",
      type: "openai-compat",
      host: "copilot",
      models: [...new Set([...allModels])],
      env: {},
    };
    log.info(`[resolveProvider] copilot → agent="copilot", ${provider.models.length} models`);
  }

  // ── Step 0h: mimo-claude virtual provider (MIMO via Claude Code CLI) ─────────
  if (providerId === "mimo-claude") {
    agent = "claude";
    const registryTemplate = PROVIDER_REGISTRY.find((t) => t.id === "mimo-claude");
    const registryModels = registryTemplate?.models ?? [];
    const allModels = model && !registryModels.includes(model) ? [model, ...registryModels] : registryModels;
    // Inherit MIMO key from the configured mimo provider in the store.
    // The main MIMO provider (mimo-compat/openclaude) stores the key as OPENAI_API_KEY
    // or ANTHROPIC_AUTH_TOKEN. We check ALL possible locations.
    const mimoStoreProvider = ctx.providerStore.listFull().find((p: any) =>
      (p.id || "").toLowerCase().includes("mimo") || (p.label || "").toLowerCase().includes("mimo")
    );
    const mimoKey = mimoStoreProvider?.env?.["ANTHROPIC_AUTH_TOKEN"]
      || mimoStoreProvider?.env?.["MIMO_API_KEY"]
      || mimoStoreProvider?.env?.["ANTHROPIC_API_KEY"]
      || mimoStoreProvider?.env?.["OPENAI_API_KEY"]  // MIMO openclaude adapter stores key here
      || (mimoStoreProvider as any)?.apiKey  // direct property fallback
      || "";
    const mimoBaseUrl = mimoStoreProvider?.env?.["ANTHROPIC_BASE_URL"]
      || registryTemplate?.baseUrl
      || "https://token-plan-ams.xiaomimimo.com/anthropic"; // AMS cluster (user's region)
    provider = {
      id: "mimo-claude",
      type: "anthropic-compat",
      host: "claude",
      baseUrl: mimoBaseUrl,
      tokenEnvVar: "ANTHROPIC_AUTH_TOKEN",
      models: [...new Set([...allModels])],
      env: mimoKey ? { ANTHROPIC_AUTH_TOKEN: mimoKey, MIMO_API_KEY: mimoKey } : {},
    };
    log.info(`[resolveProvider] mimo-claude → agent="claude", key=${mimoKey ? "SET" : "MISSING"}, baseUrl=${mimoBaseUrl}`);
    if (!mimoKey) {
      log.warn(`[resolveProvider] mimo-claude: NO API KEY FOUND in mimo store provider! Check provider env vars.`);
      log.warn(`[resolveProvider] mimo store provider env keys: ${Object.keys(mimoStoreProvider?.env || {}).join(", ") || "none"}`);
    }
  }

  // ── Step 1: Explicit providerId ─────────────────────────────────────────────
  const VIRTUAL_PROVIDER_IDS = ["claude-oauth", "codex-oauth", "gemini-cli", "kimi", "cursor", "copilot", "mimo-claude"];
  if (!provider && providerId && !VIRTUAL_PROVIDER_IDS.includes(providerId)) {
    provider = ctx.providerStore.listFull().find((p: any) => p.id === providerId) ?? null;
    if (!provider) {
      return {
        agent,
        provider: null,
        providerId: null,
        model,
        error: `Provider "${providerId}" not found in store. Available: ${ctx.providerStore.listFull().map((p: any) => p.id).join(", ") || "none"}`,
      };
    }
  }

  // ── Step 2: Model-based lookup ──────────────────────────────────────────────
  // Search enhanced providers (includes virtual claude-oauth) + file-backed store
  if (!provider && model) {
    const targetType = getProviderTypeForModel(model);
    if (targetType) {
      const allProviders = getEnhancedProviders(ctx);

      // ── Agent-pinned resolution: when agent explicitly specifies a dedicated CLI,
      // ALWAYS prefer its matching virtual provider — never let generic type-matching
      // pick a different provider (e.g. OpenRouter) and corrupt the agent binary.
      //
      // codex agent + any gpt-*/o* model → codex-oauth (ChatGPT) or codex (API key)
      if ((agent === "codex") && (targetType === "openai-compat" || targetType === "codex")) {
        provider = allProviders.find((p: any) => p.id === "codex-oauth")
                ?? allProviders.find((p: any) => p.type === "codex")
                ?? null;
        if (provider) {
          log.info(`[resolveProvider] codex agent + model "${model}" (${targetType}) → pinned to "${provider.id}"`);
        }
      }

      // gemini-cli agent + gemini-* model → gemini-cli provider (native CLI)
      if (!provider && (agent === "gemini" || agent === "gemini-cli") && targetType === "gemini-compat") {
        provider = allProviders.find((p: any) => p.id === "gemini-cli") ?? null;
        if (provider) {
          agent = "gemini-cli"; // normalize agent to canonical name
          log.info(`[resolveProvider] gemini-cli agent + model "${model}" → pinned to gemini-cli provider`);
        }
      }

      // kimi agent + kimi-* model → kimi provider (not generic openai-compat)
      if (!provider && agent === "kimi" && targetType === "openai-compat") {
        provider = allProviders.find((p: any) => p.id === "kimi"
                || p.type === "openai-compat" && (p.id ?? "").toLowerCase().includes("kimi"))
                ?? null;
        if (provider) {
          log.info(`[resolveProvider] kimi agent + model "${model}" → pinned to kimi provider`);
        }
      }

      // For claude models: prefer claude-oauth (Plano Claude) when CLI is detected,
      // regardless of agent name — session restore / orchestrator may send agent="openclaude"
      if (!provider && targetType === "anthropic-compat") {
        provider = allProviders.find((p: any) => p.id === "claude-oauth") ?? null;
        if (provider) {
          agent = "claude"; // must use claude CLI for OAuth
          log.info(`[resolveProvider] Claude model "${model}" → claude-oauth (Plano)`);
        }
      }

      // gemini-compat model without a pinned agent → prefer openclaude gemini provider
      // (NOT gemini-cli, which is the native binary and requires explicit agent="gemini")
      if (!provider && targetType === "gemini-compat") {
        provider = allProviders.find((p: any) => p.type === "gemini-compat") ?? null;
        if (provider) {
          log.info(`[resolveProvider] Gemini model "${model}" → openclaude gemini-compat provider "${provider.id}"`);
        }
      }

      // Fall back to first provider of matching type (e.g. direct Anthropic API key)
      if (!provider) {
        provider = allProviders.find((p: any) => p.type === targetType) ?? null;
      }

      // ── preferredAgent tiebreaker: switch provider if user's preferred CLI has this model ──
      // When model matches multiple providers (e.g. mimo-v2.5-pro in mimo-EYRZH3 AND mimo-claude),
      // prefer the provider whose host matches preferredAgent. This handles the case where
      // type-based lookup picks mimo-compat (openclaude) but user wants claude CLI.
      if (provider && preferredAgent && provider.host !== preferredAgent) {
        // Search ALL enhanced providers + virtual providers for same model with matching host
        const preferredCandidate = allProviders.find((p: any) =>
          p.host === preferredAgent &&
          (p.models ?? []).includes(model!) &&
          p.id !== provider.id
        );
        if (preferredCandidate) {
          log.info(`[resolveProvider] preferredAgent="${preferredAgent}" → switching from "${provider.id}" (host=${provider.host}) to "${preferredCandidate.id}" (host=${preferredCandidate.host}) for model "${model}"`);
          provider = preferredCandidate;
        }
      }
      // Fallback: if no direct provider found (e.g. anthropic-compat unavailable),
      // try OpenRouter or any openai-compat provider that might proxy the model.
      // IMPORTANT: only use OpenRouter as last resort — never for agent-pinned CLIs
      // (codex, gemini, kimi) because OpenRouter uses openclaude, not their native binary.
      const isAgentPinnedCli = agent === "codex" || agent === "gemini" || agent === "gemini-cli" || agent === "kimi" || agent === "cursor" || agent === "copilot";
      if (!provider && targetType !== "openai-compat" && !isAgentPinnedCli) {
        provider = allProviders.find((p: any) => {
          if (p.type !== "openai-compat") return false;
          const pm: string[] = p.models ?? [];
          const isOpenRouter = (p.id ?? "").startsWith("openrouter") ||
            (p.baseUrl || "").includes("openrouter");
          // OpenRouter supports any model via "provider/model" format
          if (isOpenRouter) return true;
          // Other openai-compat: check if they have this model or a similar one
          return pm.some((m: string) => m.includes(model!.split("-").slice(0, 2).join("-")));
        }) ?? null;
        if (provider) {
          log.info(`[resolveProvider] Model "${model}" (type "${targetType}") → fallback to openai-compat provider "${provider.id}"`);
        }
      }
      if (provider) {
        providerId = provider.id;
        log.info(`[resolveProvider] Model "${model}" → type "${targetType}" → provider "${provider.id}"`);
      }
    }
  }

  // ── Step 3: Inheritance from last spawned pane ──────────────────────────────
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
      if (!agent || agent === "openclaude") agent = callerCfg.agent ?? agent;
      providerId = callerCfg.providerId ?? null;
      model = callerCfg.model;
      provider = providerId ? ctx.providerStore.listFull().find((p: any) => p.id === providerId) ?? null : null;
    }
  }

  // ── Step 4: Fallback to first available provider ────────────────────────────
  // Search both the file-backed store AND enhanced providers (which includes virtual claude-oauth)
  if (!provider && !model) {
    const allProviders = getEnhancedProviders(ctx);

    // When agent is "claude", prefer claude-oauth (auto-detected CLI) first
    if (agent === "claude") {
      provider = allProviders.find((p: any) => p.id === "claude-oauth") ?? null;
    }
    if (!provider && agent === "gemini") {
      provider = allProviders.find((p: any) => p.host === "gemini" || p.id?.toLowerCase().includes("gemini")) ?? null;
    }
    if (!provider && agent === "codex") {
      provider = allProviders.find((p: any) => p.id === "codex-oauth") ?? null;
    }
    if (!provider && agent === "gemini-cli") {
      provider = allProviders.find((p: any) => p.id === "gemini-cli") ?? null;
    }
    if (!provider) provider = allProviders.find((p: any) => p.type === "mimo-compat") ?? null;
    if (!provider) provider = allProviders.find((p: any) => p.type === "anthropic-compat") ?? null;
    if (!provider) provider = allProviders.find((p: any) => p.type === "gemini-compat") ?? null;
    if (!provider) provider = allProviders.find((p: any) => p.host === "claude") ?? null;
    if (!provider) provider = allProviders.find((p: any) => p.host === "openclaude") ?? null;
    if (provider) providerId = provider.id;
  }

  // ── Model validation ────────────────────────────────────────────────────────
  if (provider && model) {
    // OpenRouter supports any "provider/model" format — skip strict validation
    // to allow users to add any model ID dynamically (e.g. "meta-llama/llama-3.1-405b-instruct")
    const isOpenRouter = (provider.id ?? "").startsWith("openrouter") ||
      (provider.type === "openai-compat" && (provider.baseUrl || "").includes("openrouter"));
    const isSlashModel = model.includes("/");

    if (isOpenRouter && isSlashModel) {
      log.info(`[resolveProvider] OpenRouter model "${model}" — skipping strict validation`);
    } else {
    const providerModels: string[] = provider.models ?? [];
    const enhancedModels: string[] = ENHANCED_MODEL_MAP[provider.type ?? ""] ?? [];
    const modelKnown = providerModels.includes(model) || enhancedModels.includes(model);

    if (providerModels.length > 0 && !modelKnown) {
      const targetType = getProviderTypeForModel(model);
      // Try to find a better-suited provider
      const betterProvider =
        (targetType && targetType !== provider.type
          ? ctx.providerStore.listFull().find((p: any) => p.type === targetType)
          : null) ??
        ctx.providerStore.listFull().find((p: any) => {
          const pm: string[] = p.models ?? [];
          const em: string[] = ENHANCED_MODEL_MAP[p.type ?? ""] ?? [];
          return pm.includes(model!) || em.includes(model!);
        }) ?? null;

      if (betterProvider) {
        log.info(`[resolveProvider] Model "${model}" → switching provider from "${provider.id}" to "${betterProvider.id}"`);
        provider = betterProvider;
        providerId = betterProvider.id;
      } else {
        const fallback = enhancedModels[0] || providerModels[0];
        log.warn(`[resolveProvider] Model "${model}" not found in any provider. Falling back to: ${fallback}`);
        model = fallback;
      }
    }
    } // end else (not OpenRouter slash-model)
  } else if (!provider && model) {
    const allSupported = ctx.providerStore.listFull().flatMap((p: any) => (p.models ?? []).map((m: string) => `${p.id}:${m}`));
    return {
      agent,
      provider: null,
      providerId: null,
      model,
      error: `No provider configured for model "${model}". Model type: ${getProviderTypeForModel(model) ?? "unknown"}. Configured: ${allSupported.join(", ") || "none"}`,
    };
  } else if (provider && !model) {
    const enhanced = ENHANCED_MODEL_MAP[provider.type ?? ""];
    model = (enhanced && enhanced.length > 0 ? enhanced : provider.models)?.[0];
  }

  // ── Safety: MIMO (mimo-compat/openclaude) has no native CLI — force openclaude ──
  // Note: mimo-claude (anthropic-compat/claude) is intentionally allowed through.
  if (provider && agent === "claude" && provider.type === "mimo-compat") {
    log.info(`[resolveProvider] Overriding agent "claude" → "openclaude" for mimo-compat`);
    agent = "openclaude";
  }

  return { agent, provider, providerId, model };
}
