import React from "react";
import { Check, Copy } from "lucide-react";

// PaneIdBadge — mostra o id curto do pane; clique copia o id inteiro.
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
      data-pane-control
      data-copied={copied}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={copyPaneId}
      className="cb-chip cb-pane-id"
      title={copied ? "Pane ID copiado" : `Copiar pane ID: ${paneId}`}
      aria-label={copied ? "Pane ID copiado" : `Copiar pane ID ${paneId}`}
    >
      <span>{paneId.slice(0, 8)}</span>
      {copied ? <Check size={10} strokeWidth={1.7} aria-hidden /> : <Copy size={10} strokeWidth={1.7} aria-hidden />}
    </button>
  );
}
