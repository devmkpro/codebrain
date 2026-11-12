import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, FolderOpen, Plus, RefreshCw, X } from 'lucide-react';
import { useRouter } from '../../lib/router';
import { useNavStore }       from '../../stores/nav-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useProvidersStore } from '../../stores/providers-store';
import { useTasksStore }     from '../../stores/tasks-store';
import { usePanesStore }     from '../../stores/panes-store';
import { usePaletteStore }   from '../../stores/palette-store';
import { usePaneLauncherStore } from '../../stores/pane-launcher-store';
import { OperationsBoard } from '../../components/operations/OperationsBoard';
import { OfficeView } from '../../components/office/OfficeView';
import { useWorkspaceRegistry } from '../../components/operations/useWorkspaceRegistry';
import { operationWorkspacePaths } from '../../components/operations/workspace-paths';
import { derivePaneActivity, activityPresentation, type PaneActivity } from '../../components/shell/pane-status';
import { StatusGlyph } from '../../components/shell/pane-status-glyph';
import { CodebrainMark, CodebrainWordmark } from '../../components/ui/AppLogo';
import { Badge, Button, Kbd, Prompt, SectionRule } from '../../components/ui/primitives';

/* ═══════════════════════════════════════════════════════════════════════════
   INÍCIO
   ═══════════════════════════════════════════════════════════════════════════

   A home é o prompt do app. A primeira linha responde "como estão meus
   agentes?"; logo abaixo vem o que precisa de você, depois o que está rodando.
   Workspaces recentes ficam ao lado e, em janela estreita, descem.

   Sem nada aberto e sem histórico, vira a tela de primeiro uso.
   ═══════════════════════════════════════════════════════════════════════════ */

function folderName(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

function normalized(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

const ATTENTION: ReadonlySet<PaneActivity> = new Set<PaneActivity>(['failed', 'waiting', 'blocked']);
const WORKING: ReadonlySet<PaneActivity> = new Set<PaneActivity>(['thinking', 'running']);

function paneTitle(pane: any): string {
  return pane.label || pane.agent || 'shell';
}

// ─── Linhas ───────────────────────────────────────────────────────────────────
function PaneRow({ pane, onClose }: { pane: any; onClose?: (id: string) => void }) {
  const activity: PaneActivity = pane.kind === 'browser' ? 'idle' : derivePaneActivity(pane);
  const state = activityPresentation(activity);
  return (
    <div className="cb-row cb-rail group/pane min-h-cell-lg" style={{ '--cb-rail-color': state.color } as React.CSSProperties}>
      <StatusGlyph activity={activity} />
      <span className="text-base text-cb-fg-0 truncate">{paneTitle(pane)}</span>
      {pane.label && pane.agent && <span className="text-sm text-cb-fg-2 truncate hidden sm:inline">{pane.agent}</span>}
      {pane.model && <span className="text-sm text-cb-fg-2 truncate hidden sm:inline">{pane.model}</span>}
      <span className="ml-auto text-sm shrink-0" style={{ color: activity === 'idle' ? 'var(--cb-fg-2)' : state.color }}>
        {pane.kind === 'browser' ? 'browser' : state.label}
      </span>
      {onClose && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(pane.id); }}
          className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon shrink-0 opacity-0 group-hover/pane:opacity-100 focus-visible:opacity-100"
          title="Fechar pane"
          aria-label={`Fechar ${paneTitle(pane)}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function WorkspaceGroup({ name, path, panes, onGo, onClosePane }: {
  name: string;
  path: string | null;
  panes: any[];
  onGo?: () => void;
  onClosePane: (id: string) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline gap-2 min-h-cell px-2">
        <h3 className="text-sm font-medium text-cb-fg-1 truncate" title={path ?? undefined}>{name}</h3>
        <span className="text-xs text-cb-fg-2 tabular-nums shrink-0">{panes.length}</span>
        {onGo && (
          <button type="button" onClick={onGo} className="ml-auto text-xs text-cb-fg-2 hover:text-cb-accent shrink-0 inline-flex items-center gap-1">
            abrir <ArrowRight size={11} />
          </button>
        )}
      </div>
      {panes.length === 0
        ? <p className="px-2 min-h-cell flex items-center text-sm text-cb-fg-2">nenhum agente neste workspace</p>
        : panes.map((pane) => <PaneRow key={pane.id} pane={pane} onClose={onClosePane} />)}
    </section>
  );
}

function AttentionRow({ pane, workspace, onGo }: { pane: any; workspace: string | null; onGo: () => void }) {
  const activity = derivePaneActivity(pane);
  const state = activityPresentation(activity);
  return (
    <button
      type="button"
      onClick={onGo}
      className="cb-row cb-rail w-full text-left min-h-cell-lg group/att"
      style={{ '--cb-rail-color': state.color } as React.CSSProperties}
    >
      <StatusGlyph activity={activity} />
      <span className="text-base text-cb-fg-0 truncate">{paneTitle(pane)}</span>
      {workspace && <span className="text-sm text-cb-fg-2 truncate">{folderName(workspace)}</span>}
      <span className="ml-auto text-sm shrink-0" style={{ color: state.color }}>{state.label}</span>
      <ArrowRight size={12} className="shrink-0 text-cb-fg-2 group-hover/att:text-cb-accent" />
    </button>
  );
}

function TaskRow({ task }: { task: any }) {
  const label = task.status === 'in_progress' && task.taskNameActive ? task.taskNameActive
    : task.status === 'done' && task.taskNameComplete ? task.taskNameComplete
    : task.name;
  const activity: PaneActivity = task.status === 'done' ? 'done' : task.status === 'in_progress' ? 'running' : 'idle';
  return (
    <div className="cb-row min-h-cell-lg">
      <StatusGlyph activity={activity} />
      <span className={`text-base truncate ${task.status === 'done' ? 'text-cb-fg-2 line-through' : task.status === 'in_progress' ? 'text-cb-fg-0' : 'text-cb-fg-1'}`}>{label}</span>
    </div>
  );
}

function RecentRow({ path, agents, onOpen }: { path: string; agents: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="cb-row w-full text-left py-1.5 group/rec">
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-base text-cb-fg-0 truncate">{folderName(path)}</span>
          {agents > 0 && <span className="text-xs text-cb-fg-2 tabular-nums shrink-0">{plural(agents, 'agente', 'agentes')}</span>}
        </span>
        <span className="block text-xs text-cb-fg-2 truncate" title={path}>{path}</span>
      </span>
      <span className="text-cb-accent opacity-0 group-hover/rec:opacity-100 group-focus-visible/rec:opacity-100 shrink-0" aria-hidden>❯</span>
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-6 text-center text-sm text-cb-fg-2">{children}</p>;
}

// ─── Primeiro uso ─────────────────────────────────────────────────────────────
function FirstRun({ launching, onOpen, onPalette, onProviders }: {
  launching: boolean;
  onOpen: () => void;
  onPalette: () => void;
  onProviders: () => void;
}) {
  return (
    <div className="cb-scroll flex-1 min-h-0 bg-cb-bg-0">
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="w-full max-w-[560px]">
          <div className="flex items-center gap-3">
            <CodebrainMark size={40} />
            <CodebrainWordmark className="text-xl" />
          </div>

          <h1 className="mt-7 text-xl font-bold text-cb-fg-0 leading-snug">
            <Prompt waiting>abra um projeto para começar</Prompt>
          </h1>
          <p className="mt-2 text-base text-cb-fg-1 leading-relaxed">
            Vários agentes de IA trabalhando lado a lado, cada um no seu terminal, todos à vista.
          </p>

          <ol className="cb-steps mt-6">
            <li><span className="cb-steps__n">01</span><span>abra uma pasta <span className="text-cb-fg-2">vira um workspace</span></span></li>
            <li><span className="cb-steps__n">02</span><span>inicie um agente <span className="text-cb-fg-2">Claude, Codex, Gemini…</span></span></li>
            <li><span className="cb-steps__n">03</span><span>acompanhe por aqui <span className="text-cb-fg-2">o que roda, o que precisa de você</span></span></li>
          </ol>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" onClick={onOpen} disabled={launching}>
              <FolderOpen size={14} />
              {launching ? 'abrindo…' : 'abrir workspace'}
            </Button>
            <Button variant="secondary" size="lg" onClick={onProviders}>configurar providers</Button>
            <button type="button" onClick={onPalette} className="inline-flex items-center gap-2 text-sm text-cb-fg-2 hover:text-cb-fg-0">
              <Kbd keys={['Ctrl', 'K']} /> buscar qualquer ação
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
type HomeView = 'office' | 'panes' | 'board' | 'tasks';

export function DashboardPage() {
  const { navigate } = useRouter();
  const { recents, loaded: recentsLoaded, refresh: refreshWorkspaces } = useWorkspaceRegistry();
  const [launching,     setLaunching]     = useState(false);
  const [activeView,    setView]          = useState<HomeView>('office');

  const openWorkspace    = useNavStore(s => s.openWorkspace);
  const setWorkspacePath = useWorkspaceStore(s => s.setPath);
  const activeWorkspacePath = useWorkspaceStore((s: any) => s.path) as string | null;
  const providers        = useProvidersStore(s => s.providers) as any[];
  const loadProviders    = useProvidersStore(s => s.load);
  const tasks            = useTasksStore(s => s.list) as any[];
  const loadTasks        = useTasksStore(s => s.load);
  const panes            = usePanesStore(s => s.panes) as any[];
  const openPalette      = usePaletteStore(s => s.openPalette);

  useEffect(() => {
    loadProviders().catch(() => {});
    loadTasks().catch(() => {});
  }, []);

  const handleClosePane = useCallback((id: string) => {
    (window as any).codeBrainApp?.pty?.kill?.(id)?.catch?.(() => {});
    usePanesStore.getState().removePane(id);
  }, []);

  const handleCloseAll = useCallback(() => {
    const current = usePanesStore.getState().panes;
    for (const p of current) {
      (window as any).codeBrainApp?.pty?.kill?.(p.id)?.catch?.(() => {});
    }
    usePanesStore.setState({ panes: [], activePaneId: null, layouts: {} });
  }, []);

  const activateWorkspace = useCallback(async (path: string) => {
    setWorkspacePath(path);
    try { await (window as any).codeBrainApp?.workspaces?.touch?.(path); } catch {}
    openWorkspace(path);
  }, [openWorkspace, setWorkspacePath]);

  const handleOpen = useCallback(async (path?: string) => {
    if (launching) return;
    const selected = path ?? await (window as any).codeBrainApp?.workspace?.open?.();
    if (!selected) return;
    setLaunching(true);
    try { await activateWorkspace(selected); } finally { setLaunching(false); }
  }, [activateWorkspace, launching]);

  const handleNewPane = useCallback(async (path: string) => {
    await activateWorkspace(path);
    window.setTimeout(() => {
      usePaneLauncherStore.getState().show({
        title: 'Nova sessão',
        subtitle: 'Escolha o provider e depois um modelo compatível',
      });
    }, 0);
  }, [activateWorkspace]);

  const openSettings = useCallback((section: string) => {
    try { localStorage.setItem('codebrain.settings.openSection', section); } catch {}
    navigate('/settings');
  }, [navigate]);

  // Auto-detect: only switch to existing tab, never spawn PTY
  const hasAutoOpenedRef = React.useRef(false);
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    hasAutoOpenedRef.current = true;
    const timer = setTimeout(() => {
      (window as any).codeBrainApp?.workspace?.detect?.()
        .then((result: { path: string; autoDetected: boolean } | null) => {
          if (!result?.path) return;
          // Only switch to tab if it already exists — never auto-spawn PTY
          const existingIdx = useNavStore.getState().tabs.findIndex((t: any) => t.workspacePath === result.path);
          if (existingIdx >= 0) {
            useNavStore.getState().setActiveTab(existingIdx);
          }
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const tabs         = useNavStore(s => s.tabs) as any[];
  const setActiveTab = useNavStore(s => s.setActiveTab);
  const pendingTasks = tasks.filter((t: any) => t.status !== 'done');
  const boardWorkspaces = operationWorkspacePaths(recents,
    tabs.some((tab) => activeWorkspacePath && normalized(tab.workspacePath) === normalized(activeWorkspacePath))
      ? activeWorkspacePath : null);

  const belongsToTab = (pane: any, tab: any) =>
    pane.workspacePath === tab.workspacePath ||
    (pane.cwd && tab.workspacePath && pane.cwd.startsWith(tab.workspacePath));

  const paneWorkspace = (pane: any): string | null => {
    const tab = tabs.find((t: any) => belongsToTab(pane, t));
    return tab?.workspacePath ?? pane.workspacePath ?? pane.cwd ?? null;
  };

  const goToWorkspace = (path: string | null) => {
    if (!path) return;
    const index = tabs.findIndex((t: any) => normalized(t.workspacePath) === normalized(path));
    if (index >= 0) setActiveTab(index);
    else void handleOpen(path);
  };

  // Abas abertas primeiro, mesmo sem agentes; depois os panes de outras pastas.
  const groups: { key: string; name: string; path: string | null; panes: any[] }[] = tabs.map((tab: any) => ({
    key: normalized(tab.workspacePath),
    name: folderName(tab.workspacePath),
    path: tab.workspacePath,
    panes: [],
  }));
  for (const pane of panes) {
    const path = paneWorkspace(pane);
    const key = path ? normalized(path) : '';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, name: path ? folderName(path) : 'sem workspace', path, panes: [] };
      groups.push(group);
    }
    group.panes.push(pane);
  }

  const activities = panes.map((pane) => (pane.kind === 'browser' ? 'idle' : derivePaneActivity(pane)) as PaneActivity);
  const attention = panes.filter((_, i) => ATTENTION.has(activities[i]));
  const working = activities.filter((a) => WORKING.has(a)).length;
  const agentsIn = (path: string) => panes.filter((p) => { const w = paneWorkspace(p); return w && normalized(w) === normalized(path); }).length;

  if (recentsLoaded && recents.length === 0 && panes.length === 0 && tabs.length === 0) {
    return (
      <FirstRun
        launching={launching}
        onOpen={() => void handleOpen()}
        onPalette={openPalette}
        onProviders={() => {
          try { localStorage.setItem('codebrain.settings.openSection', 'providers'); } catch {}
          navigate('/settings');
        }}
      />
    );
  }

  const headline = attention.length > 0
    ? `${plural(attention.length, 'agente precisa', 'agentes precisam')} de você`
    : working > 0
      ? `${plural(working, 'agente', 'agentes')} em ação`
      : panes.length > 0
        ? 'tudo calmo. o que vem agora?'
        : 'o que vamos construir?';

  const workspaceCount = new Set(panes.map((p) => { const w = paneWorkspace(p); return w ? normalized(w) : ''; })).size;
  const summary = [
    panes.length === 0 ? 'nenhum agente aberto' : `${plural(panes.length, 'agente', 'agentes')} em ${plural(workspaceCount, 'workspace', 'workspaces')}`,
    pendingTasks.length > 0 ? plural(pendingTasks.length, 'task pendente', 'tasks pendentes') : null,
    providers.length === 0 ? 'nenhum provider' : plural(providers.length, 'provider', 'providers'),
  ].filter(Boolean).join(' · ');

  const VIEWS: { id: HomeView; label: string; count: number }[] = [
    { id: 'office', label: 'escritório', count: workspaceCount },
    { id: 'panes', label: 'agentes', count: panes.length },
    { id: 'board', label: 'operações', count: boardWorkspaces.length },
    { id: 'tasks', label: 'tasks', count: tasks.length },
  ];

  return (
    <div className="cb-scroll flex-1 min-h-0 bg-cb-bg-0 @container">
      <div className="mx-auto max-w-[1280px] px-5 @3xl:px-7 py-5 @3xl:py-6 flex flex-col gap-5">

        {/* Prompt */}
        <header className="flex flex-wrap items-start justify-between gap-x-7 gap-y-3">
          <div className="min-w-0 flex-[1_1_320px]">
            <h1 className="text-xl font-bold text-cb-fg-0 leading-snug">
              <Prompt waiting>{headline}</Prompt>
            </h1>
            <p className="mt-1 text-sm text-cb-fg-2">{summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={openPalette}>
              buscar ações <Kbd keys={['Ctrl', 'K']} />
            </Button>
            <Button variant="primary" size="lg" onClick={() => void handleOpen()} disabled={launching}>
              <FolderOpen size={14} />
              {launching ? 'abrindo…' : 'abrir workspace'}
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 @4xl:grid-cols-[minmax(0,1fr)_300px] gap-x-8 gap-y-6 items-start">
          {/* Coluna principal */}
          <div className="min-w-0 flex flex-col gap-5">
            {attention.length > 0 && (
              <section>
                <SectionRule label="precisa de você" count={attention.length} tone="text-cb-warn" />
                <div className="mt-1">
                  {attention.map((pane) => (
                    <AttentionRow key={pane.id} pane={pane} workspace={paneWorkspace(pane)} onGo={() => goToWorkspace(paneWorkspace(pane))} />
                  ))}
                </div>
              </section>
            )}

            <section className="min-w-0">
              <div className="flex items-end justify-between gap-3 cb-tabs">
                <div role="tablist" aria-label="Visões do início" className="flex gap-5 min-w-0">
                  {VIEWS.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      role="tab"
                      aria-selected={activeView === view.id}
                      onClick={() => setView(view.id)}
                      className="cb-tab"
                    >
                      {view.label}
                      <span className="text-xs text-cb-fg-2 tabular-nums">{view.count}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 pb-1 shrink-0">
                  <button type="button" onClick={() => loadTasks().catch(() => {})} className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon" title="Atualizar tasks" aria-label="Atualizar tasks">
                    <RefreshCw size={12} />
                  </button>
                  {panes.length > 0 && (
                    <button type="button" onClick={handleCloseAll} className="cb-btn cb-btn--ghost cb-btn--sm hover:!text-cb-danger" title="Fechar todos os panes">
                      <X size={12} /> fechar tudo
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3">
                {activeView === 'office' ? (
                  panes.length === 0
                    ? <Note>Nenhum agente aberto. Abra um workspace e inicie o primeiro: ele aparece aqui, numa sala com o nome do projeto.</Note>
                    : (
                      <OfficeView
                        className="w-full rounded-cb-1 border border-cb-line-1"
                        style={{ height: 'min(68vh, 640px)', minHeight: 360 }}
                        onFocusPane={(paneId) => {
                          const pane = panes.find((p: any) => p.id === paneId);
                          if (!pane) return;
                          goToWorkspace(paneWorkspace(pane));
                          usePanesStore.getState().setActive(paneId);
                        }}
                      />
                    )
                ) : activeView === 'board' ? (
                  <OperationsBoard
                    workspacePaths={boardWorkspaces}
                    onOpenWorkspace={(path) => void activateWorkspace(path)}
                    onNewPane={(path) => void handleNewPane(path)}
                    onRefresh={() => { void refreshWorkspaces(); void loadTasks(); void loadProviders(); }}
                  />
                ) : activeView === 'panes' ? (
                  groups.length === 0
                    ? <Note>Nenhum agente aberto. Abra um workspace e inicie o primeiro.</Note>
                    : (
                      <div className="flex flex-col gap-3">
                        {groups.map((group) => (
                          <WorkspaceGroup
                            key={group.key || 'none'}
                            name={group.name}
                            path={group.path}
                            panes={group.panes}
                            onGo={group.path ? () => goToWorkspace(group.path) : undefined}
                            onClosePane={handleClosePane}
                          />
                        ))}
                      </div>
                    )
                ) : tasks.length === 0
                  ? <Note>Nenhuma task. Os agentes criam tasks pela ferramenta todo_manager.</Note>
                  : tasks.map((t: any, i: number) => <TaskRow key={t.id ?? i} task={t} />)}
              </div>
            </section>
          </div>

          {/* Coluna lateral */}
          <div className="min-w-0 flex flex-col gap-5">
            <section>
              <SectionRule label="recentes" count={recents.length} />
              <div className="mt-1">
                {recents.length === 0
                  ? <p className="px-2 py-2 text-sm text-cb-fg-2">Os projetos que você abrir aparecem aqui.</p>
                  : recents.map((path) => <RecentRow key={path} path={path} agents={agentsIn(path)} onOpen={() => void handleOpen(path)} />)}
                {recents.length > 0 && (
                  <button type="button" onClick={() => void handleOpen()} className="cb-row w-full text-left text-sm text-cb-fg-2 min-h-cell-lg">
                    <Plus size={12} /> outro workspace
                  </button>
                )}
              </div>
            </section>

            <section>
              <SectionRule label="atalhos" />
              <div className="mt-1">
                {([
                  { section: 'marketplace', label: 'Marketplace', badge: 'novo' },
                  { section: 'skill',       label: 'Skill & CLI', badge: null },
                  { section: 'providers',   label: 'Providers',   badge: null },
                  { section: 'discord',     label: 'Discord RPC', badge: null },
                ] as const).map(({ section, label, badge }) => (
                  <button key={section} type="button" onClick={() => openSettings(section)} className="cb-row w-full text-left text-sm min-h-cell-lg">
                    <span className="flex-1 min-w-0 truncate">{label}</span>
                    {badge && <Badge tone="accent">{badge}</Badge>}
                  </button>
                ))}
                <button type="button" onClick={() => navigate('/workspaces')} className="cb-row w-full text-left text-sm min-h-cell-lg">Ver workspaces</button>
                <button type="button" onClick={() => navigate('/settings')} className="cb-row w-full text-left text-sm min-h-cell-lg">Configurações</button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
