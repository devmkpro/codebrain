/**
 * MissionsMenu — dropdown de missões no menu superior do Codebrain.
 * Baseado fielmente no WorkspaceTabs do Overclock (menu Missions).
 */
import React from 'react';
import { FolderTree, Plus, X, ChevronDown } from 'lucide-react';
import { useMissionsStore, MISSION_STATUS_DOT_CLASS, MISSION_STATUS_TITLE, sortMissionsByTitle, compactMissionTitle } from '../../stores/missions-store';
import type { Mission } from '../../stores/missions-store';
import { usePanesStore } from '../../stores/panes-store';

// ─── helpers ─────────────────────────────────────────────────────────────────

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

// ─── MissionsMenu ─────────────────────────────────────────────────────────────

export function MissionsMenu({ activeWorkspace }: { activeWorkspace: string }) {
  const [showTree, setShowTree] = React.useState(false);
  const [treeAnchor, setTreeAnchor] = React.useState<{ left: number; top: number } | null>(null);
  const [renamingMissionId, setRenamingMissionId] = React.useState<string | null>(null);
  const [missionTitleDraft, setMissionTitleDraft] = React.useState('');
  const [closeRequest, setCloseRequest] = React.useState<{ mission: Mission; paneCount: number } | null>(null);
  const missionRenameCancelledRef = React.useRef(false);
  const missionSelectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);

  // store
  const allMissions = useMissionsStore(s => s.missionsByWorkspace[activeWorkspace] ?? []);
  const missions = React.useMemo(() => allMissions.filter(m => m.status !== 'archived'), [allMissions]);
  const activeMissionId = useMissionsStore(s => s.getActiveMissionId(activeWorkspace));
  const ensureMission = useMissionsStore(s => s.ensureMissionForWorkspace);
  const createMission = useMissionsStore(s => s.createMission);
  const updateMission = useMissionsStore(s => s.updateMission);
  const setActiveMission = useMissionsStore(s => s.setActiveMission);
  const archiveMission = useMissionsStore(s => s.archiveMission);
  const panes = usePanesStore(s => s.panes);

  const sortedMissions = React.useMemo(() => [...missions].sort(sortMissionsByTitle), [missions]);
  const activeMission = activeMissionId ?? missions[0]?.id ?? null;
  const activeMissionItem = sortedMissions.find(m => m.id === activeMission) ?? sortedMissions[0] ?? null;

  const paneCountsByMission = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const pane of panes) {
      if ((pane.workspacePath ?? pane.cwd) !== activeWorkspace) continue;
      const mid = (pane as any).missionId ?? activeMission;
      if (!mid) continue;
      map.set(mid, (map.get(mid) ?? 0) + 1);
    }
    return map;
  }, [activeMission, activeWorkspace, panes]);

  const totalPaneCount = React.useMemo(
    () => panes.filter(p => (p.workspacePath ?? p.cwd) === activeWorkspace).length,
    [activeWorkspace, panes],
  );

  const activeMissionPaneCount = activeMission ? paneCountsByMission.get(activeMission) ?? 0 : 0;
  const workspaceLabel = basename(activeWorkspace);

  // Ensure at least one mission exists on mount / workspace change
  React.useEffect(() => {
    ensureMission(activeWorkspace);
  }, [activeWorkspace, ensureMission]);

  // Reset on workspace change
  React.useEffect(() => {
    setRenamingMissionId(null);
    setMissionTitleDraft('');
    setShowTree(false);
    clearMissionSelectTimer();
  }, [activeWorkspace]);

  // Close on click outside
  React.useEffect(() => {
    if (!showTree) return;
    const handler = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (popupRef.current?.contains(e.target as Node)) return;
      setShowTree(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowTree(false); };
    document.addEventListener('mousedown', handler);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', onKey);
    };
  }, [showTree]);

  function clearMissionSelectTimer() {
    if (missionSelectTimerRef.current === null) return;
    clearTimeout(missionSelectTimerRef.current);
    missionSelectTimerRef.current = null;
  }

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setTreeAnchor({ left: rect.left, top: rect.bottom });
    setShowTree(open => !open);
  };

  const openForRename = (mission: Mission) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setTreeAnchor({ left: rect.left, top: rect.bottom });
    clearMissionSelectTimer();
    setShowTree(true);
    beginRename(mission);
  };

  const beginRename = (mission: Mission) => {
    missionRenameCancelledRef.current = false;
    setRenamingMissionId(mission.id);
    setMissionTitleDraft(mission.title);
  };

  const cancelRename = () => {
    missionRenameCancelledRef.current = true;
    setRenamingMissionId(null);
    setMissionTitleDraft('');
  };

  const commitRename = (missionId: string) => {
    if (missionRenameCancelledRef.current) {
      missionRenameCancelledRef.current = false;
      setRenamingMissionId(null);
      setMissionTitleDraft('');
      return;
    }
    if (!activeWorkspace) { cancelRename(); return; }
    const title = missionTitleDraft.trim();
    if (title) updateMission(activeWorkspace, missionId, { title });
    cancelRename();
  };

  const selectMission = (mission: Mission) => {
    clearMissionSelectTimer();
    missionSelectTimerRef.current = setTimeout(() => {
      setActiveMission(activeWorkspace, mission.id);
      setShowTree(false);
      missionSelectTimerRef.current = null;
    }, 180);
  };

  const renameOnDoubleClick = (mission: Mission) => {
    clearMissionSelectTimer();
    setActiveMission(activeWorkspace, mission.id);
    beginRename(mission);
  };

  const handleCreate = () => {
    createMission(activeWorkspace, {});
  };

  const handleClose = (mission: Mission) => {
    const paneCount = panes.filter(p => {
      if ((p.workspacePath ?? p.cwd) !== activeWorkspace) return false;
      return (p as any).missionId
        ? (p as any).missionId === mission.id
        : mission.id === activeMission;
    }).length;
    setShowTree(false);
    setCloseRequest({ mission, paneCount });
  };

  const confirmClose = () => {
    if (!closeRequest) return;
    const { mission } = closeRequest;
    const paneIds = panes
      .filter(p => {
        if ((p.workspacePath ?? p.cwd) !== activeWorkspace) return false;
        return (p as any).missionId
          ? (p as any).missionId === mission.id
          : mission.id === activeMission;
      })
      .map(p => p.id);
    setCloseRequest(null);
    for (const pid of paneIds) {
      usePanesStore.getState().removePane(pid);
      (window as any).codeBrainApp?.pty?.kill?.(pid)?.catch?.(() => {});
    }
    archiveMission(activeWorkspace, mission.id);
  };

  // Don't render if no missions
  if (sortedMissions.length === 0) return null;

  const activeLabel = activeMissionItem ? compactMissionTitle(activeMissionItem) : 'Missão';

  return (
    <>
      {/* ── Confirm close modal ───────────────────────────────── */}
      {closeRequest && (
        <div
          className="fixed inset-0 z-[10030] flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={() => setCloseRequest(null)}
          />
          <div className="relative w-[340px] rounded-xl border border-white/10 bg-[#0d0d0d] shadow-2xl p-5 flex flex-col gap-4">
            {/* icon + title */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10 text-violet-300">
                <X size={16} strokeWidth={1.7} />
              </div>
              <div>
                <p className="font-mono text-[11px] font-bold text-slate-100">Fechar missão</p>
                <p className="font-mono text-[10px] text-slate-500 mt-0.5 truncate max-w-[230px]" title={closeRequest.mission.title}>
                  {closeRequest.mission.title}
                </p>
              </div>
            </div>

            {/* body */}
            <p className="font-mono text-[10px] leading-relaxed text-slate-400">
              {closeRequest.paneCount > 0
                ? <>Esta missão tem <span className="text-violet-300 font-bold">{closeRequest.paneCount} terminal{closeRequest.paneCount !== 1 ? 'is' : ''}</span> aberto{closeRequest.paneCount !== 1 ? 's' : ''}. Todos serão encerrados.</>
                : <>A missão será arquivada.</>}
            </p>

            {/* actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCloseRequest(null)}
                className="px-3 py-1.5 rounded-lg border border-white/10 font-mono text-[10px] text-slate-400 hover:text-slate-200 hover:border-white/20 transition-all focus:outline-none"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmClose}
                className="px-3 py-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 font-mono text-[10px] font-bold text-violet-300 hover:bg-violet-500/25 hover:border-violet-500/60 transition-all focus:outline-none"
              >
                Fechar missão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Trigger button ────────────────────────────────────── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onDoubleClick={e => { e.preventDefault(); if (activeMissionItem) openForRename(activeMissionItem); }}
        className={`h-full max-w-[128px] px-2 flex items-center gap-1 text-left transition-colors focus:outline-none shrink-0
          ${showTree
            ? 'bg-violet-500/10 text-violet-200'
            : 'text-violet-400/70 hover:bg-violet-500/[0.06] hover:text-violet-200'}`}
        aria-haspopup="true"
        aria-expanded={showTree}
        title={`${activeMissionItem?.title ?? 'Missão'} · ${activeMissionPaneCount} pane${activeMissionPaneCount === 1 ? '' : 's'}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="min-w-0 truncate font-mono text-[10px] font-bold">{activeLabel}</span>
        <ChevronDown size={10} strokeWidth={1.5} className={`shrink-0 transition-transform ${showTree ? 'rotate-180' : ''}`} />
      </button>

      {/* ── Dropdown popup ────────────────────────────────────── */}
      {showTree && treeAnchor && (
        <div
          ref={popupRef}
          className="fixed z-[10020] w-[320px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-violet-500/20 bg-[#080808] shadow-2xl"
          style={{
            left: Math.max(8, Math.min(treeAnchor.left, window.innerWidth - 328)),
            top: treeAnchor.top + 4,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-violet-500/25 bg-violet-500/10 text-violet-300">
              <FolderTree size={14} strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">Workspace</p>
              <p className="truncate font-mono text-[11px] font-bold text-gray-200" title={activeWorkspace}>{workspaceLabel}</p>
            </div>
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
              {totalPaneCount}
            </span>
          </div>

          {/* Body */}
          <div className="px-2 py-2">
            {/* Missions header */}
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">Missions</p>
              <button
                type="button"
                onClick={handleCreate}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/10 text-gray-500 transition-all hover:border-violet-500/30 hover:bg-violet-500/10 hover:text-violet-300 focus:outline-none"
                title="Nova missão"
                aria-label="Nova missão"
              >
                <Plus size={12} strokeWidth={1.6} />
              </button>
            </div>

            {/* Mission list */}
            <div className="max-h-[360px] overflow-y-auto pr-1">
              {sortedMissions.map(mission => {
                const isActive = mission.id === activeMission;
                const paneCount = paneCountsByMission.get(mission.id) ?? 0;
                const isRenaming = renamingMissionId === mission.id;

                if (isRenaming) {
                  return (
                    <form
                      key={mission.id}
                      onSubmit={e => { e.preventDefault(); commitRename(mission.id); }}
                      className="ml-3 grid min-h-9 grid-cols-[14px_minmax(0,1fr)] items-center gap-1.5 border-l border-gray-800 px-2"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${MISSION_STATUS_DOT_CLASS[mission.status]}`} />
                      <input
                        autoFocus
                        value={missionTitleDraft}
                        onChange={e => setMissionTitleDraft(e.currentTarget.value)}
                        onFocus={e => e.currentTarget.select()}
                        onBlur={() => commitRename(mission.id)}
                        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancelRename(); } }}
                        className="min-w-0 bg-transparent font-mono text-[10px] font-bold text-violet-100 outline-none placeholder:text-gray-700"
                        placeholder="Nome"
                        aria-label="Renomear missão"
                      />
                    </form>
                  );
                }

                return (
                  <div
                    key={mission.id}
                    className={`group flex min-h-9 items-center rounded transition-colors
                      ${isActive ? 'bg-violet-500/10 text-violet-100' : 'text-gray-500 hover:bg-white/[0.03] hover:text-gray-300'}`}
                    title={`${mission.title} · ${MISSION_STATUS_TITLE[mission.status]} · ${paneCount} pane${paneCount === 1 ? '' : 's'}`}
                  >
                    <button
                      type="button"
                      onClick={e => { if (e.detail > 1) return; selectMission(mission); }}
                      onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); renameOnDoubleClick(mission); }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left transition-all focus:outline-none"
                    >
                      <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${MISSION_STATUS_DOT_CLASS[mission.status]}`} />
                      <span className="min-w-0 truncate font-mono text-[10px] font-bold">{mission.title}</span>
                      {paneCount > 0 && (
                        <span className="shrink-0 font-mono text-[10px] text-violet-300/80">· {paneCount}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleClose(mission); }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-700 opacity-0 transition-all hover:bg-violet-500/10 hover:text-violet-300 group-hover:opacity-100 focus:opacity-100 focus:outline-none"
                      title={`Fechar missão ${mission.title}`}
                      aria-label={`Fechar missão ${mission.title}`}
                    >
                      <X size={12} strokeWidth={1.7} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
