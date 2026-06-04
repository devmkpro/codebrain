import * as path from "node:path";
import * as os from "node:os";

export const GLOBAL_DIR = path.join(os.homedir(), ".codebrain");
export const BROWSER_LOG_MAX = 2000;

// ─── Single Source of Truth for ALL Providers ────────────────────────────────
// Every provider type, model list, host, baseUrl, and detection logic lives here.
// providers.ts and pane-spawn.ts derive everything from this registry.
// When adding a new provider/model, ONLY edit this file.

export interface ProviderTemplate {
  id: string;            // e.g. "mimo", "anthropic", "gemini"
  label: string;         // display name
  icon: string;          // UI icon
  type: string;          // provider type: "mimo-compat" | "anthropic-compat" | "gemini-compat" | "openai-compat" | "oauth"
  host: string;          // CLI binary: "openclaude" | "claude" | "gemini"
  baseUrl?: string;      // API base URL (omit for OAuth/local)
  tokenEnvVar?: string;  // env var name for API key
  signupUrl?: string;    // signup URL for UI
  models: string[];      // canonical model list — update here to propagate everywhere
  labelIncludes?: string[];  // keywords to detect provider from label (e.g. ["mimo"])
  idIncludes?: string[];     // keywords to detect provider from id
}

export const PROVIDER_REGISTRY: ProviderTemplate[] = [
  {
    id: "mimo",
    label: "MIMO via OpenClaude",
    icon: "MIMO",
    type: "mimo-compat",
    host: "openclaude",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
    tokenEnvVar: "MIMO_API_KEY",
    models: ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"],
    labelIncludes: ["mimo"],
    idIncludes: ["mimo"],
  },
  {
    id: "mimo-claude",
    label: "MIMO via Claude",
    icon: "MIMO",
    type: "anthropic-compat",
    host: "claude",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
    tokenEnvVar: "ANTHROPIC_AUTH_TOKEN", // Overclock pattern: Claude CLI reads ANTHROPIC_AUTH_TOKEN directly
    models: ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"],
    labelIncludes: ["mimo"],
    idIncludes: ["mimo-claude"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: "G",
    type: "gemini-compat",
    host: "openclaude",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    tokenEnvVar: "GEMINI_API_KEY",
    signupUrl: "https://aistudio.google.com/app/apikey",
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools",
      "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite",
      "gemini-3-flash-preview", "gemini-3-pro-preview",
      "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
      "gemini-2.0-flash", "gemini-2.0-flash-lite",
    ],
    labelIncludes: ["gemini"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "A",
    type: "anthropic-compat",
    host: "claude",
    baseUrl: "https://api.anthropic.com",
    tokenEnvVar: "ANTHROPIC_API_KEY",
    signupUrl: "https://console.anthropic.com/settings/keys",
    models: [
      "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
  },
  {
    id: "claude-oauth",
    label: "Claude (Plano)",
    icon: "A",
    type: "oauth",
    host: "claude",
    signupUrl: "https://claude.ai",
    models: [
      "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    labelIncludes: ["claude"],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    icon: "OAI",
    type: "codex",
    host: "codex",
    tokenEnvVar: "OPENAI_API_KEY",
    signupUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5.5", "gpt-5.4-mini", "codex-auto-review"],
    labelIncludes: ["codex"],
    idIncludes: ["codex"],
  },
  {
    id: "codex-oauth",
    label: "Codex (Plano)",
    icon: "OAI",
    type: "codex",
    host: "codex",
    signupUrl: "https://chatgpt.com/codex",
    models: ["gpt-5.5", "gpt-5.4-mini", "codex-auto-review"],
    labelIncludes: ["codex"],
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    icon: "G",
    type: "gemini-cli",
    host: "gemini-cli",
    tokenEnvVar: "GEMINI_API_KEY",
    signupUrl: "https://aistudio.google.com/app/apikey",
    models: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    labelIncludes: ["gemini"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    icon: "OR",
    type: "openai-compat",
    host: "openclaude",
    baseUrl: "https://openrouter.ai/api/v1",
    tokenEnvVar: "OPENAI_API_KEY",
    signupUrl: "https://openrouter.ai/keys",
    models: [
      "anthropic/claude-opus-4-8", "anthropic/claude-opus-4.7-fast", "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro", "google/gemini-3.1-flash-lite",
      "openai/gpt-4o", "openai/gpt-4.1-mini",
      "x-ai/grok-4.3", "mistralai/mistral-medium-3-5",
      "deepseek/deepseek-chat-v3-0324", "meta-llama/llama-4-maverick",
    ],
    labelIncludes: ["openrouter"],
    idIncludes: ["openrouter"],
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "O",
    type: "openai-compat",
    host: "openclaude",
    baseUrl: "https://api.openai.com/v1",
    tokenEnvVar: "OPENAI_API_KEY",
    signupUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5.5", "gpt-5.5-mini", "gpt-5.5-nano", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini", "o3-mini", "o1-pro", "o1"],
    labelIncludes: ["openai"],
    idIncludes: ["openai"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: "DS",
    type: "openai-compat",
    host: "openclaude",
    baseUrl: "https://api.deepseek.com/v1",
    tokenEnvVar: "OPENAI_API_KEY",
    signupUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-reasoner", "deepseek-chat"],
    labelIncludes: ["deepseek"],
    idIncludes: ["deepseek"],
  },
  {
    id: "mistral",
    label: "Mistral",
    icon: "M",
    type: "openai-compat",
    host: "openclaude",
    baseUrl: "https://api.mistral.ai/v1",
    tokenEnvVar: "OPENAI_API_KEY",
    signupUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-large-latest", "mistral-small-latest", "devstral-latest", "codestral"],
    labelIncludes: ["mistral"],
    idIncludes: ["mistral"],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    icon: "X",
    type: "openai-compat",
    host: "openclaude",
    baseUrl: "https://api.x.ai/v1",
    tokenEnvVar: "OPENAI_API_KEY",
    signupUrl: "https://console.x.ai/team/default/api-keys",
    models: ["grok-4.3", "grok-4", "grok-3"],
    labelIncludes: ["grok", "xai"],
    idIncludes: ["xai"],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    icon: "🦙",
    type: "openai-compat",
    host: "openclaude",
    baseUrl: "http://localhost:11434/v1",
    tokenEnvVar: "OPENAI_API_KEY",
    models: [],
  },
  // ── New CLI agents (Overclock parity) ────────────────────────────────
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    icon: "K",
    type: "openai-compat",
    host: "kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    tokenEnvVar: "MOONSHOT_API_KEY",
    models: ["kimi-k2.6", "kimi-k2.5"],
    labelIncludes: ["kimi", "moonshot"],
    idIncludes: ["kimi"],
  },
  {
    id: "cursor",
    label: "Cursor",
    icon: "CU",
    type: "openai-compat",
    host: "cursor",
    tokenEnvVar: "CURSOR_API_KEY",
    models: [],
    labelIncludes: ["cursor"],
    idIncludes: ["cursor"],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    icon: "GH",
    type: "openai-compat",
    host: "copilot",
    tokenEnvVar: "GITHUB_TOKEN",
    models: [],
    labelIncludes: ["copilot", "github"],
    idIncludes: ["copilot"],
  },
];

// ─── Derived constants (read-only, computed from registry) ───────────────────

/** Map: provider type → canonical model list */
export const MODEL_MAP_BY_TYPE: Record<string, string[]> = Object.fromEntries(
  PROVIDER_REGISTRY
    .filter(t => t.type !== "oauth")
    .map(t => [t.type, [...t.models]])
);

/** Reverse lookup: model name → provider type */
const MODEL_TO_TYPE: Record<string, string> = {};
for (const tpl of PROVIDER_REGISTRY) {
  if (tpl.type === "oauth" || tpl.type === "gemini-cli" || tpl.id === "mimo-claude") continue; // Skip virtual providers — models overlap
  for (const m of tpl.models) {
    MODEL_TO_TYPE[m] = tpl.type;
  }
}

/** Get provider type for a model name (exact match or prefix heuristic) */
export function getProviderTypeForModel(model: string): string | null {
  if (MODEL_TO_TYPE[model]) return MODEL_TO_TYPE[model];
  // Handle OpenRouter-style "provider/model" format (e.g. "anthropic/claude-3.5-sonnet")
  if (model.includes("/")) {
    // Check registered models first
    for (const tpl of PROVIDER_REGISTRY) {
      if (tpl.models.includes(model)) return tpl.type;
    }
    // Unregistered slash-model: assume openai-compat (OpenRouter convention)
    return "openai-compat";
  }
  // Prefix fallback
  if (model.startsWith("gemini-")) return "gemini-compat";
  if (model.startsWith("mimo-")) return "mimo-compat";
  if (model.startsWith("claude-")) return "anthropic-compat";
  if (model.endsWith("-codex") || model.includes("-codex")) return "codex";
  if (model.startsWith("gpt-") || model.startsWith("o")) return "openai-compat";
  return null;
}

/** Get provider ID for a model name */
export function getProviderIdForModel(model: string): string | null {
  for (const tpl of PROVIDER_REGISTRY) {
    if (tpl.models.includes(model)) return tpl.id;
  }
  // Handle "provider/model" format — prefer OpenRouter for slash-models
  if (model.includes("/")) {
    const orTpl = PROVIDER_REGISTRY.find(t => t.id === "openrouter");
    if (orTpl) return orTpl.id;
  }
  const type = getProviderTypeForModel(model);
  if (type) {
    const tpl = PROVIDER_REGISTRY.find(t => t.type === type && t.type !== "oauth");
    return tpl?.id ?? null;
  }
  return null;
}

// ─── Legacy aliases (for backward compat with existing code) ────────────────
/** @deprecated Use MODEL_MAP_BY_TYPE["mimo-compat"] instead */
export const MIMO_MODELS = MODEL_MAP_BY_TYPE["mimo-compat"];
/** @deprecated Use MODEL_MAP_BY_TYPE["gemini-compat"] instead */
export const GEMINI_MODELS = MODEL_MAP_BY_TYPE["gemini-compat"];
/** @deprecated Use MODEL_MAP_BY_TYPE via claude-oauth template instead */
export const CLAUDE_OAUTH_MODELS = PROVIDER_REGISTRY.find(t => t.id === "claude-oauth")?.models ?? [];

// ─── BUILTIN_TEMPLATES (frontend compat: uses integrations array) ────────────
// Derived from PROVIDER_REGISTRY. When adding a new provider, the registry is
// the single source — this is auto-generated from it for UI compatibility.
export const BUILTIN_TEMPLATES = PROVIDER_REGISTRY
  .filter(t => t.id !== "claude-oauth" && t.id !== "codex-oauth" && t.id !== "gemini-cli" && t.id !== "mimo-claude") // virtual providers, not user-configurable templates
  .map(t => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    signupUrl: t.signupUrl,
    integrations: [{
      type: t.type,
      host: t.host,
      baseUrl: t.baseUrl ?? "",
      tokenEnvVar: t.tokenEnvVar ?? "API_KEY",
      label: t.label,
      models: [...t.models],
    }],
  }));
