import React from "react";
import { Brain, Terminal, Sparkles, Code2, Moon, Crosshair, GitBranch } from "lucide-react";
import { useProvidersStore } from "../../stores/providers-store";

// ── Provider brand colors (Overclock-style) ──────────────────────────────────
const PROVIDER_BRAND_COLOR: Record<string, string> = {
  claude: "#D97757",       // Anthropic coral
  "claude-oauth": "#D97757",
  codex: "#10A37F",        // OpenAI green
  "codex-oauth": "#10A37F",
  gemini: "#1C69FF",       // Google blue
  "gemini-cli": "#1C69FF",
  mimo: "#8B5CF6",         // MIMO purple
  kimi: "#8B5CF6",         // Moonshot purple
  cursor: "#E5E5E5",       // Cursor white
  copilot: "#FFFFFF",      // GitHub white
  anthropic: "#D97757",
  shell: "#9CA3AF",
  openclaude: "#8B5CF6",
};

// ── Provider CLI icons (Overclock-style) ─────────────────────────────────────
const PROVIDER_CLI_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  claude: Brain,
  "claude-oauth": Brain,
  codex: Code2,
  "codex-oauth": Code2,
  gemini: Sparkles,
  "gemini-cli": Sparkles,
  mimo: Brain,
  kimi: Moon,
  cursor: Crosshair,
  copilot: GitBranch,
  anthropic: Brain,
  shell: Terminal,
  openclaude: Brain,
};

function getProviderBrand(pane: any): string {
  // Match by providerId first, then by agent name
  if (pane.providerId) {
    if (pane.providerId.includes("claude")) return "claude";
    if (pane.providerId.includes("codex")) return "codex";
    if (pane.providerId.includes("gemini")) return "gemini";
    if (pane.providerId.includes("mimo")) return "mimo";
    if (pane.providerId.includes("kimi")) return "kimi";
    if (pane.providerId.includes("cursor")) return "cursor";
    if (pane.providerId.includes("copilot")) return "copilot";
    if (pane.providerId.includes("openrouter")) return "openclaude";
  }
  return pane.agent ?? "openclaude";
}

// PaneTitle — shows AI icon + colored provider name (Overclock-style)
export function PaneTitle({ pane }: { pane: any }) {
  const providers = useProvidersStore(s => s.providers);
  const provider = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;
  const brand = getProviderBrand(pane);
  const Icon = PROVIDER_CLI_ICON[brand] ?? Brain;
  const color = PROVIDER_BRAND_COLOR[brand] ?? "#9CA3AF";
  const label = pane.title ?? provider?.label ?? (pane.agent === "shell" ? "Shell" : pane.agent ?? "Agent");

  return (
    <span className="flex min-w-0 items-center gap-1.5" style={{ color }}>
      <Icon size={13} />
      <span className="min-w-0 max-w-28 truncate font-mono text-[10px] font-bold uppercase tracking-wider">
        {label}
      </span>
    </span>
  );
}
