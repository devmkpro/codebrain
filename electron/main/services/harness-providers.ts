/**
 * Traduz os provedores configurados no app para as credenciais do decisor e da
 * geração de mídia. Fica no main process: as chaves nunca chegam ao renderer.
 */
import { PROVIDER_REGISTRY } from "./constants";

export interface HarnessProvider {
  id: string;
  label?: string;
  type?: string;
  baseUrl?: string;
  models?: string[];
  env?: Record<string, string>;
  tokenEnvVar?: string;
}

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
}

export interface MediaCredentials {
  openai?: ProviderCredentials;
  gemini?: ProviderCredentials;
  openrouter?: ProviderCredentials;
}

const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function apiKeyOf(provider: HarnessProvider): string | null {
  const env = provider.env ?? {};
  const tokenEnvVar =
    provider.tokenEnvVar ??
    PROVIDER_REGISTRY.find((entry) => entry.id === provider.id)?.tokenEnvVar;
  const fallbackNames =
    provider.type === "gemini-compat"
      ? ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
      : provider.type === "mimo-compat"
        ? ["MIMO_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"]
        : [
            "OPENAI_API_KEY",
            "OPENROUTER_API_KEY",
            "FIREWORKS_API_KEY",
            "MOONSHOT_API_KEY",
            "XAI_API_KEY",
          ];
  const names = provider.tokenEnvVar
    ? [provider.tokenEnvVar]
    : [...(tokenEnvVar ? [tokenEnvVar] : []), ...fallbackNames];
  for (const name of names) {
    const value = typeof env[name] === "string" ? env[name].trim() : "";
    if (value && !/^\*+$/.test(value) && !/[\r\n\x00-\x1f\x7f]/.test(value)) return value;
  }
  return null;
}

function baseOf(provider: HarnessProvider): string | null {
  const env = provider.env ?? {};
  const value =
    (provider.type === "gemini-compat"
      ? env.GEMINI_BASE_URL
      : provider.type === "mimo-compat"
        ? env.ANTHROPIC_BASE_URL
        : env.OPENAI_BASE_URL) ||
    provider.baseUrl ||
    PROVIDER_REGISTRY.find((entry) => entry.id === provider.id)?.baseUrl;
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Base de um endpoint `/chat/completions`, ou null se o provedor não tem um. */
function chatCompletionsBase(provider: HarnessProvider): string | null {
  const base = baseOf(provider);
  if (!base) return null;
  if (provider.type === "openai-compat") return base;
  if (provider.type === "gemini-compat") return base.endsWith("/openai") ? base : `${base}/openai`;
  if (provider.type === "mimo-compat") return base.replace(/\/anthropic$/, "/v1");
  return null;
}

export function deciderCredentials(
  providers: readonly HarnessProvider[],
  providerId?: string | null
): ProviderCredentials | null {
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) return null;
  const baseUrl = chatCompletionsBase(provider);
  const apiKey = apiKeyOf(provider);
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export function listDeciderProviders(
  providers: readonly HarnessProvider[]
): { id: string; label: string; models: string[] }[] {
  return providers
    .filter((provider) => deciderCredentials(providers, provider.id))
    .map((provider) => ({
      id: provider.id,
      label: provider.label || provider.id,
      models: provider.models ?? [],
    }));
}

export function mediaCredentials(providers: readonly HarnessProvider[]): MediaCredentials {
  const credentials: MediaCredentials = {};
  for (const provider of providers) {
    const apiKey = apiKeyOf(provider);
    if (!apiKey) continue;
    const base = baseOf(provider);
    if (!base) continue;
    const host = new URL(base).hostname;
    if (!credentials.openrouter && (provider.id === "openrouter" || host === "openrouter.ai")) {
      credentials.openrouter = { baseUrl: base || OPENROUTER_BASE, apiKey };
    } else if (!credentials.gemini && provider.type === "gemini-compat") {
      credentials.gemini = { baseUrl: base.replace(/\/openai$/, "") || GEMINI_BASE, apiKey };
    } else if (!credentials.openai && (provider.id === "openai" || host === "api.openai.com")) {
      credentials.openai = { baseUrl: base || OPENAI_BASE, apiKey };
    }
  }
  return credentials;
}
