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

  const filtered = list
    .filter(p => p.id !== "claude-oauth" && p.id !== "codex-oauth" && p.id !== "gemini-cli" && !p.label?.includes("Gemini CLI"))
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

  return [...claudeOAuthProvider, ...codexOAuthProvider, ...geminiCliProvider, ...filtered];
}
