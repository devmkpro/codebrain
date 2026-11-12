import React from "react";
import { X } from "lucide-react";

import { usePanesStore } from "../../stores/panes-store";
import { CODEBRAIN_PANE_DRAG_TYPE } from "../../lib/pane-drag";
import { OfficeView, useOfficeSummary } from "./OfficeView";

/* Pane "escritório": o OfficeView dentro do grid de um workspace. */
export function OfficePane({ pane, isActive, onClick }: { pane: any; isActive: boolean; onClick: () => void }) {
  const removePane = usePanesStore((state: any) => state.removePane) as (id: string) => void;
  const setActive = usePanesStore((state: any) => state.setActive) as (id: string) => void;
  const office = useOfficeSummary();
  const workspaces = office.rooms.length;

  return (
    <div onClick={onClick} className="cb-pane" data-active={isActive} style={{ "--cb-status-color": isActive ? "var(--cb-accent)" : "var(--cb-line-2)" } as React.CSSProperties}>
      <div className="cb-pane-head" draggable onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(CODEBRAIN_PANE_DRAG_TYPE, pane.id);
      }}>
        <span className="font-mono text-[9px] text-cb-accent/70 uppercase tracking-widest mr-1">escritório</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[10px] text-cb-fg-2">
          {office.agents.length} agentes · {workspaces} {workspaces === 1 ? "workspace" : "workspaces"}
        </span>
        <button onClick={(e) => { e.stopPropagation(); removePane(pane.id); }} className="text-gray-700 hover:text-rose-400 px-1" title="Fechar" aria-label="Fechar escritório">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <OfficeView onFocusPane={setActive} style={{ flex: 1, width: "100%" }} />
    </div>
  );
}
