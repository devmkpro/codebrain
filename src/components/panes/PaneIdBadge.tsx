import React from "react";
import { Copy, Check } from "lucide-react";

// PaneIdBadge — shows truncated pane ID, copies to clipboard on click (Overclock-style)
export function PaneIdBadge({ paneId }: { paneId: string }) {
  const [copied, setCopied] = React.useState(false);

  const copyPaneId = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(paneId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      draggable={false}
      onMouseDown={e => e.stopPropagation()}
      onClick={copyPaneId}
      className={`group/id inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-bold tracking-normal normal-case transition-all ${
        copied
          ? "border-green-500/30 bg-green-500/10 text-green-300"
          : "border-white/10 bg-white/[0.03] text-gray-500 hover:border-violet-500/30 hover:text-violet-300"
      }`}
      title={copied ? "Pane ID copiado" : `Copiar pane ID: ${paneId}`}
      aria-label={copied ? "Pane ID copiado" : `Copiar pane ID ${paneId}`}
    >
      <span>{paneId.slice(0, 8)}</span>
      {copied
        ? <Check size={10} strokeWidth={1.7} className="shrink-0" />
        : <Copy size={10} strokeWidth={1.7} className="shrink-0 opacity-50 group-hover/id:opacity-100" />
      }
    </button>
  );
}
