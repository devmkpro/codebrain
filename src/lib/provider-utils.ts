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
  customMimoAnthropicBaseUrl: string,
): string {
  const custom = normalizeBaseUrl(customMimoAnthropicBaseUrl);
  if (template.id !== "mimo" || !custom) return integration.baseUrl;
  if (integration.type === "anthropic-compat" || integration.type === "mimo-compat") return custom;
  return integration.baseUrl;
}

export async function fetchModelsFromEndpoint(
  baseUrl: string,
  token: string,
  kind: "anthropic" | "gemini" | "openai",
): Promise<string[]> {
  try {
    const url = kind === "anthropic"
      ? `${baseUrl.replace(/\/$/, "")}/v1/models`
      : `${baseUrl.replace(/\/$/, "")}/models`;
    const res = await fetch(url, {
      headers: kind === "anthropic"
        ? { "x-api-key": token, authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01" }
        : { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const ids: string[] = [];
    for (const m of json.data ?? []) if (m?.id) ids.push(m.id);
    for (const m of json.models ?? []) {
      if (typeof m === "string") ids.push(m);
      else if (m?.id) ids.push(m.id);
    }
    return Array.from(new Set(ids));
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
