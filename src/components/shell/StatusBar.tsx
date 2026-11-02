import React from "react";
import { usePanesStore } from "../../stores/panes-store";
import { useShellStore, applyDensity, type Density } from "../../stores/shell-store";
import { useCostStore } from "../../stores/cost-store";
import { toPaneStatus } from "./pane-status";
import { McpRouteStatus } from "./McpRouteStatus";

/* ═══════════════════════════════════════════════════════════════════════════
   BARRA DE STATUS
   ═══════════════════════════════════════════════════════════════════════════

   Rodapé de uma linha: presença global, contagem de agentes, custo acumulado
   da sessão, densidade e versão.
   ═══════════════════════════════════════════════════════════════════════════ */

const DENSITIES: Density[] = ["compact", "normal", "comfortable"];
const DENSITY_LABEL: Record<Density, string> = {
  compact: "compacto",
  normal: "normal",
  comfortable: "amplo",
};

function PresenceDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className="cb-dot"
      data-pulse={pulse ? "true" : undefined}
      style={{ "--cb-dot-color": color } as React.CSSProperties}
      aria-hidden
    />
  );
}

function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function StatusBar({ appVersion }: { appVersion?: string | null }) {
  const panes = usePanesStore((state) => state.panes) as { status?: string }[];
  const density = useShellStore((state) => state.density);
  const setDensity = useShellStore((state) => state.setDensity);
  const costSummary = useCostStore((s) => s.summary);
  const loadCostSummary = useCostStore((s) => s.loadSummary);
  const toggleCost = useCostStore((s) => s.toggle);

  React.useEffect(() => applyDensity(density), [density]);

  // Carrega custo ao montar e recarrega a cada 30s.
  React.useEffect(() => {
    void loadCostSummary();
    const id = setInterval(() => void loadCostSummary(), 30_000);
    return () => clearInterval(id);
  }, [loadCostSummary]);

  const counts = React.useMemo(() => {
    let working = 0;
    let failed = 0;
    let blocked = 0;
    for (const pane of panes) {
      const status = toPaneStatus(pane.status);
      if (status === "running" || status === "booting") working++;
      if (status === "error") failed++;
      if (status === "blocked") blocked++;
    }
    return { working, failed, blocked, total: panes.length };
  }, [panes]);

  const presenceColor =
    counts.failed > 0
      ? "var(--cb-danger)"
      : counts.blocked > 0
        ? "var(--cb-warn)"
        : counts.working > 0
          ? "var(--cb-agent-thinking)"
          : "var(--cb-agent-done)";

  const presencePulse = counts.working > 0 || counts.failed > 0;

  const totalCost = costSummary?.totalCost ?? 0;

  return (
    <footer
      className="flex items-center gap-3 h-cell shrink-0 px-3 border-t border-cb-line-0 text-2xs text-cb-fg-3"
      style={{
        background: "linear-gradient(0deg, var(--cb-bg-0) 0%, var(--cb-bg-1) 100%)",
      }}
    >
      {/* Presença global */}
      <PresenceDot color={presenceColor} pulse={presencePulse} />

      {/* Contagem de agentes */}
      <span className="tabular-nums">
        {counts.total} {counts.total === 1 ? "agente" : "agentes"}
      </span>

      {counts.working > 0 && (
        <span className="text-cb-agent-thinking tabular-nums">
          {counts.working} trabalhando
        </span>
      )}
      {counts.blocked > 0 && (
        <span className="text-cb-agent-blocked tabular-nums">
          {counts.blocked} bloqueado{counts.blocked > 1 ? "s" : ""}
        </span>
      )}
      {counts.failed > 0 && (
        <span className="text-cb-danger tabular-nums">
          {counts.failed} com erro
        </span>
      )}

      <span className="h-3 w-px bg-cb-line-0" aria-hidden />
      <McpRouteStatus />

      {/* Custo acumulado — clicável para abrir o painel completo */}
      {totalCost > 0 && (
        <>
          <span className="h-3 w-px bg-cb-line-0" aria-hidden />
          <button
            type="button"
            onClick={toggleCost}
            title="Ver uso e custos detalhados"
            className="hover:text-cb-fg-1 tabular-nums transition-colors duration-[var(--cb-duration-fast)]"
          >
            {formatCost(totalCost)}
          </button>
        </>
      )}

      <span className="flex-1" />

      {/* Toggle de densidade */}
      <button
        type="button"
        onClick={() =>
          setDensity(DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length])
        }
        title="Densidade da interface"
        className="hover:text-cb-fg-1 rounded-cb-1 px-1 transition-colors duration-[var(--cb-duration-fast)]"
      >
        {DENSITY_LABEL[density]}
      </button>

      {appVersion && (
        <span
          className="tabular-nums px-1.5 py-0.5 rounded-cb-1"
          style={{ background: "var(--cb-bg-2)", color: "var(--cb-fg-3)" }}
        >
          v{appVersion}
        </span>
      )}
    </footer>
  );
}
