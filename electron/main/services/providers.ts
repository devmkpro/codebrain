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
          // Same: normalize MIMO label for keyword-matched providers
          const resolvedLabel = tpl.id === "mimo" ? tpl.label : p.label;
          return {
            ...p,
            label: resolvedLabel,
            host: tpl.host,
            type: tpl.type as any,
            models: [...tpl.models],
          };
        }
      }

      // Unknown provider — default to openclaude
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
  // The key may be stored as MIMO_API_KEY or ANTHROPIC_AUTH_TOKEN depending on how
  // the user configured it. We normalize to ANTHROPIC_AUTH_TOKEN so Claude CLI picks it up.
  const mimoKey = mimoConfigured?.env?.["ANTHROPIC_AUTH_TOKEN"]
    || mimoConfigured?.env?.["MIMO_API_KEY"]
    || mimoConfigured?.env?.["ANTHROPIC_API_KEY"]
    || "";
  const mimoClaudeProvider = claudeDetected && hasMimoConfigured && mimoClaudeTemplate ? [{
    id: mimoClaudeTemplate.id,
    label: mimoClaudeTemplate.label,
    type: mimoClaudeTemplate.type as any,
    host: mimoClaudeTemplate.host,
    baseUrl: mimoClaudeTemplate.baseUrl,
    models: [...mimoClaudeTemplate.models],
    env: mimoKey ? { ANTHROPIC_AUTH_TOKEN: mimoKey, MIMO_API_KEY: mimoKey } : {},
  }] : [];

  return [...claudeOAuthProvider, ...codexOAuthProvider, ...geminiCliProvider, ...kimiProvider, ...cursorProvider, ...copilotProvider, ...mimoClaudeProvider, ...filtered];
}
