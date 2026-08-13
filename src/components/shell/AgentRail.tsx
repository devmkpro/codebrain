import React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { usePanesStore } from "../../stores/panes-store";
import { useShellStore } from "../../stores/shell-store";
import { runAction } from "../../lib/actions";
import { statusPresentation } from "./pane-status";

/* ═══════════════════════════════════════════════════════════════════════════
   RAIL DE AGENTES
   ═══════════════════════════════════════════════════════════════════════════

   Coluna à esquerda listando cada pane como um bloco.

   No shell antigo, saber quais agentes existiam exigia olhar a grade de
   terminais e contar. Com quatro ou mais panes, ninguém sabe quem está
   pensando, quem travou e quem terminou sem clicar em cada um.

   O rail é a resposta terminal-first: uma linha por agente, com trilho
   colorido pelo estado. É a mesma linguagem de "bloco" que o Warp usa para
   comandos — e a cor do trilho vem dos tokens ANSI, então "erro" aqui é o
   mesmo vermelho de um stderr no terminal.
   ═══════════════════════════════════════════════════════════════════════════ */

interface PaneLike {
  id: string;
  agent?: string;
  title?: string;
  status?: string;
  kind?: string;
  cwd?: string;
}

function AgentRow({
  pane,
  active,
  collapsed,
  onSelect,
}: {
  pane: PaneLike;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const presentation = statusPresentation(pane.status);
  const label = pane.title || pane.agent || "shell";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-selected={active}
      aria-label={`${label} — ${presentation.label}`}
      title={collapsed ? `${label} — ${presentation.label}` : undefined}
      className="cb-row cb-rail w-full text-left h-cell"
      style={
        {
          "--cb-rail-color": active ? "var(--cb-accent)" : presentation.color,
        } as React.CSSProperties
      }
    >
      <span
        className="cb-dot"
        data-pulse={presentation.pulse}
        style={{ "--cb-dot-color": presentation.color } as React.CSSProperties}
        aria-hidden
      />
      {!collapsed && (
        <>
          <span className="flex-1 min-w-0 truncate text-xs">{label}</span>
          <span className="text-2xs text-cb-fg-3 shrink-0 tabular-nums">
            {pane.id.slice(0, 4)}
          </span>
        </>
      )}
    </button>
  );
}

export function AgentRail() {
  const panes = usePanesStore((state) => state.panes) as PaneLike[];
  const activePaneId = usePanesStore((state) => state.activePaneId);
  const setActive = usePanesStore((state) => state.setActive);

  const collapsed = useShellStore((state) => state.railCollapsed);
  const toggleRail = useShellStore((state) => state.toggleRail);

  return (
    <aside
      className="flex flex-col shrink-0 bg-cb-bg-1 border-r border-cb-line-0 transition-[width] duration-[var(--cb-duration-normal)]"
      style={{ width: collapsed ? "40px" : "200px" }}
      aria-label="Agentes"
    >
      <div className="flex items-center h-cell-lg px-2 border-b border-cb-line-0 shrink-0">
        {!collapsed && (
          <span className="cb-label flex-1 truncate">
            agentes · {panes.length}
          </span>
        )}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={collapsed ? "Expandir rail" : "Recolher rail"}
          title={collapsed ? "Expandir" : "Recolher"}
          className="p-1 text-cb-fg-3 hover:text-cb-fg-1 rounded-cb-1"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      <div className="cb-scroll flex-1 py-1 px-1" role="listbox" aria-label="Panes">
        {panes.length === 0 ? (
          !collapsed && (
            <p className="px-3 py-4 text-2xs text-cb-fg-3 leading-relaxed">
              Nenhum agente. <br />
              <span className="text-cb-fg-2">Ctrl+T</span> abre um.
            </p>
          )
        ) : (
          panes.map((pane) => (
            <AgentRow
              key={pane.id}
              pane={pane}
              active={pane.id === activePaneId}
              collapsed={collapsed}
              onSelect={() => setActive(pane.id)}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => void runAction("pane.new")}
        aria-label="Novo pane"
        title="Novo pane — Ctrl+T"
        className="flex items-center gap-2 h-cell-lg px-3 border-t border-cb-line-0 text-cb-fg-2 hover:text-cb-accent hover:bg-cb-bg-2 shrink-0"
      >
        <Plus size={13} strokeWidth={1.5} />
        {!collapsed && <span className="text-xs">novo pane</span>}
      </button>
    </aside>
  );
}
