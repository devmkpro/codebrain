import React from "react";

// ProviderBadge
import { useProvidersStore } from "../../stores/providers-store";
export function ProviderBadge({
  providerId,
  model
}) {
  const providers = useProvidersStore(s => s.providers);
  const provider = providerId ? providers.find(p => p.id === providerId) : null;
  const label = provider?.label ?? "OAuth";
  const isCustom = !!provider && provider.type !== "oauth";
  const cls = isCustom ? "text-red-400 border-indigo-500/30 bg-indigo-500/10" : "text-gray-500 border-white/10 bg-white/[0.03]";
  const shortModel = model ? model.replace(/^claude-/, "").slice(0, 18) : null;
  return <span className={`font-mono text-[8px] font-bold uppercase tracking-widest px-1.5 py-[1px] rounded border ${cls} shrink-0 flex items-center gap-1`}>
      <span>{label}</span>
      {shortModel && <span className="opacity-70 normal-case">· {shortModel}</span>}
    </span>;
}