import React from "react";

// PaneTitle
import { useProvidersStore } from "../../stores/providers-store";
export function PaneTitle({
  pane
}) {
  const providers = useProvidersStore(s => s.providers);
  const provider = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;
  const label = pane.title ?? provider?.label ?? pane.agent;
  return <span className="font-mono text-[10px] font-bold text-gray-300 tracking-wider truncate">
      {label}
    </span>;
}