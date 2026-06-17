import React from "react";

// Grid
import { usePanesStore } from "../../stores/panes-store";
import { useMissionsStore } from "../../stores/missions-store";
import { DropTarget } from "./DropTarget";
import { BrowserPane } from "../panes/BrowserPane";
import { TerminalPane } from "../terminal/TerminalPane";
import { RenderNode } from "./RenderNode";
import { MissionSidebar } from "../missions/MissionSidebar";

export function Grid({ workspacePath } = {} as any) {
  const allPanes = usePanesStore(s => s.panes) as any[];
  const activePaneId = usePanesStore(s => s.activePaneId);
  const layouts = usePanesStore(s => s.layouts) as Record<string, Record<string, any>>;
  const setActive = usePanesStore(s => s.setActive);
  const movePaneTo = usePanesStore(s => s.movePaneTo);
  const ensureMission = useMissionsStore(s => s.ensureMissionForWorkspace);

  const ws = workspacePath ?? "";

  // Garantir que existe pelo menos uma missão
  React.useEffect(() => {
    if (ws) ensureMission(ws);
  }, [ws, ensureMission]);

  // Missão ativa para este workspace
  const activeMissionId = useMissionsStore(s => ws ? s.getActiveMissionId(ws) : null);

  // Layout da missão ativa
  const layout = ws && activeMissionId ? layouts[ws]?.[activeMissionId] ?? null : null;

  // Panes pertencentes a esta missão
  const missionPanes = React.useMemo(() => {
    if (!ws || !activeMissionId) return [];
    return allPanes.filter(p => {
      if ((p.workspacePath ?? p.cwd) !== ws) return false;
      // pane sem missionId → pertence à missão ativa (retrocompatibilidade)
      return p.missionId ? p.missionId === activeMissionId : true;
    });
  }, [allPanes, ws, activeMissionId]);

  const panesById = new Map(missionPanes.map(p => [p.id, p]));

  if (!layout) {
    return (
      <div className="flex-1 flex select-none relative">
        <div className="flex-1 flex items-center justify-center relative">
        {/* Subtle radial gradient background */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, rgba(139,92,246,0.03) 0%, transparent 70%)' }} />
        <div className="text-center space-y-5 relative z-10">
          {/* Logo mark */}
          <div className="mx-auto w-20 h-20 rounded-2xl bg-violet-500/5 border border-violet-500/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <div>
            <p className="font-mono text-[11px] text-slate-500 tracking-[0.2em] uppercase mb-2">No Panes Open</p>
            <p className="font-mono text-[10px] text-slate-600 max-w-xs leading-relaxed">
              Click <span className="text-violet-400 font-bold">+ SHELL</span> in the header or press <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] mx-0.5">⌘T</kbd> to spawn a terminal.
            </p>
          </div>
          {/* Quick action hints */}
          <div className="flex items-center justify-center gap-3 pt-2">
            {[
              { keys: '⌘T', label: 'New Pane' },
              { keys: '⌘1-9', label: 'Switch' },
              { keys: '⌘W', label: 'Close' },
            ].map(({ keys, label }) => (
              <div key={keys} className="flex items-center gap-1.5 text-[9px] text-slate-700">
                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] font-mono text-slate-500">{keys}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
        {ws && <MissionSidebar workspacePath={ws} />}
      </div>
    );
  }

  const renderLeaf = (paneId: string) => {
    const pane = panesById.get(paneId);
    if (!pane) return null;
    return (
      <DropTarget pane={pane} workspacePath={ws} movePaneTo={movePaneTo}>
        {pane.kind === "browser"
          ? <BrowserPane pane={pane} isActive={pane.id === activePaneId} onClick={() => setActive(pane.id)} />
          : <TerminalPane pane={pane} isActive={pane.id === activePaneId} onClick={() => setActive(pane.id)} />}
      </DropTarget>
    );
  };

  return (
    <div className="h-full w-full flex overflow-hidden">
      <div className="flex-1 overflow-hidden p-1.5">
        <RenderNode node={layout} panesById={panesById} renderLeaf={renderLeaf} />
      </div>
      {ws && <MissionSidebar workspacePath={ws} />}
    </div>
  );
}
