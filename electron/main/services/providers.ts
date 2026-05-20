import type { AppContext } from "../context";

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools",
  "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite",
  "gemini-3-flash-preview", "gemini-3-pro-preview",
  "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
  "gemini-2.0-flash", "gemini-2.0-flash-lite"
];

const MIMO_MODELS = [
  "mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"
];

export function getEnhancedProviders(ctx: AppContext) {
  const list = ctx.providerStore.listPublic();
  return list
    .filter(p => p.id !== "claude-oauth" && !p.label?.includes("Gemini CLI"))
    .map(p => {
      const label = p.label?.toLowerCase() || "";
      const isMimo = label.includes("mimo") || p.id?.includes("mimo") || p.type === "mimo-compat";
      const isGemini = !isMimo && (p.type === "gemini-compat" || (p.env && p.env["GEMINI_API_KEY"]) || label.includes("gemini"));

      if (isMimo) return { ...p, host: "openclaude", models: [...MIMO_MODELS] };
      if (isGemini) return { ...p, host: "openclaude", models: [...GEMINI_MODELS] };
      return { ...p, host: p.host || "openclaude" };
    });
}
