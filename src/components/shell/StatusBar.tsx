import React from "react";
import { usePanesStore } from "../../stores/panes-store";
import { useShellStore, applyDensity, type Density } from "../../stores/shell-store";
import { useCostStore } from "../../stores/cost-store";
import { activityPresentation, derivePaneActivity, type PaneActivity, type PaneStatusInput } from "./pane-status";
import { StatusGlyph } from "./pane-status-glyph";
import { McpRouteStatus } from "./McpRouteStatus";

/* ═══════════════════════════════════════════════════════════════════════════
   BARRA DE STATUS
   ═══════════════════════════════════════════════════════════════════════════

   Rodapé de uma linha: agentes por estado, MCP, custo, densidade e versão.

   Os estados vêm do vocabulário único de pane-status: mesmo rótulo, mesma cor
   e mesma forma do header do pane e da NavRail.
   ═══════════════════════════════════════════════════════════════════════════ */

const DENSITIES: Density[] = ["compact", "normal", "comfortable"];
const DENSITY_LABEL: Record<Density, string> = {
  compact: "compacto",
  normal: "normal",
  comfortable: "amplo",
};

/** Ordem de leitura: o que pede ação primeiro. */
const STATE_ORDER: PaneActivity[] = ["failed", "waiting", "blocked", "thinking", "running", "done", "idle"];

function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function Separator() {
  return <span className="h-3 w-px bg-cb-line-1 shrink-0" aria-hidden />;
}

export function StatusBar({ appVersion }: { appVersion?: string | null }) {
  const panes = usePanesStore((state) => state.panes) as PaneStatusInput[];
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

  const states = React.useMemo(() => {
    const counts = new Map<PaneActivity, number>();
    for (const pane of panes) {
      const activity = derivePaneActivity(pane);
      counts.set(activity, (counts.get(activity) ?? 0) + 1);
    }
    return STATE_ORDER
      .filter((activity) => counts.has(activity))
      .map((activity) => ({ activity, count: counts.get(activity)!, ...activityPresentation(activity) }));
  }, [panes]);

  const totalCost = costSummary?.totalCost ?? 0;

  return (
    <footer className="flex items-center gap-3 h-cell shrink-0 px-3 border-t border-cb-line-0 bg-cb-bg-1 text-xs text-cb-fg-2 whitespace-nowrap overflow-hidden">
      {states.length === 0 ? (
        <span>nenhum agente</span>
      ) : (
        <ul className="flex items-center gap-3 min-w-0 overflow-hidden" aria-label="Agentes por estado">
          {states.map((state) => (
            <li key={state.activity} className="flex items-center gap-1.5 tabular-nums shrink-0">
              <StatusGlyph activity={state.activity} size={11} />
              <span className="text-cb-fg-0">{state.count}</span>
              <span style={{ color: state.activity === "idle" ? undefined : state.color }}>{state.label}</span>
            </li>
          ))}
        </ul>
      )}

      <Separator />
      <McpRouteStatus />

      {/* Custo acumulado: clicável para abrir o painel completo. */}
      {totalCost > 0 && (
        <>
          <Separator />
          <button
            type="button"
            onClick={toggleCost}
            title="Ver uso e custos detalhados"
            className="hover:text-cb-fg-0 tabular-nums transition-colors duration-[var(--cb-duration-fast)]"
          >
            {formatCost(totalCost)}
          </button>
        </>
      )}

      <span className="flex-1" />

      <button
        type="button"
        onClick={() =>
          setDensity(DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length])
        }
        title="Densidade da interface"
        className="hover:text-cb-fg-0 rounded-cb-1 px-1 transition-colors duration-[var(--cb-duration-fast)]"
      >
        {DENSITY_LABEL[density]}
      </button>

      {appVersion && <span className="tabular-nums">v{appVersion}</span>}
    </footer>
  );
}
