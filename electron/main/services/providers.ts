import type { AppContext } from "../context";
import { PROVIDER_REGISTRY } from "./constants";

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

  // Filter out the virtual claude-oauth and Gemini CLI label to avoid duplicates
  const filtered = list
    .filter(p => p.id !== "claude-oauth" && !p.label?.includes("Gemini CLI"))
    .map(p => {
      // Look up the canonical template by id
      const template = PROVIDER_REGISTRY.find(t => t.id === p.id);
      if (template) {
        return {
          ...p,
          host: template.host,
          type: template.type as any,
          models: [...template.models],
        };
      }

      // Fallback: detect by label/id keywords (for custom providers)
      const label = p.label?.toLowerCase() || "";
      const id = (p.id || "").toLowerCase();
      for (const tpl of PROVIDER_REGISTRY) {
        const labelMatch = tpl.labelIncludes?.some(k => label.includes(k.toLowerCase()));
        const idMatch = tpl.idIncludes?.some(k => id.includes(k.toLowerCase()));
        if (labelMatch || idMatch) {
          return {
            ...p,
            host: tpl.host,
            type: tpl.type as any,
            models: [...tpl.models],
          };
        }
      }

      // Unknown provider — default to openclaude
      return { ...p, host: p.host || "openclaude" };
    });

  return [...claudeOAuthProvider, ...filtered];
}
