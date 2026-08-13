import React from "react";
import { usePanesStore } from "../../stores/panes-store";
import { useShellStore, applyDensity, type Density } from "../../stores/shell-store";
import { toPaneStatus } from "./pane-status";

/* ═══════════════════════════════════════════════════════════════════════════
   BARRA DE STATUS
   ═══════════════════════════════════════════════════════════════════════════

   Rodapé de uma linha: contagem de agentes por estado, densidade e versão.

   Terminal-first evita cromo permanente, então aqui só entra o que muda e
   importa em tempo real. Qualquer coisa acionável mora no palette.
   ═══════════════════════════════════════════════════════════════════════════ */

const DENSITIES: Density[] = ["compact", "normal", "comfortable"];
const DENSITY_LABEL: Record<Density, string> = {
  compact: "compacto",
  normal: "normal",
  comfortable: "amplo",
};

export function StatusBar({ appVersion }: { appVersion?: string | null }) {
  const panes = usePanesStore((state) => state.panes) as { status?: string }[];
  const density = useShellStore((state) => state.density);
  const setDensity = useShellStore((state) => state.setDensity);

  // Mantém o atributo do <html> em sincronia com a preferência salva.
  React.useEffect(() => applyDensity(density), [density]);

  const counts = React.useMemo(() => {
    let working = 0;
    let failed = 0;
    for (const pane of panes) {
      const status = toPaneStatus(pane.status);
      if (status === "running" || status === "booting") working++;
      if (status === "error") failed++;
    }
    return { working, failed, total: panes.length };
  }, [panes]);

  return (
    <footer className="flex items-center gap-4 h-cell shrink-0 px-3 bg-cb-bg-1 border-t border-cb-line-0 text-2xs text-cb-fg-3">
      <span className="flex items-center gap-1.5">
        <span
          className="cb-dot"
          style={{ "--cb-dot-color": "var(--cb-agent-done)" } as React.CSSProperties}
          aria-hidden
        />
        {counts.total} {counts.total === 1 ? "agente" : "agentes"}
      </span>

      {counts.working > 0 && (
        <span className="text-cb-agent-thinking">{counts.working} trabalhando</span>
      )}
      {counts.failed > 0 && (
        <span className="text-cb-danger">{counts.failed} com erro</span>
      )}

      <span className="flex-1" />

      <button
        type="button"
        onClick={() =>
          setDensity(DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length])
        }
        title="Densidade da interface"
        className="hover:text-cb-fg-1 rounded-cb-1 px-1"
      >
        {DENSITY_LABEL[density]}
      </button>

      {appVersion && <span className="tabular-nums">v{appVersion}</span>}
    </footer>
  );
}
