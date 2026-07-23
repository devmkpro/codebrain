export const DEFAULT_MIMO_ANTHROPIC_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/anthropic";

export const MIMO_ANTHROPIC_ROUTES = [
  { label: "SGP", url: DEFAULT_MIMO_ANTHROPIC_BASE_URL },
  { label: "CN", url: "https://token-plan-cn.xiaomimimo.com/anthropic" },
  { label: "AMS", url: "https://token-plan-ams.xiaomimimo.com/anthropic" },
];

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function isValidHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function resolveIntegrationBaseUrl(
  template: { id: string },
  integration: { type: string; baseUrl: string },
  customBaseUrl: string,
): string {
  const custom = normalizeBaseUrl(customBaseUrl);
  if (!custom) return integration.baseUrl;
  if (template.id === "mimo" && (integration.type === "anthropic-compat" || integration.type === "mimo-compat")) return custom;
  // 9Router: custom URL points at the user's own instance — self-host
  // (http://localhost:20128) or a remote deployment (VPS/Railway/tunnel).
  // Strip a trailing /v1 (users copy the OpenAI-endpoint form of the URL);
  // Claude CLI appends /v1/messages itself.
  if (template.id === "9router") return custom.replace(/\/v1$/, "");
  return integration.baseUrl;
}

const NON_CHAT_KEYWORDS = ["embed", "embedding", "tts", "whisper", "speech", "rerank", "audio", "moderation", "transcri"];
function isNonChat(id: string): boolean {
  const low = id.toLowerCase();
  return NON_CHAT_KEYWORDS.some(kw => low.includes(kw));
}

export async function fetchModelsFromEndpoint(
  baseUrl: string,
  token: string,
  kind: "anthropic" | "gemini" | "openai",
): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, "");
  try {
    let url: string;
    let headers: Record<string, string>;

    if (kind === "anthropic") {
      // Anthropic: GET /v1/models with x-api-key + anthropic-version
      url = `${base}/v1/models`;
      headers = {
        "x-api-key": token,
        "authorization": `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
      };
    } else if (kind === "gemini") {
      // Google Gemini: GET /v1beta/models?key=...
      url = `${base}/v1beta/models?key=${encodeURIComponent(token)}`;
      headers = {};
    } else {
      // OpenAI-compatible: GET /v1/models with Bearer token
      url = `${base}/v1/models`;
      headers = { "authorization": `Bearer ${token}` };
    }

    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const json = await res.json() as any;

    const ids: string[] = [];
    // OpenAI-compat and Anthropic: json.data[].id
    for (const m of json.data ?? []) {
      if (m?.id) ids.push(m.id);
    }
    // Gemini: json.models[].name ("models/gemini-2.5-pro" → strip prefix)
    for (const m of json.models ?? []) {
      if (typeof m === "string") {
        ids.push(m.startsWith("models/") ? m.slice(7) : m);
      } else if (m?.id) {
        ids.push(m.id);
      } else if (m?.name) {
        const name: string = m.name;
        ids.push(name.startsWith("models/") ? name.slice(7) : name);
      }
    }

    return Array.from(new Set(ids)).filter(id => !isNonChat(id));
  } catch {
    return [];
  }
}

export const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?(?:\/[^\s\x1b]*)?/gi;

export function extractLocalUrl(text: string): string | null {
  const matches = text.match(URL_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1].replace(/[)\]>'"`,.;]+$/, "");
}
