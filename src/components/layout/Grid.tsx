import React from "react";

// Grid
import { usePanesStore } from "../../stores/panes-store";
import { useMissionsStore } from "../../stores/missions-store";
import { DropTarget } from "./DropTarget";
import { BrowserPane } from "../panes/BrowserPane";
import { TerminalPane } from "../terminal/TerminalPane";
import { RenderNode } from "./RenderNode";
import { MissionSidebar } from "../missions/MissionSidebar";
import { MissionWizard } from "../missions/MissionWizard";
import { useSpawnPane } from "../../hooks/useSpawnPane";
import { Sparkles } from "lucide-react";

export function Grid({ workspacePath } = {} as any) {
  const allPanes = usePanesStore(s => s.panes) as any[];
  const activePaneId = usePanesStore(s => s.activePaneId);
  const layouts = usePanesStore(s => s.layouts) as Record<string, Record<string, any>>;
  const setActive = usePanesStore(s => s.setActive);
  const movePaneTo = usePanesStore(s => s.movePaneTo);
  const ensureMission = useMissionsStore(s => s.ensureMissionForWorkspace);

  const ws = workspacePath ?? "";

  // Mission wizard auto-open state
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [hasShownWizard, setHasShownWizard] = React.useState(false);
  const { handleSpawnFromConfig } = useSpawnPane(ws);

  // Garantir que existe pelo menos uma missão
  React.useEffect(() => {
    if (ws) ensureMission(ws);
  }, [ws, ensureMission]);

  // Auto-open wizard when workspace opens with no panes
  const missions = useMissionsStore(s => ws ? (s.missionsByWorkspace[ws] ?? []) : []);
  const activeMissions = React.useMemo(() => missions.filter(m => m.status !== 'archived'), [missions]);
  const wsPaneCount = React.useMemo(
    () => allPanes.filter(p => (p.workspacePath ?? p.cwd) === ws).length,
    [allPanes, ws],
  );

  React.useEffect(() => {
    if (ws && wsPaneCount === 0 && activeMissions.length <= 1 && !hasShownWizard) {
      // Small delay so the workspace renders first
      const timer = setTimeout(() => {
        setWizardOpen(true);
        setHasShownWizard(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [ws, wsPaneCount, activeMissions.length, hasShownWizard]);

  // Reset wizard state on workspace change
  React.useEffect(() => {
    setHasShownWizard(false);
  }, [ws]);

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
            <Sparkles size={28} className="text-violet-400/40" />
          </div>
          <div>
            <p className="font-mono text-[11px] text-slate-400 tracking-[0.15em] uppercase mb-2">Nenhuma missão ativa</p>
            <p className="font-mono text-[10px] text-slate-600 max-w-xs leading-relaxed">
              Crie uma missão para começar a trabalhar com agentes.
            </p>
          </div>
          {/* Primary CTA */}
          <button
            onClick={() => setWizardOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4F46E5] px-5 py-2.5 font-mono text-[11px] font-bold text-white hover:bg-[#4338CA] transition-colors"
          >
            <Sparkles size={14} /> Nova Missão
          </button>
          {/* Quick action hints */}
          <div className="flex items-center justify-center gap-3 pt-1">
            {(() => {
              const mod = /Mac/i.test(navigator.userAgent) && !/Windows/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';
              const shift = /Mac/i.test(navigator.userAgent) ? '⇧' : 'Shift';
              return [
                { keys: `${mod}+T`, label: 'Terminal' },
                { keys: `${mod}+${shift}+M`, label: 'Missões' },
                { keys: `${mod}+1-9`, label: 'Switch' },
              ];
            })().map(({ keys, label }) => (
              <div key={keys} className="flex items-center gap-1.5 text-[9px] text-slate-700">
                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] font-mono text-slate-600">{keys}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
        {ws && <MissionSidebar workspacePath={ws} />}
        <MissionWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          workspacePath={ws}
          onCreated={(missionId, mode, configs) => {
            if (mode === 'livre' && configs && configs.length > 0) {
              handleSpawnFromConfig(configs, missionId);
            }
          }}
        />
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
