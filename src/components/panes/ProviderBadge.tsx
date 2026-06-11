import React from "react";
import { useProvidersStore } from "../../stores/providers-store";

// Shorten model name: "claude-sonnet-4-6" → "sonnet-4-6", "anthropic/claude-3.5-sonnet" → "claude-3.5-sonnet"
function modelShortName(model: string): string {
  const normalized = model.replace(/^claude-/, "");
  const parts = normalized.split("/");
  return parts.length > 1 ? parts[parts.length - 1] : normalized;
}

// ProviderBadge — shows short model name in a bordered pill
export function ProviderBadge({ providerId, model, agent }: { providerId?: string; model?: string; agent?: string }) {
  const providers = useProvidersStore(s => s.providers);
  const provider = providerId ? providers.find(p => p.id === providerId) : agent ? providers.find(p => p.host === agent) : null;
  const isCustom = !!provider && provider.type !== "oauth";
  const cls = isCustom
    ? "text-red-400 border-red-500/30 bg-red-500/10"
    : "text-gray-500 border-white/10 bg-white/[0.03] provider-badge-default";
  const effectiveModel = model ?? provider?.models?.[0];
  const shortModel = effectiveModel ? modelShortName(effectiveModel).slice(0, 22) : null;
  if (!shortModel) return null;

  return (
    <span className={`font-mono text-[10px] font-bold tracking-widest normal-case px-1.5 py-[1px] rounded border ${cls} min-w-0 max-w-28 shrink truncate`}>
      {shortModel}
    </span>
  );
}
