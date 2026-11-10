import type { AppContext } from "../context";
import { PROVIDER_REGISTRY } from "./constants";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CLI_REGISTRY } from "./spawn/cli-registry";
import { createCliModelCatalog, MODEL_CATALOG_TTL_MS } from "./cli-model-catalog";
import { sortModelIds, type ModelReleaseInfo } from "../../../src/lib/model-catalog-order";

const cliCatalogs = new WeakMap<object, ReturnType<typeof createCliModelCatalog>>();
const syncInFlight = new WeakMap<object, Map<string, Promise<ProviderModelSyncSummary>>>();
const NATIVE_PROVIDER_IDS: Record<string, string> = {
  claude: "claude-oauth",
  codex: "codex-oauth",
  gemini: "gemini-cli",
  kimi: "kimi",
  cursor: "cursor",
  copilot: "copilot",
};
export const providerIdForHarness = (cli: string) => NATIVE_PROVIDER_IDS[cli] ?? `${cli}-cli`;

/**
 * Merge user-saved models with template models.
 * - If user has explicitly saved models (edited via UI), respect their choice (no template merge).
 * - If no saved models exist (fresh provider), use template defaults.
 * - User-saved models that aren't in the template are always preserved (custom additions).
 */
function mergeModels(
  saved: string[] | undefined,
  templateModels: string[],
  isExistingProvider: boolean
): string[] {
  const cleaned = (saved ?? []).map((m) => m.trim()).filter(Boolean);
  // Existing provider with user-saved models → respect user edits, don't re-add template models
  if (isExistingProvider && cleaned.length > 0) return cleaned;
  // Existing provider with empty models → user cleared them all, keep empty (don't repopulate)
  if (isExistingProvider && cleaned.length === 0) return saved !== undefined ? [] : templateModels;
  // New provider (no saved data) → use template defaults + any custom additions
  const savedSet = new Set(cleaned);
  const templateSet = new Set(templateModels);
  const merged = [...templateModels];
  for (const m of savedSet) {
    if (!templateSet.has(m)) merged.push(m);
  }
  return merged.length > 0 ? merged : templateModels;
}

export function mergeModelCatalogs(...catalogs: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const catalog of catalogs) {
    for (const model of catalog ?? []) {
      const id = model.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
}

function virtualProviderModels(saved: any, canonical: string[]): string[] {
  if (saved?.modelsMode === "manual")
    return sortModelIds(mergeModelCatalogs(saved.models), saved.modelsMetadata);
  // A static release list is only a fallback. Never reinsert retired models
  // after a successful CLI catalog refresh.
  return sortModelIds(
    saved?.models?.length ? mergeModelCatalogs(saved.models) : canonical,
    saved?.modelsMetadata
  );
}

export function getEnhancedProviders(ctx: AppContext) {
  const list = ctx.providerStore.listFull();
  const claudeDetected = ctx.cliDetector?.getAll()?.claude?.found ?? false;

  // Virtual Claude OAuth provider — appears when Claude CLI is installed
  // Respect user-saved models (e.g. after "Detectar modelos") over hardcoded template defaults
  const claudeOAuthTemplate = PROVIDER_REGISTRY.find((t) => t.id === "claude-oauth");
  const claudeOAuthSaved = list.find((p) => p.id === "claude-oauth");
  const claudeOAuthProvider =
    claudeDetected && claudeOAuthTemplate
      ? [
          {
            id: claudeOAuthTemplate.id,
            label: claudeOAuthSaved?.label?.trim() || claudeOAuthTemplate.label,
            type: claudeOAuthTemplate.type as "oauth",
            host: claudeOAuthTemplate.host,
            models: virtualProviderModels(claudeOAuthSaved, claudeOAuthTemplate.models),
            modelsMode: claudeOAuthSaved?.modelsMode ?? "auto",
            env: {},
            isVirtual: true,
          },
        ]
      : [];

  // Virtual Codex OAuth provider — appears when Codex CLI is installed
  const codexDetected = ctx.cliDetector?.getAll()?.codex?.found ?? false;
  const codexOAuthTemplate = PROVIDER_REGISTRY.find((t) => t.id === "codex-oauth");
  const codexOAuthSaved = list.find((p) => p.id === "codex-oauth");
  const codexOAuthProvider =
    codexDetected && codexOAuthTemplate
      ? [
          {
            id: codexOAuthTemplate.id,
            label: codexOAuthSaved?.label?.trim() || codexOAuthTemplate.label,
            type: codexOAuthTemplate.type as any,
            host: codexOAuthTemplate.host,
            models: virtualProviderModels(codexOAuthSaved, codexOAuthTemplate.models),
            modelsMode: codexOAuthSaved?.modelsMode ?? "auto",
            env: {},
            isVirtual: true,
          },
        ]
      : [];

  // Filter out the virtual claude-oauth and Gemini CLI label to avoid duplicates
  // Virtual Gemini CLI provider — appears when gemini CLI is installed
  const geminiCliDetected = ctx.cliDetector?.getAll()?.gemini?.found ?? false;
  const geminiCliTemplate = PROVIDER_REGISTRY.find((t) => t.id === "gemini-cli");
  const geminiCliSaved = list.find((p) => p.id === "gemini-cli");
  const geminiCliProvider =
    geminiCliDetected && geminiCliTemplate
      ? [
          {
            id: geminiCliTemplate.id,
            label: geminiCliSaved?.label?.trim() || geminiCliTemplate.label,
            type: geminiCliTemplate.type as any,
            host: geminiCliTemplate.host,
            models: virtualProviderModels(geminiCliSaved, geminiCliTemplate.models),
            modelsMode: geminiCliSaved?.modelsMode ?? "auto",
            env: {},
            isVirtual: true,
          },
        ]
      : [];

  const VIRTUAL_IDS = [
    "claude-oauth",
    "codex-oauth",
    "gemini-cli",
    "kimi",
    "cursor",
    "copilot",
    "mimo-claude",
  ];
  const filtered = list
    .filter((p) => !VIRTUAL_IDS.includes(p.id) && !p.label?.includes("Gemini CLI"))
    .map((p) => {
      // Look up the canonical template by id
      const template = PROVIDER_REGISTRY.find((t) => t.id === p.id);
      if (template) {
        // For MIMO (openclaude), always use the registry label so it reads
        // "MIMO via OpenClaude" instead of user-saved "MIMO".
        const label = template.id === "mimo" ? template.label : p.label;
        return {
          ...p,
          label,
          // Respect user-saved host (e.g. "claude" for mimo-claude path).
          // Only fall back to template.host if the user hasn't explicitly set one.
          host: p.host || template.host,
          type: template.type as any,
          // Respect user-saved models for existing providers; only merge template defaults for new ones
          models: mergeModels(p.models, template.models, true),
        };
      }

      // Fallback: detect by label/id keywords (for custom providers).
      // Match the MOST SPECIFIC template first (most keywords matched) to avoid
      // false positives from short keywords like "mimo" matching "mimo-claude".
      const label = p.label?.toLowerCase() || "";
      const id = (p.id || "").toLowerCase();
      let bestMatch: (typeof PROVIDER_REGISTRY)[number] | null = null;
      let bestScore = 0;
      for (const tpl of PROVIDER_REGISTRY) {
        const labelHits =
          tpl.labelIncludes?.filter((k) => label.includes(k.toLowerCase())).length ?? 0;
        const idHits = tpl.idIncludes?.filter((k) => id.includes(k.toLowerCase())).length ?? 0;
        const score = labelHits + idHits;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = tpl;
        }
      }
      if (bestMatch) {
        const resolvedLabel = bestMatch.id === "mimo" ? bestMatch.label : p.label;
        return {
          ...p,
          label: resolvedLabel,
          host: p.host || bestMatch.host,
          type: bestMatch.type as any,
          models: mergeModels(p.models, bestMatch.models, true),
        };
      }

      // Unknown provider — default to openclaude, but keep user-saved models
      return { ...p, host: p.host || "openclaude" };
    });

  // Virtual Kimi CLI provider — appears when Kimi CLI is installed
  const kimiDetected = ctx.cliDetector?.getAll()?.kimi?.found ?? false;
  const kimiTemplate = PROVIDER_REGISTRY.find((t) => t.id === "kimi");
  const kimiSaved = list.find((p) => p.id === "kimi");
  const kimiProvider =
    kimiDetected && kimiTemplate
      ? [
          {
            id: kimiTemplate.id,
            label: kimiSaved?.label?.trim() || kimiTemplate.label,
            type: kimiTemplate.type as any,
            host: kimiTemplate.host,
            models: virtualProviderModels(kimiSaved, kimiTemplate.models),
            modelsMode: kimiSaved?.modelsMode ?? "auto",
            env: {},
            isVirtual: true,
          },
        ]
      : [];

  // Virtual Cursor CLI provider — appears when Cursor CLI is installed
  const cursorDetected = ctx.cliDetector?.getAll()?.cursor?.found ?? false;
  const cursorTemplate = PROVIDER_REGISTRY.find((t) => t.id === "cursor");
  const cursorSaved = list.find((p) => p.id === "cursor");
  const cursorProvider =
    cursorDetected && cursorTemplate
      ? [
          {
            id: cursorTemplate.id,
            label: cursorSaved?.label?.trim() || cursorTemplate.label,
            type: cursorTemplate.type as any,
            host: cursorTemplate.host,
            models: virtualProviderModels(cursorSaved, cursorTemplate.models),
            modelsMode: cursorSaved?.modelsMode ?? "auto",
            env: {},
            isVirtual: true,
          },
        ]
      : [];

  // Virtual Copilot CLI provider — appears when Copilot CLI is installed
  const copilotDetected = ctx.cliDetector?.getAll()?.copilot?.found ?? false;
  const copilotTemplate = PROVIDER_REGISTRY.find((t) => t.id === "copilot");
  const copilotSaved = list.find((p) => p.id === "copilot");
  const copilotProvider =
    copilotDetected && copilotTemplate
      ? [
          {
            id: copilotTemplate.id,
            label: copilotSaved?.label?.trim() || copilotTemplate.label,
            type: copilotTemplate.type as any,
            host: copilotTemplate.host,
            models: virtualProviderModels(copilotSaved, copilotTemplate.models),
            modelsMode: copilotSaved?.modelsMode ?? "auto",
            env: {},
            isVirtual: true,
          },
        ]
      : [];

  // Virtual MIMO via Claude provider — appears when Claude CLI is installed AND user has a MIMO provider configured
  const mimoClaudeTemplate = PROVIDER_REGISTRY.find((t) => t.id === "mimo-claude");
  const mimoConfigured = list.find((p) => {
    const label = p.label?.toLowerCase() || "";
    const id = (p.id || "").toLowerCase();
    return id.includes("mimo") || label.includes("mimo");
  });
  const hasMimoConfigured = !!mimoConfigured;
  // Inherit the MIMO API key from the configured mimo provider.
  // The key may be stored in various env var names depending on the provider adapter
  // (MIMO uses openai-compat → OPENAI_API_KEY, or mimo-compat → MIMO_API_KEY/ANTHROPIC_AUTH_TOKEN).
  // We check ALL possible locations to ensure the key is found.
  const mimoKey =
    mimoConfigured?.env?.["ANTHROPIC_AUTH_TOKEN"] ||
    mimoConfigured?.env?.["MIMO_API_KEY"] ||
    mimoConfigured?.env?.["ANTHROPIC_API_KEY"] ||
    mimoConfigured?.env?.["OPENAI_API_KEY"] || // MIMO openclaude adapter stores key here
    "";
  // Inherit baseUrl from the user's configured MIMO provider (ANTHROPIC_BASE_URL),
  // falling back to the template default. This ensures the correct regional endpoint
  // (ams/sgp/cn) is used instead of the hardcoded template URL.
  const mimoBaseUrl =
    mimoConfigured?.env?.["ANTHROPIC_BASE_URL"] ||
    mimoClaudeTemplate?.baseUrl ||
    "https://token-plan-ams.xiaomimimo.com/anthropic";
  const mimoClaudeProvider =
    claudeDetected && hasMimoConfigured && mimoClaudeTemplate
      ? [
          {
            id: mimoClaudeTemplate.id,
            label: mimoClaudeTemplate.label,
            type: mimoClaudeTemplate.type as any,
            host: mimoClaudeTemplate.host,
            baseUrl: mimoBaseUrl,
            models: mimoConfigured?.models?.length
              ? [...mimoConfigured.models]
              : [...mimoClaudeTemplate.models],
            env: mimoKey ? { ANTHROPIC_AUTH_TOKEN: mimoKey, MIMO_API_KEY: mimoKey } : {},
          },
        ]
      : [];

  const all: any[] = [
    ...claudeOAuthProvider,
    ...codexOAuthProvider,
    ...geminiCliProvider,
    ...kimiProvider,
    ...cursorProvider,
    ...copilotProvider,
    ...mimoClaudeProvider,
    ...filtered,
  ];
  const detected = ctx.cliDetector?.getAll() ?? {};
  for (const entry of CLI_REGISTRY) {
    if (
      !entry.capabilities.model ||
      entry.id === "openclaude" ||
      !(detected as any)[entry.id]?.found
    )
      continue;
    const id = providerIdForHarness(entry.id);
    if (!all.some((provider) => provider.id === id)) {
      const saved = list.find((provider) => provider.id === id);
      all.push({
        ...saved,
        id,
        label: saved?.label || entry.label,
        host: entry.id,
        type: "cli",
        env: {},
        models: saved?.models ?? [],
        isVirtual: true,
        modelsMode: saved?.modelsMode ?? "auto",
      });
    }
  }
  return all.map((provider) => {
    const saved = list.find((entry) => entry.id === provider.id);
    return {
      ...provider,
      models: sortModelIds(provider.models ?? [], saved?.modelsMetadata as ModelReleaseInfo[]),
      modelsSyncedAt: saved?.modelsSyncedAt ?? null,
      modelsSyncSource: saved?.modelsSyncSource ?? "bundled-fallback",
      modelsStale: saved?.modelsStale ?? true,
      modelsSyncError: saved?.modelsSyncError ?? null,
      modelsAttemptedAt: saved?.modelsAttemptedAt ?? null,
      modelsMetadata: saved?.modelsMetadata ?? [],
      modelsMode: saved?.modelsMode ?? provider.modelsMode ?? "auto",
    };
  });
}

// ─── Dynamic model discovery ──────────────────────────────

const NON_CHAT_KEYWORDS = [
  "embed",
  "embedding",
  "tts",
  "whisper",
  "speech",
  "rerank",
  "audio",
  "moderation",
  "transcri",
  "image",
  "imagen",
  "realtime",
  "video",
  "veo",
  "sora",
  "ocr",
  "computer-use",
];

function isNonChatModel(id: string): boolean {
  const parts = id.toLowerCase().split(/[-_]/);
  return NON_CHAT_KEYWORDS.some((kw) => parts.includes(kw) || id.toLowerCase().includes(kw));
}

/** Strip non-ASCII / non-printable chars from an API key before using in HTTP headers */
function sanitizeApiKey(key: string): string {
  // HTTP headers only allow bytes 0x00-0xFF (Latin-1). Strip anything above 0xFF
  // and also remove common invisible unicode (zero-width, BOM, etc.)
  return key
    .replace(/[Ā-￿]/g, "") // remove chars outside Latin-1
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // remove control chars except \t \n \r
    .replace(/[\r\n]/g, "") // remove newlines
    .trim();
}

/** Normalise a base URL so it never ends in /v1 or /v1/ — callers append /v1/... themselves. */
function stripV1Suffix(base: string): string {
  return base.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

export async function listModelsFromEndpoint(args: {
  baseUrl: string;
  apiKey: string;
  type: string;
}): Promise<{ ok: boolean; models?: string[]; metadata?: ModelReleaseInfo[]; error?: string }> {
  const { baseUrl, type } = args;
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl))
    return { ok: false, error: "endpoint de modelos inválido" };
  if (typeof args.apiKey !== "string" || /^\*+$/.test(args.apiKey.trim()))
    return { ok: false, error: "chave de catálogo inválida ou mascarada" };
  const apiKey = sanitizeApiKey(args.apiKey);
  const base = baseUrl.replace(/\/$/, "");

  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // MIMO: base URL may end with /anthropic (e.g. .../anthropic) — strip it to get the root,
  // then use /v1/models with Bearer auth (OpenAI-compat endpoint confirmed via recon)
  const isMimo = type === "mimo-compat" || base.includes("xiaomimimo.com");
  if (isMimo) {
    const mimoRoot = base.replace(/\/anthropic$/, "");
    url = `${stripV1Suffix(mimoRoot)}/v1/models`;
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (type === "anthropic-compat") {
    url = `${stripV1Suffix(base)}/v1/models?limit=1000`;
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (type === "gemini-compat") {
    const geminiRoot = stripV1Suffix(base).replace(/\/v1beta\/?$/, "");
    url = `${geminiRoot}/v1beta/models?pageSize=1000`;
    if (apiKey) headers["x-goog-api-key"] = apiKey;
  } else {
    // OpenAI-compatible (includes OpenRouter): standard /v1/models endpoint
    // Strip /v1 suffix first to avoid double /v1/v1/models when user saved URL as .../api/v1
    const root = stripV1Suffix(base);
    const isOpenRouter = /openrouter\.ai/i.test(root);
    url = `${root}/v1/models${isOpenRouter ? "?supported_parameters=tools" : ""}`;
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await (globalThis as any).fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    const json = (await response.json()) as any;
    let rawModels: Array<{ id?: string; name?: string }> = [];
    if (Array.isArray(json)) rawModels = json;
    else if (Array.isArray(json.data)) rawModels = json.data;
    else if (Array.isArray(json.models)) rawModels = json.models;

    const models = [
      ...new Set(
        rawModels
          .map((m: any) => {
            const raw: string = typeof m === "string" ? m : m.id || m.name || "";
            // Gemini returns "models/gemini-2.5-pro" — strip the prefix
            return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
          })
          .filter((id: string) => typeof id === "string" && id && !isNonChatModel(id))
      ),
    ];
    const metadata = rawModels.flatMap((entry: any) => {
      if (!entry || typeof entry !== "object") return [];
      const id = String(entry.id || entry.name || "").replace(/^models\//, "");
      if (
        ![
          entry.created,
          entry.created_at,
          entry.release_date,
          entry.releaseDate,
          entry.release,
          entry.date,
        ].some((value) => value != null)
      )
        return [];
      return [
        {
          id,
          created: entry.created,
          created_at: entry.created_at,
          release_date: entry.release_date,
          releaseDate: entry.releaseDate,
          release: typeof entry.release === "object" ? entry.release?.date : entry.release,
          date: entry.date,
        },
      ];
    });
    return {
      ok: true,
      models: sortModelIds(models, metadata),
      ...(metadata.length ? { metadata } : {}),
    };
  } catch (err: unknown) {
    return { ok: false, error: "não foi possível consultar o endpoint de modelos" };
  }
}

export async function listClaudeOAuthModels(): Promise<{
  ok: boolean;
  models?: string[];
  error?: string;
}> {
  const result = await createCliModelCatalog().refresh("claude", "claude");
  return {
    ok: result.models.length > 0 && !result.stale,
    models: result.models,
    error: result.error,
  };
}

export function listCodexCachedModels(): string[] {
  try {
    const cachePath = path.join(os.homedir(), ".codex", "models_cache.json");
    const json = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    return [
      ...new Set(
        (Array.isArray(json.models) ? json.models : [])
          .filter((entry: any) => entry?.visibility !== "hide")
          .map((entry: any) => entry?.slug ?? entry?.id ?? "")
          .filter(Boolean)
      ),
    ] as string[];
  } catch {
    return [];
  }
}

function providerEndpointConfig(
  provider: any
): { baseUrl: string; apiKey: string; type: string } | null {
  const env = provider?.env ?? {};
  const baseUrl =
    env.ANTHROPIC_BASE_URL || env.GEMINI_BASE_URL || env.OPENAI_BASE_URL || provider?.baseUrl || "";
  if (!baseUrl) return null;
  const apiKey =
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_API_KEY ||
    env.GEMINI_API_KEY ||
    env.OPENAI_API_KEY ||
    env.MIMO_API_KEY ||
    env.OPENROUTER_API_KEY ||
    env.FIREWORKS_API_KEY ||
    env.MOONSHOT_API_KEY ||
    env.XAI_API_KEY ||
    "";
  return { baseUrl, apiKey, type: provider.type || "openai-compat" };
}

export interface ProviderModelSyncSummary {
  updated: Array<{ providerId: string; count: number; source: string }>;
  failed: Array<{ providerId: string; error: string }>;
  skipped?: Array<{ providerId: string; reason: string }>;
}

/** Refresh every configured model catalog. Failures preserve the last known list. */
export function syncProviderModels(
  ctx: AppContext,
  options: { providerIds?: string[]; force?: boolean; resetManual?: boolean } = {}
): Promise<ProviderModelSyncSummary> {
  let active = syncInFlight.get(ctx);
  if (!active) {
    active = new Map();
    syncInFlight.set(ctx, active);
  }
  const key = JSON.stringify([
    options.providerIds ? [...options.providerIds].sort() : null,
    Boolean(options.force),
    Boolean(options.resetManual),
  ]);
  if (active.has(key)) return active.get(key)!;
  const work = performProviderModelSync(ctx, options).finally(() => active!.delete(key));
  active.set(key, work);
  return work;
}

async function performProviderModelSync(
  ctx: AppContext,
  options: { providerIds?: string[]; force?: boolean; resetManual?: boolean }
): Promise<ProviderModelSyncSummary> {
  await ctx.cliDetector?.getAllAsync?.();
  const only = options.providerIds ? new Set(options.providerIds) : null;
  const configured = getEnhancedProviders(ctx).filter(
    (provider: any) => !only || only.has(provider.id)
  );
  const updated: ProviderModelSyncSummary["updated"] = [];
  const failed: ProviderModelSyncSummary["failed"] = [];
  const skipped: NonNullable<ProviderModelSyncSummary["skipped"]> = [];
  let catalog = cliCatalogs.get(ctx);
  if (!catalog) {
    catalog = createCliModelCatalog();
    cliCatalogs.set(ctx, catalog);
  }
  const detected = ctx.cliDetector?.getAll() ?? {};
  const syncOne = async (provider: any) => {
      try {
        // Snapshot only metadata; at commit time re-read user edits made while an
        // asynchronous discovery was running.
        if (provider.modelsMode === "manual" && !options.resetManual) {
          skipped.push({ providerId: provider.id, reason: "lista manual preservada" });
          return;
        }
        if (
          !options.force &&
          provider.modelsAttemptedAt &&
          Date.now() - provider.modelsAttemptedAt <
            (provider.modelsStale ? 30_000 : MODEL_CATALOG_TTL_MS)
        )
          return;
        const cli = CLI_REGISTRY.find((entry) => providerIdForHarness(entry.id) === provider.id);
        let models: string[] = [];
        let metadata: ModelReleaseInfo[] = [];
        let source = "endpoint";
        let stale = false;
        let error: string | undefined;
        let fetchedAt: number | null = Date.now();
        if (cli) {
          const binary = (detected as any)[cli.id];
          if (!binary?.found || !binary.path) {
            failed.push({
              providerId: provider.id,
              error: "CLI não detectada com caminho executável",
            });
            return;
          }
          const result = await catalog!.refresh(cli.id, binary.path, binary.version, options.force);
          ({ models, source, stale, error, fetchedAt } = result);
          metadata = result.metadata ?? [];
        } else {
          const endpoint = providerEndpointConfig(provider);
          if (!endpoint) {
            failed.push({
              providerId: provider.id,
              error: "provider sem endpoint de catálogo configurado",
            });
            return;
          }
          const result = await listModelsFromEndpoint(endpoint);
          models = result.models ?? [];
          metadata = result.metadata ?? [];
          error = result.error;
          stale = !result.ok || models.length === 0;
          if (stale) fetchedAt = null;
        }
        const current: any = ctx.providerStore
          .listFull()
          .find((entry: any) => entry.id === provider.id);
        if (current?.modelsMode === "manual" && !options.resetManual) {
          skipped.push({ providerId: provider.id, reason: "lista editada durante atualização" });
          return;
        }
        if (current === undefined && !provider.isVirtual) return; // deleted while querying
        const nextModels = sortModelIds(
          models.length ? models : (current?.models ?? provider.models ?? []),
          metadata.length ? metadata : current?.modelsMetadata
        );
        const result = ctx.providerStore.upsert({
          ...provider,
          ...current,
          env: current?.env ?? provider.env ?? {},
          models: nextModels,
          modelsMode: "auto",
          modelsMetadata: metadata.length ? metadata : (current?.modelsMetadata ?? []),
          modelsSyncedAt: stale ? (current?.modelsSyncedAt ?? fetchedAt) : fetchedAt,
          modelsAttemptedAt: Date.now(),
          modelsSyncSource: models.length
            ? source
            : (current?.modelsSyncSource ?? "bundled-fallback"),
          modelsStale: stale,
          modelsSyncError: error ?? null,
        });
        if (result?.ok === false) {
          failed.push({ providerId: provider.id, error: "não foi possível persistir catálogo" });
          return;
        }
        if (stale)
          failed.push({
            providerId: provider.id,
            error: error || "catálogo desatualizado; lista anterior preservada",
          });
        else updated.push({ providerId: provider.id, count: nextModels.length, source });
      } catch {
        failed.push({
          providerId: provider.id,
          error: "falha ao consultar ou persistir catálogo; lista anterior preservada",
        });
      }
  };
  let nextProvider = 0;
  await Promise.all(Array.from({ length: Math.min(2, configured.length) }, async () => {
    while (nextProvider < configured.length) await syncOne(configured[nextProvider++]);
  }));
  return { updated, failed, ...(skipped.length ? { skipped } : {}) };
}

export interface HealthCheckResult {
  ok: boolean;
  status: "healthy" | "degraded" | "down";
  model?: string;
  checks: {
    endpoint: { ok: boolean; latencyMs?: number; httpStatus?: number };
    models: { ok: boolean; count?: number };
    generation: { ok: boolean; latencyMs?: number; hint?: string };
    tools: { ok: boolean; hint?: string };
  };
  warnings: string[];
  error?: string;
}

export async function healthCheckProvider(args: {
  baseUrl: string;
  apiKey: string;
  type: string;
  model?: string;
}): Promise<HealthCheckResult> {
  const { baseUrl, type } = args;
  const apiKey = sanitizeApiKey(args.apiKey);
  const base = baseUrl.replace(/\/$/, "");
  const warnings: string[] = [];

  const fetchWithTimeout = async (url: string, opts: RequestInit, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await (globalThis as any).fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const isMimo = type === "mimo-compat" || base.includes("xiaomimimo.com");
  // MIMO uses OpenAI-compat /v1/* endpoints; the /anthropic suffix is only for message routing
  const mimoRoot = isMimo ? stripV1Suffix(base.replace(/\/anthropic$/, "")) : stripV1Suffix(base);
  const isAnthropicType = type === "anthropic-compat";
  const isGemini = type === "gemini-compat";
  const isOpenRouter = base.toLowerCase().includes("openrouter");
  // For OpenAI-compat providers that already include /v1 in their base URL (e.g. openrouter.ai/api/v1),
  // we strip it before appending /v1/... to avoid double /v1/v1/... paths.
  const openaiBase = stripV1Suffix(base);

  // ── Check 1: Endpoint reachability ────────────────────────────────────────
  const endpointCheck: HealthCheckResult["checks"]["endpoint"] = { ok: false };
  try {
    const t0 = Date.now();
    // MIMO: probe /v1/models (returns 401 without key, which proves it exists)
    const probeUrl = isMimo ? `${mimoRoot}/v1/models` : base;
    const resp = await fetchWithTimeout(probeUrl, { method: "GET" }, 5000);
    endpointCheck.latencyMs = Date.now() - t0;
    endpointCheck.httpStatus = resp.status;
    // 401 = auth required but endpoint exists → ok
    endpointCheck.ok = resp.status < 500;
  } catch {
    endpointCheck.ok = false;
    warnings.push("Endpoint unreachable");
  }

  // ── Check 2: Model listing ─────────────────────────────────────────────────
  const modelsCheck: HealthCheckResult["checks"]["models"] = { ok: false };
  let selectedModel = args.model;
  // OpenRouter /v1/models returns 400+ models and requires auth — skip listing,
  // mark as ok and use a known cheap model for the generation check.
  if (isOpenRouter) {
    modelsCheck.ok = true;
    modelsCheck.count = -1; // sentinel: skip listing
    if (!selectedModel) selectedModel = "openai/gpt-4o-mini";
  } else {
    try {
      const result = await listModelsFromEndpoint({ baseUrl, apiKey, type });
      if (result.ok && result.models && result.models.length > 0) {
        modelsCheck.ok = true;
        modelsCheck.count = result.models.length;
        if (!selectedModel) selectedModel = result.models[0];
      } else {
        warnings.push("No models returned from /models endpoint");
      }
    } catch {
      warnings.push("Model listing failed");
    }
  }

  if (!selectedModel) {
    // Fallback model names per provider type
    if (isMimo) {
      selectedModel = "mimo-v2.5-pro";
    } else if (isAnthropicType) {
      selectedModel = "claude-haiku-4-5-20251001";
    } else if (isGemini) {
      selectedModel = "gemini-2.0-flash";
    } else {
      selectedModel = "gpt-4o-mini";
    }
  }

  // ── Check 3: Generation ────────────────────────────────────────────────────
  const generationCheck: HealthCheckResult["checks"]["generation"] = { ok: false };
  try {
    // MIMO: messages go to /anthropic/v1/messages (base already has /anthropic, so just /v1/messages)
    // Anthropic: /v1/messages, OpenAI/OpenRouter: /v1/chat/completions
    // MIMO base already ends with /anthropic, so /v1/messages gives .../anthropic/v1/messages
    const chatUrl = isMimo
      ? `${base}/v1/messages`
      : isAnthropicType
        ? `${stripV1Suffix(base)}/v1/messages`
        : `${openaiBase}/v1/chat/completions`;
    const body = JSON.stringify({
      model: selectedModel,
      max_tokens: 8,
      messages: [{ role: "user", content: "say ok" }],
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isMimo || isAnthropicType) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const t0 = Date.now();
    const resp = await fetchWithTimeout(chatUrl, { method: "POST", headers, body }, 15000);
    generationCheck.latencyMs = Date.now() - t0;
    if (resp.ok) {
      generationCheck.ok = true;
    } else {
      const txt = await resp.text().catch(() => "");
      generationCheck.hint = `HTTP ${resp.status}: ${txt.slice(0, 120)}`;
      warnings.push(`Generation HTTP ${resp.status}`);
    }
  } catch (err: unknown) {
    generationCheck.hint = err instanceof Error ? err.message : String(err);
    warnings.push("Generation request failed");
  }

  // ── Check 4: Tool calling ─────────────────────────────────────────────────
  const toolsCheck: HealthCheckResult["checks"]["tools"] = { ok: false };
  try {
    // MIMO base already ends with /anthropic, so /v1/messages gives .../anthropic/v1/messages
    const chatUrl = isMimo
      ? `${base}/v1/messages`
      : isAnthropicType
        ? `${stripV1Suffix(base)}/v1/messages`
        : `${openaiBase}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isMimo || isAnthropicType) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const dummyTool =
      isMimo || isAnthropicType
        ? {
            name: "get_status",
            description: "Get status",
            input_schema: { type: "object", properties: {} },
          }
        : {
            type: "function",
            function: {
              name: "get_status",
              description: "Get status",
              parameters: { type: "object", properties: {} },
            },
          };
    const body = JSON.stringify({
      model: selectedModel,
      max_tokens: 8,
      messages: [{ role: "user", content: "use the tool" }],
      tools: [dummyTool],
    });
    const resp = await fetchWithTimeout(chatUrl, { method: "POST", headers, body }, 15000);
    if (resp.ok) {
      toolsCheck.ok = true;
    } else {
      const txt = await resp.text().catch(() => "");
      toolsCheck.hint = `HTTP ${resp.status}: ${txt.slice(0, 120)}`;
      if (!txt.toLowerCase().includes("tool")) {
        warnings.push("Provider may not support tool calling");
      }
    }
  } catch (err: unknown) {
    toolsCheck.hint = err instanceof Error ? err.message : String(err);
    warnings.push("Tool calling check failed");
  }

  // ── Aggregate status ──────────────────────────────────────────────────────
  const allOk = endpointCheck.ok && modelsCheck.ok && generationCheck.ok && toolsCheck.ok;
  const coreOk = endpointCheck.ok && modelsCheck.ok;
  const status: HealthCheckResult["status"] = allOk ? "healthy" : coreOk ? "degraded" : "down";

  return {
    ok: allOk,
    status,
    model: selectedModel,
    checks: {
      endpoint: endpointCheck,
      models: modelsCheck,
      generation: generationCheck,
      tools: toolsCheck,
    },
    warnings,
  };
}
