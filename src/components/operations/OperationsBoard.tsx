import React from "react";
import {
  AlertTriangle,
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

const LANE_META: Record<OperationsLane, { label: string; description: string; tone: string }> = {
  working: { label: "Em execução", description: "agentes trabalhando agora", tone: "text-cb-accent" },
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
}: {
  mission: OperationalMission;
  actors: OperationalActor[];
  latestActivity?: OperationalActivity;
  onOpen: () => void;
  onNewPane: () => void;
}) {
  const laneMeta = LANE_META[mission.lane];
  const missionActors = actors.filter((actor) => mission.actorIds.includes(actor.pane_id));
  const actorLabels = missionActors.map((actor) => actor.label || actor.agent || actor.pane_id.slice(0, 8)).filter(Boolean);
  const visibleLabels = actorLabels.slice(0, 3);
  const orchestrator = mission.orchestratorId ? actors.find((actor) => actor.pane_id === mission.orchestratorId) : undefined;

  return (
    <article className="group min-w-0 rounded-cb-1 border border-cb-line-1 bg-cb-bg-1 transition-colors hover:border-cb-line-2">
      <button type="button" onClick={onOpen} className="block w-full min-w-0 p-3 text-left">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${mission.lane === "working" ? "bg-cb-accent animate-pulse" : mission.lane === "attention" ? "bg-cb-warn" : mission.lane === "ready" ? "bg-cb-success" : "bg-cb-fg-3"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-cb-fg-0" title={mission.title}>{mission.title}</h3>
              <ChevronRight size={13} className="shrink-0 text-cb-fg-3 transition-colors group-hover:text-cb-accent" />
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-2xs text-cb-fg-3" title={mission.workspace}>
              <FolderOpen size={11} className="shrink-0" />
              <span className="truncate">{basename(mission.workspace)}</span>
              {mission.source === "derived" ? <span className="rounded border border-cb-line-1 px-1 text-[9px]">read model</span> : null}
            </p>
          </div>
        </div>
        {mission.summary ? <p className="mt-3 line-clamp-2 text-2xs leading-relaxed text-cb-fg-2">{mission.summary}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-2xs text-cb-fg-3">
          <span className={`rounded border border-cb-line-1 px-1.5 py-0.5 ${laneMeta.tone}`}>{laneMeta.label}</span>
          {mission.worktreePath ? <span className="inline-flex max-w-[150px] items-center gap-1 truncate rounded border border-cb-line-1 px-1.5 py-0.5" title={mission.worktreePath}><GitBranch size={10} />{basename(mission.worktreePath)}</span> : null}
          <span className="inline-flex items-center gap-1 rounded border border-cb-line-1 px-1.5 py-0.5"><Terminal size={10} />{mission.counts.actors}</span>
          {mission.counts.tasks > 0 ? <span className="inline-flex items-center gap-1 rounded border border-cb-line-1 px-1.5 py-0.5"><CheckCircle2 size={10} />{mission.counts.tasksDone}/{mission.counts.tasks} tasks</span> : null}
          {mission.counts.messages > 0 ? <span className="inline-flex items-center gap-1 rounded border border-cb-line-1 px-1.5 py-0.5"><Send size={10} />{mission.counts.messages}</span> : null}
        </div>
        <div className="mt-3 flex items-center gap-2 text-2xs text-cb-fg-3">
          {orchestrator ? <span className="truncate text-cb-accent">ORQ · {orchestrator.label || orchestrator.agent || orchestrator.pane_id.slice(0, 8)}</span> : visibleLabels.length > 0 ? <span className="truncate">{visibleLabels.join(" · ")}{actorLabels.length > visibleLabels.length ? ` +${actorLabels.length - visibleLabels.length}` : ""}</span> : <span>sem agentes registrados</span>}
          {mission.counts.running > 0 ? <span className="ml-auto inline-flex items-center gap-1 text-cb-accent"><LoaderCircle size={10} className="animate-spin" />{mission.counts.running} ativo{mission.counts.running === 1 ? "" : "s"}</span> : null}
        </div>
        {latestActivity ? <div className="mt-2 flex items-start gap-1.5 border-t border-cb-line-0 pt-2 text-[10px] leading-relaxed text-cb-fg-3"><MessageSquare size={10} className="mt-0.5 shrink-0 text-cb-accent" /><span className="line-clamp-2">{activityLabel(latestActivity)}</span></div> : null}
      </button>
      <div className="flex items-center justify-between border-t border-cb-line-0 px-3 py-2">
        <span className="truncate text-2xs text-cb-fg-3">{timeAgo(latestActivity?.at)}</span>
        <button type="button" onClick={onNewPane} className="inline-flex items-center gap-1 rounded-cb-1 px-1.5 py-1 text-2xs text-cb-fg-2 transition-colors hover:bg-cb-bg-2 hover:text-cb-accent" title="Abrir novo pane neste workspace"><Plus size={11} /> pane</button>
      </div>
    </article>
  );
}

export function OperationsBoard({ workspacePaths, onOpenWorkspace, onNewPane, onRefresh }: OperationsBoardProps) {
  const [snapshots, setSnapshots] = React.useState<Record<string, OperationsSnapshot>>({});
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (paths: string[]) => {
    if (paths.length === 0 || !window.codeBrainApp?.operations?.snapshot) {
      setSnapshots({});
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(paths.map(async (workspace) => {
        const snapshot = await window.codeBrainApp.operations.snapshot({ workspace, limit: 100 });
        return [workspace, snapshot] as const;
      }));
      setSnapshots(Object.fromEntries(results));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(workspacePaths); }, [load, workspacePaths.join("\u0000")]);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-cb-bg-0">
      <div className="flex shrink-0 items-center gap-3 border-b border-cb-line-0 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><MessageSquare size={14} className="text-cb-accent" /><h2 className="text-sm font-medium text-cb-fg-0">Operações</h2><span className="rounded border border-cb-line-1 px-1.5 py-0.5 text-2xs text-cb-fg-3">{missions.length} missões</span>{loading ? <LoaderCircle size={12} className="animate-spin text-cb-fg-3" /> : null}</div>
          <p className="mt-1 text-2xs text-cb-fg-3">Read model do backend: panes, atores, tasks, handoffs e comunicação em tempo real.</p>
        </div>
        <button type="button" onClick={() => { void load(workspacePaths); onRefresh?.(); }} className="inline-flex items-center gap-1.5 rounded-cb-1 border border-cb-line-1 px-2.5 py-1.5 text-2xs text-cb-fg-2 transition-colors hover:border-cb-accent/50 hover:text-cb-accent" title="Atualizar operações"><RotateCw size={12} className={loading ? "animate-spin" : ""} /> atualizar</button>
      </div>
      <div className="cb-scroll min-h-0 flex-1 overflow-auto p-4">
        {workspacePaths.length === 0 ? <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center"><FolderOpen size={24} className="text-cb-fg-3" /><p className="mt-3 text-sm text-cb-fg-1">Nenhum workspace aberto</p><p className="mt-1 max-w-xs text-2xs leading-relaxed text-cb-fg-3">Abra um workspace para criar uma sessão e acompanhar seus agentes nesta visão.</p></div> : missions.length === 0 ? <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center"><Circle size={24} className="text-cb-fg-3" /><p className="mt-3 text-sm text-cb-fg-1">Carregando o read model operacional</p><p className="mt-1 max-w-xs text-2xs leading-relaxed text-cb-fg-3">Aguardando o backend sincronizar panes, agentes e comunicação.</p></div> : <div className="grid min-w-[720px] grid-cols-4 gap-3">
          {lanes.map(({ key, items }) => { const meta = LANE_META[key]; return <section key={key} className="min-w-0"><header className="mb-2 flex items-start gap-2 px-1">{key === "working" ? <LoaderCircle size={12} className={`${meta.tone} mt-0.5 animate-spin`} /> : key === "attention" ? <AlertTriangle size={12} className={`${meta.tone} mt-0.5`} /> : key === "ready" ? <CheckCircle2 size={12} className={`${meta.tone} mt-0.5`} /> : <Circle size={12} className={`${meta.tone} mt-0.5`} />}<div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className={`truncate text-2xs font-medium ${meta.tone}`}>{meta.label}</h3><span className="text-2xs text-cb-fg-3">{items.length}</span></div><p className="mt-0.5 truncate text-[10px] text-cb-fg-3">{meta.description}</p></div></header><div className="space-y-2">{items.map(({ mission, snapshot }) => <MissionCard key={`${mission.workspace}:${mission.id}`} mission={mission} actors={snapshot?.actors || []} latestActivity={mission.latestActivity} onOpen={() => onOpenWorkspace(mission.workspace)} onNewPane={() => onNewPane(mission.workspace)} />)}{items.length === 0 ? <div className="rounded-cb-1 border border-dashed border-cb-line-1 px-3 py-5 text-center text-2xs text-cb-fg-3">vazio</div> : null}</div></section>; })}
        </div>}
      </div>
    </div>
  );
}
