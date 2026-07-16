import type { AppContext } from "../context";
import { PROVIDER_REGISTRY } from "./constants";

/**
 * Merge user-saved models with template models.
 * - If user has explicitly saved models (edited via UI), respect their choice (no template merge).
 * - If no saved models exist (fresh provider), use template defaults.
 * - User-saved models that aren't in the template are always preserved (custom additions).
 */
function mergeModels(saved: string[] | undefined, templateModels: string[], isExistingProvider: boolean): string[] {
  const cleaned = (saved ?? []).map(m => m.trim()).filter(Boolean);
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

export function getEnhancedProviders(ctx: AppContext) {
  const list = ctx.providerStore.listFull();
  const claudeDetected = ctx.cliDetector?.getAll()?.claude?.found ?? false;

  // Virtual Claude OAuth provider — appears when Claude CLI is installed
  const claudeOAuthTemplate = PROVIDER_REGISTRY.find(t => t.id === "claude-oauth");
  const claudeOAuthProvider = claudeDetected && claudeOAuthTemplate ? [{
    id: claudeOAuthTemplate.id,
    label: claudeOAuthTemplate.label,
    type: claudeOAuthTemplate.type as "oauth",
    host: claudeOAuthTemplate.host,
    models: [...claudeOAuthTemplate.models],
    env: {},
  }] : [];

  // Virtual Codex OAuth provider — appears when Codex CLI is installed
  const codexDetected = ctx.cliDetector?.getAll()?.codex?.found ?? false;
  const codexOAuthTemplate = PROVIDER_REGISTRY.find(t => t.id === "codex-oauth");
  const codexOAuthProvider = codexDetected && codexOAuthTemplate ? [{
    id: codexOAuthTemplate.id,
    label: codexOAuthTemplate.label,
    type: codexOAuthTemplate.type as any,
    host: codexOAuthTemplate.host,
    models: [...codexOAuthTemplate.models],
    env: {},
  }] : [];

  // Filter out the virtual claude-oauth and Gemini CLI label to avoid duplicates
  // Virtual Gemini CLI provider — appears when gemini CLI is installed
  const geminiCliDetected = ctx.cliDetector?.getAll()?.gemini?.found ?? false;
  const geminiCliTemplate = PROVIDER_REGISTRY.find(t => t.id === "gemini-cli");
  const geminiCliProvider = geminiCliDetected && geminiCliTemplate ? [{
    id: geminiCliTemplate.id,
    label: geminiCliTemplate.label,
    type: geminiCliTemplate.type as any,
    host: geminiCliTemplate.host,
    models: [...geminiCliTemplate.models],
    env: {},
  }] : [];

  const VIRTUAL_IDS = ["claude-oauth", "codex-oauth", "gemini-cli", "kimi", "cursor", "copilot", "mimo-claude"];
  const filtered = list
    .filter(p => !VIRTUAL_IDS.includes(p.id) && !p.label?.includes("Gemini CLI"))
    .map(p => {
      // Look up the canonical template by id
      const template = PROVIDER_REGISTRY.find(t => t.id === p.id);
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
      let bestMatch: typeof PROVIDER_REGISTRY[number] | null = null;
      let bestScore = 0;
      for (const tpl of PROVIDER_REGISTRY) {
        const labelHits = tpl.labelIncludes?.filter(k => label.includes(k.toLowerCase())).length ?? 0;
        const idHits = tpl.idIncludes?.filter(k => id.includes(k.toLowerCase())).length ?? 0;
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
  const kimiTemplate = PROVIDER_REGISTRY.find(t => t.id === "kimi");
  const kimiProvider = kimiDetected && kimiTemplate ? [{
    id: kimiTemplate.id,
    label: kimiTemplate.label,
    type: kimiTemplate.type as any,
    host: kimiTemplate.host,
    models: [...kimiTemplate.models],
    env: {},
  }] : [];

  // Virtual Cursor CLI provider — appears when Cursor CLI is installed
  const cursorDetected = ctx.cliDetector?.getAll()?.cursor?.found ?? false;
  const cursorTemplate = PROVIDER_REGISTRY.find(t => t.id === "cursor");
  const cursorProvider = cursorDetected && cursorTemplate ? [{
    id: cursorTemplate.id,
    label: cursorTemplate.label,
    type: cursorTemplate.type as any,
    host: cursorTemplate.host,
    models: [...cursorTemplate.models],
    env: {},
  }] : [];

  // Virtual Copilot CLI provider — appears when Copilot CLI is installed
  const copilotDetected = ctx.cliDetector?.getAll()?.copilot?.found ?? false;
  const copilotTemplate = PROVIDER_REGISTRY.find(t => t.id === "copilot");
  const copilotProvider = copilotDetected && copilotTemplate ? [{
    id: copilotTemplate.id,
    label: copilotTemplate.label,
    type: copilotTemplate.type as any,
    host: copilotTemplate.host,
    models: [...copilotTemplate.models],
    env: {},
  }] : [];

  // Virtual MIMO via Claude provider — appears when Claude CLI is installed AND user has a MIMO provider configured
  const mimoClaudeTemplate = PROVIDER_REGISTRY.find(t => t.id === "mimo-claude");
  const mimoConfigured = list.find(p => {
    const label = p.label?.toLowerCase() || "";
    const id = (p.id || "").toLowerCase();
    return id.includes("mimo") || label.includes("mimo");
  });
  const hasMimoConfigured = !!mimoConfigured;
  // Inherit the MIMO API key from the configured mimo provider.
  // The key may be stored in various env var names depending on the provider adapter
  // (MIMO uses openai-compat → OPENAI_API_KEY, or mimo-compat → MIMO_API_KEY/ANTHROPIC_AUTH_TOKEN).
  // We check ALL possible locations to ensure the key is found.
  const mimoKey = mimoConfigured?.env?.["ANTHROPIC_AUTH_TOKEN"]
    || mimoConfigured?.env?.["MIMO_API_KEY"]
    || mimoConfigured?.env?.["ANTHROPIC_API_KEY"]
    || mimoConfigured?.env?.["OPENAI_API_KEY"]  // MIMO openclaude adapter stores key here
    || "";
  // Inherit baseUrl from the user's configured MIMO provider (ANTHROPIC_BASE_URL),
  // falling back to the template default. This ensures the correct regional endpoint
  // (ams/sgp/cn) is used instead of the hardcoded template URL.
  const mimoBaseUrl = mimoConfigured?.env?.["ANTHROPIC_BASE_URL"]
    || mimoClaudeTemplate?.baseUrl
    || "https://token-plan-ams.xiaomimimo.com/anthropic";
  const mimoClaudeProvider = claudeDetected && hasMimoConfigured && mimoClaudeTemplate ? [{
    id: mimoClaudeTemplate.id,
    label: mimoClaudeTemplate.label,
    type: mimoClaudeTemplate.type as any,
    host: mimoClaudeTemplate.host,
    baseUrl: mimoBaseUrl,
    models: [...mimoClaudeTemplate.models],
    env: mimoKey ? { ANTHROPIC_AUTH_TOKEN: mimoKey, MIMO_API_KEY: mimoKey } : {},
  }] : [];

  return [...claudeOAuthProvider, ...codexOAuthProvider, ...geminiCliProvider, ...kimiProvider, ...cursorProvider, ...copilotProvider, ...mimoClaudeProvider, ...filtered];
}

// ─── Dynamic model discovery ──────────────────────────────

const NON_CHAT_KEYWORDS = ['embed', 'embedding', 'tts', 'whisper', 'speech', 'rerank', 'audio', 'moderation', 'transcri'];

function isNonChatModel(id: string): boolean {
  const parts = id.toLowerCase().split(/[-_]/);
  return NON_CHAT_KEYWORDS.some(kw => parts.includes(kw) || id.toLowerCase().includes(kw));
}

/** Strip non-ASCII / non-printable chars from an API key before using in HTTP headers */
function sanitizeApiKey(key: string): string {
  // HTTP headers only allow bytes 0x00-0xFF (Latin-1). Strip anything above 0xFF
  // and also remove common invisible unicode (zero-width, BOM, etc.)
  return key
    .replace(/[Ā-￿]/g, '')  // remove chars outside Latin-1
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove control chars except \t \n \r
    .replace(/[\r\n]/g, '')  // remove newlines
    .trim();
}

export async function listModelsFromEndpoint(args: {
  baseUrl: string;
  apiKey: string;
  type: string;
}): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const { baseUrl, type } = args;
  const apiKey = sanitizeApiKey(args.apiKey);
  const base = baseUrl.replace(/\/$/, '');

  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // MIMO: base URL may end with /anthropic (e.g. .../anthropic) — strip it to get the root,
  // then use /v1/models with Bearer auth (OpenAI-compat endpoint confirmed via recon)
  const isMimo = type === 'mimo-compat' || base.includes('xiaomimimo.com');
  if (isMimo) {
    const mimoRoot = base.replace(/\/anthropic$/, '');
    url = `${mimoRoot}/v1/models`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (type === 'anthropic-compat') {
    url = `${base}/v1/models`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (type === 'gemini-compat') {
    url = `${base}/v1beta/models?key=${apiKey}`;
  } else {
    // OpenAI-compatible: standard /v1/models endpoint
    url = `${base}/v1/models`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await (globalThis as any).fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };

    const json = await response.json() as any;
    let rawModels: Array<{ id?: string; name?: string }> = [];
    if (Array.isArray(json)) rawModels = json;
    else if (Array.isArray(json.data)) rawModels = json.data;
    else if (Array.isArray(json.models)) rawModels = json.models;

    const models = rawModels
      .map((m: any) => {
        const raw: string = m.id || m.name || '';
        // Gemini returns "models/gemini-2.5-pro" — strip the prefix
        return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
      })
      .filter((id: string) => id && !isNonChatModel(id));

    return { ok: true, models };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
  const mimoRoot = isMimo ? base.replace(/\/anthropic$/, "") : base;
  const isAnthropicType = type === "anthropic-compat";
  const isGemini = type === "gemini-compat";

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
    // Anthropic: /v1/messages, OpenAI: /v1/chat/completions
    const chatUrl = isMimo
      ? `${base}/v1/messages`   // base = .../anthropic already
      : isAnthropicType
        ? `${base}/v1/messages`
        : `${base}/v1/chat/completions`;
    const body = JSON.stringify({ model: selectedModel, max_tokens: 8, messages: [{ role: "user", content: "say ok" }] });
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
    const chatUrl = isMimo
      ? `${base}/v1/messages`
      : isAnthropicType
        ? `${base}/v1/messages`
        : `${base}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isMimo || isAnthropicType) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const dummyTool = (isMimo || isAnthropicType)
      ? { name: "get_status", description: "Get status", input_schema: { type: "object", properties: {} } }
      : { type: "function", function: { name: "get_status", description: "Get status", parameters: { type: "object", properties: {} } } };
    const body = JSON.stringify({ model: selectedModel, max_tokens: 8, messages: [{ role: "user", content: "use the tool" }], tools: [dummyTool] });
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
