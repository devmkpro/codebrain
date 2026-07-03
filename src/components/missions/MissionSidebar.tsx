/**
 * MissionSidebar — Painel lateral direito com lista de missões.
 * Status dots, pane counts, inline rename, collapse toggle.
 */
import React from 'react';
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMissionsStore, MISSION_STATUS_DOT_CLASS, MISSION_STATUS_TITLE, sortMissionsByTitle, compactMissionTitle, type Mission, type MissionMode, type ProviderPaneConfig } from '../../stores/missions-store';
import { usePanesStore } from '../../stores/panes-store';
import { useSpawnPane } from '../../hooks/useSpawnPane';
import { MissionWizard } from './MissionWizard';
import { CloseMissionDialog } from './CloseMissionDialog';

const STORAGE_KEY = 'codebrain.missionSidebar.collapsed';

interface MissionSidebarProps {
  workspacePath: string;
}

const EMPTY_MISSIONS: any[] = [];

export function MissionSidebar({ workspacePath }: MissionSidebarProps) {
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [showWizard, setShowWizard] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [closeRequest, setCloseRequest] = React.useState<{ mission: Mission; paneCount: number } | null>(null);
  const cancelledRef = React.useRef(false);
  const selectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store
  const allMissions = useMissionsStore(s => s.missionsByWorkspace[workspacePath] ?? EMPTY_MISSIONS);
  const missions = React.useMemo(() => allMissions.filter(m => m.status !== 'archived'), [allMissions]);
  const activeMissionId = useMissionsStore(s => s.activeMissionByWorkspace[workspacePath]);
  const setActiveMission = useMissionsStore(s => s.setActiveMission);
  const updateMission = useMissionsStore(s => s.updateMission);
  const archiveMission = useMissionsStore(s => s.archiveMission);
  const panes = usePanesStore(s => s.panes);
  const { handleSpawnFromConfig } = useSpawnPane(workspacePath);

  const sorted = React.useMemo(() => [...missions].sort(sortMissionsByTitle), [missions]);

  // Pane counts per mission
  const paneCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const pane of panes) {
      if ((pane.workspacePath ?? pane.cwd) !== workspacePath) continue;
      const mid = (pane as any).missionId ?? activeMissionId;
      if (!mid) continue;
      map.set(mid, (map.get(mid) ?? 0) + 1);
    }
    return map;
  }, [panes, workspacePath, activeMissionId]);

  // Persist collapsed state
  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  function handleSelect(missionId: string) {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    selectTimerRef.current = setTimeout(() => {
      setActiveMission(workspacePath, missionId);
    }, 120);
  }

  function handleDoubleClick(mission: Mission) {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    setRenamingId(mission.id);
    setDraft(mission.title);
    cancelledRef.current = false;
  }

  function handleRenameCommit() {
    if (renamingId && draft.trim() && !cancelledRef.current) {
      updateMission(workspacePath, renamingId, { title: draft.trim() });
    }
    setRenamingId(null);
  }

  function handleCloseClick(mission: Mission) {
    const count = paneCounts.get(mission.id) ?? 0;
    setCloseRequest({ mission, paneCount: count });
  }

  function handleConfirmClose() {
    if (!closeRequest) return;
    archiveMission(workspacePath, closeRequest.mission.id);
    setCloseRequest(null);
  }

  // Collapsed state
  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l border-white/5 bg-[#0c0c14] w-8 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 text-slate-700 hover:text-slate-300 transition-colors mt-2"
          title="Expandir missões"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="flex flex-col items-center gap-1 mt-2">
          {sorted.slice(0, 5).map(m => (
            <button
              key={m.id}
              onClick={() => { setActiveMission(workspacePath, m.id); setCollapsed(false); }}
              className={`w-2 h-2 rounded-full transition-colors ${MISSION_STATUS_DOT_CLASS[m.status]} ${
                m.id === activeMissionId ? 'ring-1 ring-white/30 ring-offset-1 ring-offset-[#0e0e0e]' : ''
              }`}
              title={m.title}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col border-l border-white/5 bg-[#0c0c14] w-56 shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Missões</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowWizard(true)}
              className="p-0.5 text-slate-700 hover:text-indigo-400 transition-colors"
              title="Nova missão"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={() => setCollapsed(true)}
              className="p-0.5 text-slate-700 hover:text-slate-300 transition-colors"
              title="Recolher"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* Mission list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sorted.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="font-mono text-[10px] text-slate-700">Nenhuma missão</p>
              <button
                onClick={() => setShowWizard(true)}
                className="mt-2 font-mono text-[10px] text-indigo-400 hover:text-amber-300 transition-colors"
              >
                + Criar missão
              </button>
            </div>
          ) : (
            sorted.map(m => {
              const isActive = m.id === activeMissionId;
              const count = paneCounts.get(m.id) ?? 0;
              const isRenaming = renamingId === m.id;

              return (
                <div
                  key={m.id}
                  className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                    isActive ? 'bg-white/5' : 'hover:bg-white/3'
                  }`}
                  onClick={() => handleSelect(m.id)}
                  onDoubleClick={() => handleDoubleClick(m)}
                >
                  {/* Status dot */}
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${MISSION_STATUS_DOT_CLASS[m.status]}`} />

                  {/* Title */}
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onBlur={handleRenameCommit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameCommit();
                        if (e.key === 'Escape') { cancelledRef.current = true; setRenamingId(null); }
                      }}
                      className="flex-1 min-w-0 bg-transparent border-b border-indigo-500/30 font-mono text-[11px] text-slate-300 outline-none py-0"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className={`flex-1 min-w-0 truncate font-mono text-[11px] ${
                      isActive ? 'text-slate-300 font-bold' : 'text-slate-500'
                    }`} title={m.title}>
                      {compactMissionTitle(m)}
                    </span>
                  )}

                  {/* Pane count */}
                  {count > 0 && (
                    <span className="font-mono text-[9px] text-slate-700 shrink-0">{count}</span>
                  )}

                  {/* Close button (hover) */}
                  {!isRenaming && (
                    <button
                      onClick={e => { e.stopPropagation(); handleCloseClick(m); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-700 hover:text-red-400 transition-all"
                      title="Fechar missão"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 px-3 py-2">
          <button
            onClick={() => setShowWizard(true)}
            className="w-full flex items-center justify-center gap-1 rounded border border-dashed border-white/10 py-1.5 font-mono text-[10px] text-slate-600 hover:text-indigo-400 hover:border-indigo-500/30 transition-colors"
          >
            <Plus size={10} /> Nova Missão
          </button>
        </div>
      </div>

      {/* Modals */}
      <MissionWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        workspacePath={workspacePath}
        onCreated={(missionId, mode, configs) => {
          if (mode === 'livre' && configs && configs.length > 0) {
            handleSpawnFromConfig(configs, missionId);
          }
        }}
      />
      <CloseMissionDialog
        open={!!closeRequest}
        mission={closeRequest?.mission ?? null}
        paneCount={closeRequest?.paneCount ?? 0}
        workspacePath={workspacePath}
        onClose={() => setCloseRequest(null)}
        onConfirm={handleConfirmClose}
      />
    </>
  );
}
