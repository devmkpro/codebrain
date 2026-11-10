import React from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronRight,
  Circle,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Plus,
  RotateCw,
  Send,
  Terminal,
} from "lucide-react";
import type { OperationalActivity, OperationalActor, OperationalMission, OperationsLane, OperationsSnapshot } from "../../types/operations";

export interface OperationsBoardProps {
  workspacePaths: string[];
  onOpenWorkspace: (path: string) => void;
  onNewPane: (path: string) => void;
  onRefresh?: () => void;
}

interface ArchiveResult { ok: boolean; error?: string; requiresConfirmation?: boolean; activePaneIds?: string[] }

const LANE_META: Record<OperationsLane, { label: string; description: string; tone: string }> = {
  working: { label: "Em execução", description: "agentes trabalhando agora", tone: "text-cb-agent-running" },
  attention: { label: "Precisa de atenção", description: "entrada ou decisão pendente", tone: "text-cb-warn" },
  ready: { label: "Pronto para integrar", description: "missões concluídas ou prontas", tone: "text-cb-success" },
  idle: { label: "Em espera", description: "projetos sem atividade agora", tone: "text-cb-fg-2" },
};

function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

function timeAgo(timestamp?: number): string {
  if (!timestamp) return "sem atividade";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "agora";
  if (seconds < 60) return `${seconds}s atrás`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  return `${Math.floor(minutes / 60)}h atrás`;
}

function activityLabel(activity?: OperationalActivity): string {
  if (!activity) return "Nenhum evento operacional ainda";
  if (activity.kind === "handoff") return `handoff · ${activity.text}`;
  if (activity.kind === "message") return `${activity.label || "agente"} · ${activity.text}`;
  return activity.text;
}

function MissionCard({
  mission,
  actors,
  latestActivity,
  onOpen,
  onNewPane,
  onArchive,
}: {
  mission: OperationalMission;
  actors: OperationalActor[];
  latestActivity?: OperationalActivity;
  onOpen: () => void;
  onNewPane: () => void;
  onArchive: (confirmedActive: boolean) => Promise<ArchiveResult>;
}) {
  const laneMeta = LANE_META[mission.lane];
  const missionActors = actors.filter((actor) => mission.actorIds.includes(actor.pane_id));
  const actorLabels = missionActors.map((actor) => actor.label || actor.agent || actor.pane_id.slice(0, 8)).filter(Boolean);
  const visibleLabels = actorLabels.slice(0, 3);
  const orchestrator = mission.orchestratorId ? actors.find((actor) => actor.pane_id === mission.orchestratorId) : undefined;
  const [confirmation, setConfirmation] = React.useState<string[] | null>(null);
  const [archiving, setArchiving] = React.useState(false);
  const [archiveError, setArchiveError] = React.useState<string | null>(null);
  const confirmationId = React.useId();
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const archiveRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (confirmation) cancelRef.current?.focus();
  }, [confirmation]);

  const archive = async (confirmedActive = false) => {
    if (archiving) return;
    setArchiveError(null);
    const activeIds = missionActors.filter((actor) => actor.live === true).map((actor) => actor.pane_id);
    if (!confirmedActive && activeIds.length) { setConfirmation(activeIds); return; }
    setArchiving(true);
    try {
      const result = await onArchive(confirmedActive);
      if (result.requiresConfirmation) setConfirmation(result.activePaneIds ?? []);
      else if (!result.ok) setArchiveError(result.error || "Não foi possível arquivar a operação.");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : String(error));
    } finally { setArchiving(false); }
  };
  const cancelArchive = () => { setConfirmation(null); setArchiveError(null); archiveRef.current?.focus(); };

  return (
    <article className="group min-w-0 border-t border-cb-line-1 transition-colors hover:bg-cb-bg-1">
      <button type="button" onClick={onOpen} className="block w-full min-w-0 px-2 py-3 text-left">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${mission.lane === "working" ? "bg-cb-agent-running animate-pulse" : mission.lane === "attention" ? "bg-cb-warn" : mission.lane === "ready" ? "bg-cb-success" : "bg-cb-fg-3"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-base font-medium text-cb-fg-0" title={mission.title}>{mission.title}</h3>
              <ChevronRight size={13} className="shrink-0 text-cb-fg-2 transition-colors group-hover:text-cb-accent" />
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-cb-fg-2" title={mission.workspace}>
              <FolderOpen size={11} className="shrink-0" />
              <span className="truncate">{basename(mission.workspace)}</span>
              {mission.source === "derived" ? <span className="cb-badge text-xs">read model</span> : null}
            </p>
          </div>
        </div>
        {mission.summary ? <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-cb-fg-2">{mission.summary}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-cb-fg-2">
          <span className={`cb-badge ${laneMeta.tone}`}>{laneMeta.label}</span>
          {mission.worktreePath ? <span className="cb-badge max-w-[150px] truncate" title={mission.worktreePath}><GitBranch size={10} />{basename(mission.worktreePath)}</span> : null}
          <span className="cb-badge"><Terminal size={10} />{mission.counts.actors}</span>
          {mission.counts.tasks > 0 ? <span className="cb-badge"><CheckCircle2 size={10} />{mission.counts.tasksDone}/{mission.counts.tasks} tasks</span> : null}
          {mission.counts.messages > 0 ? <span className="cb-badge"><Send size={10} />{mission.counts.messages}</span> : null}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-cb-fg-2">
          {orchestrator ? <span className="truncate text-cb-accent">ORQ · {orchestrator.label || orchestrator.agent || orchestrator.pane_id.slice(0, 8)}</span> : visibleLabels.length > 0 ? <span className="truncate">{visibleLabels.join(" · ")}{actorLabels.length > visibleLabels.length ? ` +${actorLabels.length - visibleLabels.length}` : ""}</span> : <span>sem agentes registrados</span>}
          {mission.counts.running > 0 ? <span className="ml-auto inline-flex items-center gap-1 text-cb-accent"><LoaderCircle size={10} className="animate-spin" />{mission.counts.running} ativo{mission.counts.running === 1 ? "" : "s"}</span> : null}
        </div>
        {latestActivity ? <div className="mt-2 flex items-start gap-1.5 border-t border-cb-line-0 pt-2 text-xs leading-relaxed text-cb-fg-2"><MessageSquare size={10} className="mt-0.5 shrink-0 text-cb-accent" /><span className="line-clamp-2">{activityLabel(latestActivity)}</span></div> : null}
      </button>
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="truncate text-xs text-cb-fg-2">{timeAgo(latestActivity?.at)}</span>
        <div className="flex items-center gap-1">
          <button ref={archiveRef} type="button" disabled={archiving} onClick={() => void archive()} className="cb-btn cb-btn--ghost cb-btn--sm" aria-label={`Arquivar operação ${mission.title}`} title="Arquivar esta operação; preservar terminais, histórico e arquivos"><Archive size={11} />{archiving ? "arquivando…" : "arquivar"}</button>
          <button type="button" onClick={onNewPane} className="cb-btn cb-btn--ghost cb-btn--sm" title="Abrir novo pane neste workspace"><Plus size={11} /> pane</button>
        </div>
      </div>
      {confirmation !== null && <div role="alertdialog" aria-labelledby={confirmationId} className="mx-2 mb-3 border border-cb-warn/40 rounded-cb-1 p-3 text-xs" onKeyDown={(event) => { if (event.key === "Escape" && !archiving) { event.preventDefault(); event.stopPropagation(); cancelArchive(); } }}>
        <h4 id={confirmationId} className="font-medium text-cb-fg-0">Arquivar {mission.title}?</h4>
        <p className="mt-2 break-words text-cb-fg-2">Workspace: {mission.workspace}</p>
        <p className="mt-2 text-cb-warn">{confirmation.length} terminal{confirmation.length === 1 ? " ativo continuará executando" : "is ativos continuarão executando"}.</p>
        <ul className="mt-1 text-cb-fg-2">{confirmation.map((id) => <li key={id} className="break-all">{actors.find((actor) => actor.pane_id === id)?.label || id}</li>)}</ul>
        <p className="mt-2 text-cb-fg-2">Somente esta operação sairá da lista ativa. Histórico, arquivos e terminais serão preservados.</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" disabled={archiving} onClick={cancelArchive} className="cb-btn cb-btn--sm">cancelar</button>
          <button type="button" disabled={archiving} onClick={() => void archive(true)} className="cb-btn cb-btn--sm" aria-label={`Confirmar arquivamento de ${mission.title}`}>{archiving ? "arquivando…" : "confirmar arquivamento"}</button>
        </div>
      </div>}
      {archiveError && <p role="alert" className="px-2 pb-3 text-xs text-cb-danger">{archiveError}</p>}
    </article>
  );
}

export function OperationsBoard({ workspacePaths, onOpenWorkspace, onNewPane, onRefresh }: OperationsBoardProps) {
  const [snapshots, setSnapshots] = React.useState<Record<string, OperationsSnapshot>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const request = React.useRef(0);
  const currentPaths = React.useRef(workspacePaths);
  currentPaths.current = workspacePaths;

  const load = React.useCallback(async (paths: string[]) => {
    const id = ++request.current;
    if (paths.length === 0 || !window.codeBrainApp?.operations?.snapshot) {
      setSnapshots({});
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.allSettled(paths.map(async (workspace) => {
        const snapshot = await window.codeBrainApp.operations.snapshot({ workspace, limit: 100 });
        if (!snapshot?.ok) throw new Error(snapshot?.error || "Falha ao carregar operações");
        return [workspace, snapshot] as const;
      }));
      if (id !== request.current) return;
      const entries = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      setSnapshots(Object.fromEntries(entries));
      setError(results.some((result) => result.status === "rejected") ? "Não foi possível atualizar todas as operações. Tente novamente." : null);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(workspacePaths);
    return () => { ++request.current; };
  }, [load, workspacePaths.join("\u0000")]);
  React.useEffect(() => {
    const off = window.codeBrainApp?.operations?.onUpdated?.(({ workspace }) => {
      if (!workspace || workspacePaths.some((path) => path.toLowerCase() === workspace.toLowerCase())) void load(workspacePaths);
    });
    return off;
  }, [load, workspacePaths.join("\u0000")]);

  const missions = workspacePaths.flatMap((workspace) => {
    const snapshot = snapshots[workspace];
    return (snapshot?.missions || []).map((mission) => ({ mission, snapshot }));
  });
  const lanes = (Object.keys(LANE_META) as OperationsLane[]).map((key) => ({ key, items: missions.filter(({ mission }) => mission.lane === key) }));
  const archiveMission = async (mission: OperationalMission, confirmedActive: boolean): Promise<ArchiveResult> => {
    const api = window.codeBrainApp?.operations as typeof window.codeBrainApp.operations & {
      archive?: (args: { workspace: string; missionId: string; confirmedActive: boolean }) => Promise<ArchiveResult>;
    };
    if (!api?.archive) return { ok: false, error: "Esta instância precisa ser atualizada para arquivar operações." };
    const result = await api.archive({ workspace: mission.workspace, missionId: mission.id, confirmedActive });
    if (result?.ok) {
      // Invalidate snapshots requested before the durable write completed.
      ++request.current;
      setSnapshots((current) => {
        const snapshot = current[mission.workspace];
        return snapshot ? { ...current, [mission.workspace]: { ...snapshot, missions: snapshot.missions.filter((item) => item.id !== mission.id) } } : current;
      });
      void load(currentPaths.current);
    }
    return result ?? { ok: false, error: "Não foi possível arquivar a operação." };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <p className="min-w-0 flex-1 text-sm text-cb-fg-2">
          {missions.length === 1 ? "1 missão" : `${missions.length} missões`}, agrupadas pelo que pedem de você.
          {loading ? <LoaderCircle size={12} className="ml-2 inline animate-spin" /> : null}
        </p>
        <button type="button" onClick={() => { void load(workspacePaths); onRefresh?.(); }} className="cb-btn cb-btn--sm" title="Atualizar operações"><RotateCw size={12} className={loading ? "animate-spin" : ""} /> atualizar</button>
      </div>
      {error ? <p role="alert" className="pb-3 text-sm text-cb-danger">{error}</p> : null}
      <div className="cb-scroll min-h-0 flex-1 overflow-auto">
        {workspacePaths.length === 0 ? <div className="flex min-h-[200px] flex-col items-center justify-center text-center"><p className="text-base text-cb-fg-0">Nenhum workspace aberto</p><p className="mt-1 max-w-xs text-sm leading-relaxed text-cb-fg-2">Abra um workspace para criar uma sessão e acompanhar seus agentes nesta visão.</p></div> : missions.length === 0 ? <div className="flex min-h-[200px] flex-col items-center justify-center text-center"><p className="text-base text-cb-fg-0">{loading ? "Carregando missões…" : "Nenhuma missão ainda"}</p><p className="mt-1 max-w-xs text-sm leading-relaxed text-cb-fg-2">Missões aparecem aqui quando os agentes começam a trabalhar em um workspace.</p></div> : <div className="grid min-w-[720px] grid-cols-4 gap-3">
          {lanes.map(({ key, items }) => { const meta = LANE_META[key]; return <section key={key} className="min-w-0"><header className="mb-2 flex items-start gap-2 px-1">{key === "working" ? <LoaderCircle size={12} className={`${meta.tone} mt-0.5 animate-spin`} /> : key === "attention" ? <AlertTriangle size={12} className={`${meta.tone} mt-0.5`} /> : key === "ready" ? <CheckCircle2 size={12} className={`${meta.tone} mt-0.5`} /> : <Circle size={12} className={`${meta.tone} mt-0.5`} />}<div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className={`truncate text-xs font-medium ${meta.tone}`}>{meta.label}</h3><span className="text-xs text-cb-fg-2">{items.length}</span></div><p className="mt-0.5 truncate text-xs text-cb-fg-2">{meta.description}</p></div></header><div className="space-y-2">{items.map(({ mission, snapshot }) => <MissionCard key={`${mission.workspace}:${mission.id}`} mission={mission} actors={snapshot?.actors || []} latestActivity={mission.latestActivity} onOpen={() => onOpenWorkspace(mission.workspace)} onNewPane={() => onNewPane(mission.workspace)} onArchive={(confirmedActive) => archiveMission(mission, confirmedActive)} />)}{items.length === 0 ? <div className="border-t border-cb-line-0 px-2 py-3 text-xs text-cb-fg-2">vazio</div> : null}</div></section>; })}
        </div>}
      </div>
    </div>
  );
}
