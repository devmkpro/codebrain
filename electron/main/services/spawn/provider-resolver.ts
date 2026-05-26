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

  // ── Step 1: Explicit providerId ─────────────────────────────────────────────
  if (!provider && providerId && providerId !== "claude-oauth") {
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

      // For claude models + claude agent, prefer claude-oauth (OAuth, no API key needed)
      if (targetType === "anthropic-compat" && agent === "claude") {
        provider = allProviders.find((p: any) => p.id === "claude-oauth") ?? null;
      }
      // Fall back to first provider of matching type
      if (!provider) {
        provider = allProviders.find((p: any) => p.type === targetType) ?? null;
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

  // ── Safety: MIMO has no CLI — force openclaude ──────────────────────────────
  if (provider && agent === "claude" && provider.type === "mimo-compat") {
    log.info(`[resolveProvider] Overriding agent "claude" → "openclaude" for mimo-compat`);
    agent = "openclaude";
  }

  return { agent, provider, providerId, model };
}
