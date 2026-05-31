import React from "react";
import {
  Brain, Terminal, Sparkles, Code2, Moon, Crosshair, GitBranch,
  Zap, Cpu, Flame, Wind, Globe, Bolt, Hexagon, Rocket, Radar,
} from "lucide-react";
import { useProvidersStore } from "../../stores/providers-store";

// ── Brand definitions: icon + color per AI provider/model ────────────────────
interface BrandDef {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  label: string;
}

const BRANDS: Record<string, BrandDef> = {
  // ── Anthropic / Claude ──────────────────────────────────────────────────────
  claude:     { icon: Brain,   color: "#D97757", label: "Claude" },
  anthropic:  { icon: Brain,   color: "#D97757", label: "Claude" },

  // ── OpenAI / Codex / GPT ───────────────────────────────────────────────────
  openai:     { icon: Code2,   color: "#10A37F", label: "OpenAI" },
  codex:      { icon: Code2,   color: "#10A37F", label: "Codex" },

  // ── Google / Gemini ────────────────────────────────────────────────────────
  gemini:     { icon: Sparkles, color: "#1C69FF", label: "Gemini" },
  google:     { icon: Sparkles, color: "#1C69FF", label: "Gemini" },

  // ── MIMO (Xiaomi) ──────────────────────────────────────────────────────────
  mimo:       { icon: Zap,    color: "#8B5CF6", label: "MIMO" },

  // ── Kimi / Moonshot ────────────────────────────────────────────────────────
  kimi:       { icon: Moon,   color: "#8B5CF6", label: "Kimi" },
  moonshot:   { icon: Moon,   color: "#8B5CF6", label: "Kimi" },

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  deepseek:   { icon: Radar,  color: "#0066FF", label: "DeepSeek" },

  // ── Meta / Llama ───────────────────────────────────────────────────────────
  meta:       { icon: Flame,  color: "#0668E1", label: "Meta" },
  llama:      { icon: Flame,  color: "#0668E1", label: "Llama" },

  // ── Mistral ────────────────────────────────────────────────────────────────
  mistral:    { icon: Wind,   color: "#FF7000", label: "Mistral" },
  mixtral:    { icon: Wind,   color: "#FF7000", label: "Mistral" },

  // ── xAI / Grok ─────────────────────────────────────────────────────────────
  xai:        { icon: Bolt,   color: "#1DA1F2", label: "Grok" },
  grok:       { icon: Bolt,   color: "#1DA1F2", label: "Grok" },

  // ── Qwen / Alibaba ─────────────────────────────────────────────────────────
  qwen:       { icon: Globe,  color: "#6366F1", label: "Qwen" },

  // ── Cohere ─────────────────────────────────────────────────────────────────
  cohere:     { icon: Hexagon, color: "#39594D", label: "Cohere" },
  command:    { icon: Hexagon, color: "#39594D", label: "Cohere" },

  // ── Ollama (local) ─────────────────────────────────────────────────────────
  ollama:     { icon: Cpu,    color: "#9CA3AF", label: "Ollama" },

  // ── CLI Agents ─────────────────────────────────────────────────────────────
  cursor:     { icon: Crosshair, color: "#E5E5E5", label: "Cursor" },
  copilot:    { icon: GitBranch, color: "#FFFFFF", label: "Copilot" },
  shell:      { icon: Terminal,  color: "#9CA3AF", label: "Shell" },
  openclaude: { icon: Brain,     color: "#8B5CF6", label: "OpenClaude" },
};

// ── Model → brand detection ─────────────────────────────────────────────────
// Priority: model name → providerId → agent name
function detectBrand(model?: string | null, providerId?: string | null, agent?: string | null): BrandDef {
  // 1) Detect from model name (highest priority)
  if (model) {
    const m = model.toLowerCase();
    // Anthropic Claude
    if (m.startsWith("claude-"))          return BRANDS.claude;
    // OpenAI
    if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4") || m.startsWith("chatgpt-"))
      return BRANDS.openai;
    // Google Gemini
    if (m.startsWith("gemini-"))          return BRANDS.gemini;
    // MIMO
    if (m.startsWith("mimo-"))            return BRANDS.mimo;
    // Kimi / Moonshot
    if (m.startsWith("kimi-"))            return BRANDS.kimi;
    // DeepSeek
    if (m.startsWith("deepseek-"))        return BRANDS.deepseek;
    // Meta Llama
    if (m.startsWith("llama-") || m.startsWith("meta-")) return BRANDS.meta;
    // Mistral
    if (m.startsWith("mistral-") || m.startsWith("mixtral-")) return BRANDS.mistral;
    // xAI Grok
    if (m.startsWith("grok-") || m.startsWith("x-")) return BRANDS.xai;
    // Qwen
    if (m.startsWith("qwen-"))            return BRANDS.qwen;
    // Cohere
    if (m.startsWith("command-"))         return BRANDS.cohere;
    // OpenRouter "provider/model" format → detect from model part
    if (m.includes("/")) {
      const afterSlash = m.split("/").slice(1).join("/");
      const slashBrand = detectBrand(afterSlash, null, null);
      if (slashBrand !== BRANDS.openclaude) return slashBrand;
      // If model part didn't match, try provider part
      const providerPart = m.split("/")[0];
      if (BRANDS[providerPart]) return BRANDS[providerPart];
    }
  }

  // 2) Detect from providerId
  if (providerId) {
    const pid = providerId.toLowerCase();
    if (pid.includes("claude"))           return BRANDS.claude;
    if (pid.includes("codex"))            return BRANDS.codex;
    if (pid.includes("gemini"))           return BRANDS.gemini;
    if (pid.includes("mimo"))             return BRANDS.mimo;
    if (pid.includes("kimi"))             return BRANDS.kimi;
    if (pid.includes("deepseek"))         return BRANDS.deepseek;
    if (pid.includes("ollama"))           return BRANDS.ollama;
    if (pid.includes("cursor"))           return BRANDS.cursor;
    if (pid.includes("copilot"))          return BRANDS.copilot;
    if (pid.includes("openrouter")) {
      // OpenRouter: try to detect from model (already tried above, but double-check)
      if (model) {
        const orModel = model.toLowerCase();
        if (orModel.includes("claude"))   return BRANDS.claude;
        if (orModel.includes("gemini"))   return BRANDS.gemini;
        if (orModel.includes("gpt"))      return BRANDS.openai;
        if (orModel.includes("llama"))    return BRANDS.meta;
        if (orModel.includes("mistral"))  return BRANDS.mistral;
        if (orModel.includes("deepseek")) return BRANDS.deepseek;
        if (orModel.includes("qwen"))     return BRANDS.qwen;
        if (orModel.includes("grok"))     return BRANDS.xai;
      }
      return BRANDS.openclaude; // generic fallback for OpenRouter
    }
  }

  // 3) Detect from agent name
  if (agent) {
    const a = agent.toLowerCase();
    if (BRANDS[a]) return BRANDS[a];
  }

  return BRANDS.openclaude;
}

// PaneTitle — shows AI icon + colored model/brand name
// The icon and color reflect the ACTUAL MODEL being used, not just the CLI.
export function PaneTitle({ pane }: { pane: any }) {
  const providers = useProvidersStore(s => s.providers);
  const provider = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;

  const brand = detectBrand(pane.model, pane.providerId, pane.agent);
  const Icon = brand.icon;
  const color = brand.color;

  // Label priority: pane.title → model short name → provider label → brand label
  const modelShort = pane.model
    ? pane.model.replace(/^claude-/, "").split("/").pop()?.slice(0, 24)
    : null;
  const label = pane.title ?? modelShort ?? provider?.label ?? brand.label;

  return (
    <span className="flex min-w-0 items-center gap-1.5" style={{ color }}>
      <Icon size={13} />
      <span className="min-w-0 max-w-28 truncate font-mono text-[10px] font-bold uppercase tracking-wider">
        {label}
      </span>
    </span>
  );
}
