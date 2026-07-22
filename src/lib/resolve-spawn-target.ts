/**
 * Pure resolver for spawn target (providerId, model, agent, env).
 * Centralises the logic previously duplicated in useSpawnPane.ts and AppHeader.tsx.
 *
 * When a model matches multiple providers, preferredAgent is used as tie-breaker:
 * the provider whose `host` === preferredAgent wins. Falls back to the first match.
 */

export interface SpawnTarget {
  providerId: string | undefined;
  model: string | undefined;
  agent: string;
  env: Record<string, string>;
}

interface ResolveOpts {
  /** Explicit providerId passed by caller (already resolved). */
  providerId?: string;
  /** Explicit model passed by caller. */
  model?: string;
  /** All installed providers (any shape — uses id, host, type, models, env). */
  providers: any[];
  /** Global preferred agent: 'claude' | 'openclaude' | 'gemini' | 'codex' | null. */
  preferredAgent?: string | null;
  /** Per-provider default models from localStorage. */
  providerDefaultModels?: Record<string, string>;
}

/** Provider type → prefix mapping for fallback resolution. */
const PREFIX_TYPE_MAP: Array<{ prefixes: string[]; type: string }> = [
  { prefixes: ["claude-", "opus-", "sonnet-", "haiku-"], type: "oauth" },
  { prefixes: ["gemini-"], type: "gemini-compat" },
  { prefixes: ["mimo-"], type: "mimo-compat" },
  { prefixes: ["gpt-", "o"], type: "openai-compat" },
];

/**
 * Pick the best provider from a list of candidates, using preferredAgent as tie-breaker.
 * If preferredAgent is set, prefer the candidate whose host matches it.
 * Otherwise (or if none match), return the first candidate.
 */
function pickProvider(candidates: any[], preferredAgent?: string | null): any | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  if (preferredAgent) {
    const preferred = candidates.find((p: any) => p.host === preferredAgent);
    if (preferred) return preferred;
  }
  return candidates[0];
}

export function resolveSpawnTarget(opts: ResolveOpts & {
  /**
   * Whether the caller explicitly provided providerId and/or model.
   * When explicit, agent derives strictly from the provider host.
   * When not explicit (using favoritePane/defaults), preferredAgent
   * is used to override the agent when set.
   */
  explicit?: boolean;
  /** Agent from favoritePane (only relevant when explicit=false). */
  favoriteAgent?: string;
}): SpawnTarget {
  const {
    providerId: explicitPid,
    model: explicitModel,
    providers,
    preferredAgent,
    providerDefaultModels,
    explicit = true,
    favoriteAgent,
  } = opts;

  let nextProviderId = explicitPid;
  let nextModel = explicitModel;

  // ── Step 1: If model given but provider not, resolve provider from model name. ──
  if (nextModel && !nextProviderId) {
    // Collect ALL providers that list this model (not just the first).
    const candidates = providers.filter((p: any) => p.models?.includes(nextModel));
    const chosen = pickProvider(candidates, preferredAgent);
    if (chosen) {
      nextProviderId = chosen.id;
    } else {
      // Fallback by model prefix → provider type.
      const lower = nextModel.toLowerCase();
      for (const rule of PREFIX_TYPE_MAP) {
        if (rule.prefixes.some((prefix) => lower.startsWith(prefix))) {
          // Among providers of this type, prefer by preferredAgent.
          const typeCandidates = providers.filter(
            (p: any) => p.type === rule.type || (rule.type === "oauth" && p.type === "anthropic-compat"),
          );
          const chosenByType = pickProvider(typeCandidates, preferredAgent);
          if (chosenByType) nextProviderId = chosenByType.id;
          break;
        }
      }
    }
  }

  // ── Step 1b: preferredAgent tiebreaker for explicit providerId ─────────────
  // Even when providerId is explicitly set, if the model exists in multiple providers
  // and preferredAgent prefers a different one (e.g. mimo-claude over mimo-EYRZH3),
  // switch to the preferred provider. This handles the case where SquadModal sends
  // providerId=mimo-EYRZH3 but user wants claude CLI for mimo models.
  if (nextModel && nextProviderId && preferredAgent) {
    const currentProvider = providers.find((p: any) => p.id === nextProviderId);
    if (currentProvider && currentProvider.host !== preferredAgent) {
      // Check if there's another provider with the same model whose host matches preferredAgent
      const candidates = providers.filter((p: any) =>
        p.models?.includes(nextModel) && p.host === preferredAgent
      );
      if (candidates.length > 0) {
        nextProviderId = candidates[0].id;
      }
    }
  }

  // ── Step 2: Resolve provider object ──
  const provider = nextProviderId
    ? providers.find((p: any) => p.id === nextProviderId)
    : null;

  // ── Step 3: Resolve agent ──
  // Agent is determined by the chosen provider's host.
  // For non-explicit spawns, allow favoriteAgent or preferredAgent as override.
  //
  // Special case: OpenRouter (openai-compat) supports the Anthropic protocol via
  // ANTHROPIC_BASE_URL. When preferredAgent="claude", allow Claude Code CLI to be
  // used with OpenRouter — the backend will configure ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN.
  const isOpenRouterProvider =
    provider?.type === "openai-compat" &&
    ((provider?.id ?? "").startsWith("openrouter") || (provider?.baseUrl ?? "").toLowerCase().includes("openrouter"));

  let agent: string;
  if (explicit) {
    // Explicit: normally derive from provider host, but honour preferredAgent for OpenRouter.
    if (isOpenRouterProvider && preferredAgent === "claude") {
      agent = "claude";
    } else {
      agent = provider?.host ?? (provider?.type === "oauth" ? "claude" : "openclaude");
    }
  } else {
    // Non-explicit: preferredAgent > favoriteAgent > provider.host > fallback
    agent = preferredAgent ?? favoriteAgent ?? provider?.host ?? "openclaude";
  }

  // ── Step 4: Build env (merge provider env + model env vars) ──
  const env: Record<string, string> = {
    ...(provider?.env ?? {}),
    ...(nextModel ? { ANTHROPIC_MODEL: nextModel, MODEL: nextModel } : {}),
  };

  return {
    providerId: nextProviderId,
    model: nextModel,
    agent,
    env,
  };
}

/** Friendly labels for known hosts. */
export const HOST_LABELS: Record<string, string> = {
  claude: "Claude Code CLI",
  openclaude: "OpenClaude",
  gemini: "Gemini CLI",
  codex: "Codex",
};
