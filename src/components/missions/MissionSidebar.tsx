/**
 * MissionSidebar — painel lateral direito com a lista de missões.
 * Status, modo, contagem de terminais, renomear, recolher.
 */
import React from 'react';
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMissionsStore, MISSION_MODE_LABEL, MISSION_STATUS_DOT_CLASS, MISSION_STATUS_TITLE, sortMissionsByTitle, compactMissionTitle, type Mission } from '../../stores/missions-store';
import { usePanesStore } from '../../stores/panes-store';
import { useSpawnPane } from '../../hooks/useSpawnPane';
import { navigate } from '../../lib/router';
import { MissionWizard } from './MissionWizard';
import { CloseMissionDialog } from './CloseMissionDialog';
import { notify } from '../../lib/notify';

const STORAGE_KEY = 'codebrain.missionSidebar.collapsed';

interface MissionSidebarProps {
  workspacePath: string;
}

const EMPTY_MISSIONS: Mission[] = [];

const openCentral = (missionId: string) => navigate('/central', { query: { s: 'missao', mission: missionId } });

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

  const allMissions = useMissionsStore(s => s.missionsByWorkspace[workspacePath] ?? EMPTY_MISSIONS);
  const missions = React.useMemo(() => allMissions.filter(m => m.status !== 'archived'), [allMissions]);
  const activeMissionId = useMissionsStore(s => s.activeMissionByWorkspace[workspacePath]);
  const setActiveMission = useMissionsStore(s => s.setActiveMission);
  const updateMission = useMissionsStore(s => s.updateMission);
  const archiveMission = useMissionsStore(s => s.archiveMission);
  const panes = usePanesStore((s: any) => s.panes) as any[];
  const { handleSpawnFromConfig } = useSpawnPane(workspacePath);

  const sorted = React.useMemo(() => [...missions].sort(sortMissionsByTitle), [missions]);

  const paneCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const pane of panes) {
      if ((pane.workspacePath ?? pane.cwd) !== workspacePath) continue;
      const mid = pane.missionId ?? activeMissionId;
      if (!mid) continue;
      map.set(mid, (map.get(mid) ?? 0) + 1);
    }
    return map;
  }, [panes, workspacePath, activeMissionId]);

  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  React.useEffect(() => () => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
  }, []);

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

  async function handleConfirmClose() {
    if (!closeRequest) return;
    const state = usePanesStore.getState() as { panes: any[]; removePane: (id: string) => void };
    const toClose = state.panes.filter(pane =>
      (pane.workspacePath ?? pane.cwd) === workspacePath &&
      (pane.missionId ?? activeMissionId) === closeRequest.mission.id,
    );
    try {
      await Promise.all(toClose.map(async pane => {
        if (pane.kind !== 'browser') {
          if (!window.codeBrainApp?.pty.kill) throw new Error('O app não pode encerrar os terminais agora.');
          await window.codeBrainApp.pty.kill(pane.id);
        }
        state.removePane(pane.id);
      }));
    } catch (error) {
      notify('Não deu para fechar a missão', error instanceof Error ? error.message : String(error), 'error');
      return;
    }
    archiveMission(workspacePath, closeRequest.mission.id);
    setCloseRequest(null);
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l border-cb-line-0 bg-cb-bg-1 w-8 shrink-0">
        <button type="button" onClick={() => setCollapsed(false)} className="p-1.5 text-cb-fg-2 hover:text-cb-fg-0 mt-2" title="Expandir missões" aria-label="Expandir missões">
          <ChevronLeft size={14} />
        </button>
        <div className="flex flex-col items-center gap-1 mt-2">
          {sorted.slice(0, 5).map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setActiveMission(workspacePath, m.id); setCollapsed(false); }}
              className={`w-2 h-2 rounded-full ${MISSION_STATUS_DOT_CLASS[m.status]} ${m.id === activeMissionId ? 'outline outline-1 outline-offset-1 outline-cb-accent' : ''}`}
              title={m.title}
              aria-label={m.title}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col border-l border-cb-line-0 bg-cb-bg-1 w-56 shrink-0">
        <div className="flex items-center justify-between h-cell-lg px-3 border-b border-cb-line-0 shrink-0">
          <span className="cb-label">Missões</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setShowWizard(true)} className="p-0.5 text-cb-fg-2 hover:text-cb-accent" title="Nova missão" aria-label="Nova missão">
              <Plus size={12} />
            </button>
            <button type="button" onClick={() => setCollapsed(true)} className="p-0.5 text-cb-fg-2 hover:text-cb-fg-0" title="Recolher" aria-label="Recolher missões">
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        <div className="cb-scroll flex-1 py-1">
          {sorted.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-2xs text-cb-fg-2">Nenhuma missão</p>
              <button type="button" onClick={() => setShowWizard(true)} className="mt-2 text-2xs text-cb-accent hover:text-cb-accent-bright">
                criar missão
              </button>
            </div>
          ) : (
            sorted.map(m => {
              const isActive = m.id === activeMissionId;
              const count = paneCounts.get(m.id) ?? 0;
              const isRenaming = renamingId === m.id;
              const agentic = m.mode === 'agentico';

              return (
                <div key={m.id} className={`group border-l-2 ${agentic ? 'border-l-cb-accent' : 'border-l-transparent'} ${isActive ? 'bg-cb-bg-3' : 'hover:bg-cb-bg-2'}`}>
                  <div className="flex items-center gap-2 px-3 min-h-cell-lg cursor-pointer" onClick={() => handleSelect(m.id)} onDoubleClick={() => handleDoubleClick(m)}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${MISSION_STATUS_DOT_CLASS[m.status]}`} title={MISSION_STATUS_TITLE[m.status]} />

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
                        className="cbc-control flex-1"
                        aria-label="Novo nome da missão"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className={`flex-1 min-w-0 truncate text-xs ${isActive ? 'text-cb-fg-0 font-bold' : 'text-cb-fg-1'}`} title={m.title}>
                        {compactMissionTitle(m)}
                      </span>
                    )}

                    {m.mode && !isRenaming && (
                      <span className={`text-2xs shrink-0 ${agentic ? 'text-cb-accent' : 'text-cb-fg-3'}`}>{MISSION_MODE_LABEL[m.mode].toLowerCase()}</span>
                    )}

                    {count > 0 && <span className="text-2xs text-cb-fg-3 shrink-0">{count}</span>}

                    {!isRenaming && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setCloseRequest({ mission: m, paneCount: count }); }}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 text-cb-fg-2 hover:text-cb-danger"
                        title="Fechar missão"
                        aria-label={`Fechar ${m.title}`}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  {agentic && (
                    <div className="px-3 pb-1 pl-[26px]">
                      <button type="button" onClick={() => openCentral(m.id)} className="text-2xs text-cb-fg-2 hover:text-cb-accent">
                        ❯ abrir Central
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-cb-line-0 px-3 py-2">
          <button type="button" className="cbc-btn w-full" onClick={() => setShowWizard(true)}>
            <Plus size={10} /> nova missão
          </button>
        </div>
      </div>

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
