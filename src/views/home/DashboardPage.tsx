import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FolderOpen, Terminal, Zap, Bot, ChevronRight,
  RefreshCw, Plus, Activity, Circle, Server, X,
  Store, Download, Gamepad2, Sparkles,
} from 'lucide-react';
import { Link, useRouter } from '../../lib/router';
import { useNavStore }       from '../../stores/nav-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useProvidersStore } from '../../stores/providers-store';
import { useTasksStore }     from '../../stores/tasks-store';
import { usePanesStore }     from '../../stores/panes-store';
import { usePaneLauncherStore } from '../../stores/pane-launcher-store';
import { OperationsBoard } from '../../components/operations/OperationsBoard';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(ts: number): string {
  const d = Math.max(0, Date.now() - ts);
  const m = Math.floor(d / 60000);
  if (m < 1)  return 'agora';
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function folderName(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color = '#5855e5' }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-4 rounded-cb-1 border border-cb-line-1 bg-cb-bg-1 flex flex-col gap-2 hover:border-cb-line-2 hover:bg-cb-bg-2 transition-all group cursor-default">
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-widest text-cb-fg-3">{label}</span>
      </div>
      <p className="text-2xl font-bold text-cb-fg-0 font-mono group-hover:scale-105 transition-transform origin-left">{value}</p>
      {sub && <p className="text-[9px] text-cb-fg-3">{sub}</p>}
    </div>
  );
}

function PaneRow({ pane, onClose }: { pane: any; onClose?: (id: string) => void }) {
  const isRun = pane.status === 'running';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-cb-1 border border-cb-line-1 bg-cb-bg-1 hover:border-cb-line-2 hover:bg-cb-bg-2 transition-all group/pane">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRun ? 'bg-cb-success animate-pulse' : pane.kind === 'browser' ? 'bg-cb-accent' : 'bg-cb-fg-3'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-cb-fg-1 truncate">
          {pane.agent ?? 'shell'}{pane.model ? ` · ${pane.model}` : ''}
        </p>
      </div>
      <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full shrink-0 ${
        isRun ? 'bg-cb-success-wash text-cb-success border border-cb-success/30' : pane.kind === 'browser' ? 'bg-cb-accent-wash text-cb-accent' : 'bg-cb-bg-2 text-cb-fg-3'
      }`}>
        {pane.kind === 'browser' ? 'browser' : pane.status ?? 'idle'}
      </span>
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(pane.id); }}
          className="opacity-0 group-hover/pane:opacity-100 w-5 h-5 rounded-cb-1 flex items-center justify-center text-cb-fg-3 hover:text-cb-danger hover:bg-cb-danger-wash transition-all shrink-0"
          title="Fechar pane"
        >
          <X size={10} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function WorkspaceGroup({ tab, panes, onSwitch, onClosePane }: { tab: any; panes: any[]; onSwitch: () => void; onClosePane?: (id: string) => void }) {
  const name    = folderName(tab.workspacePath);
  const running = panes.filter(p => p.status === 'running').length;
  const [open,  setOpen] = useState(true);
  return (
    <div className="rounded-cb-1 border border-cb-line-1 bg-cb-bg-1 overflow-hidden mb-3 hover:border-cb-line-2 transition-all">
      <div
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-cb-bg-2 transition-all cursor-pointer"
      >
          <div className="w-7 h-7 rounded-cb-1 bg-cb-accent-wash border border-cb-accent-dim flex items-center justify-center shrink-0">
          <Server size={12} className="text-cb-accent" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[11px] font-bold text-cb-fg-1 truncate">{name}</p>
          <p className="text-[9px] font-mono text-cb-fg-3 truncate">{tab.workspacePath}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${running > 0 ? 'text-cb-success bg-cb-success-wash border border-cb-success/30' : 'text-cb-fg-3 bg-cb-bg-2'}`}>
            {panes.length} pane{panes.length !== 1 ? 's' : ''}{running > 0 ? ` · ${running} ativo${running !== 1 ? 's' : ''}` : ''}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onSwitch(); }}
            className="text-[9px] font-mono text-cb-accent bg-cb-accent-wash border border-cb-accent-dim px-2 py-0.5 rounded-cb-1 hover:bg-cb-accent-wash-strong transition-all uppercase tracking-widest"
          >
            ir →
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-cb-line-0 px-3 pb-2 pt-1.5 space-y-1">
          {panes.length === 0 ? (
            <p className="text-[9px] font-mono text-cb-fg-3 py-1">Sem panes ativos</p>
          ) : (
            panes.map(p => <PaneRow key={p.id} pane={p} onClose={onClosePane} />)
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: any }) {
  const label = task.status === 'in_progress' && task.taskNameActive ? task.taskNameActive
    : task.status === 'done' && task.taskNameComplete ? task.taskNameComplete
    : task.name;
  return (
      <div className={`flex items-start gap-2.5 p-3 rounded-cb-1 border transition-all ${
      task.status === 'in_progress' ? 'border-cb-accent-dim bg-cb-accent-wash'
      : task.status === 'done'      ? 'border-cb-line-0 opacity-60'
      : 'border-cb-line-1 bg-cb-bg-1 hover:border-cb-line-2'
    }`}>
      {task.status === 'done'
        ? <Activity size={11} className="text-cb-success shrink-0 mt-0.5" />
        : task.status === 'in_progress'
        ? <RefreshCw size={11} className="text-cb-accent animate-spin shrink-0 mt-0.5" />
        : <Circle size={11} className="text-cb-fg-3 shrink-0 mt-0.5" />}
      <p className={`text-[10px] font-mono leading-snug ${
        task.status === 'done' ? 'text-cb-fg-3 line-through'
        : task.status === 'in_progress' ? 'text-cb-fg-0'
        : 'text-cb-fg-2'
      }`}>{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { navigate } = useRouter();
  const [recents,    setRecents]   = useState<string[]>([]);
  const [launching,  setLaunching] = useState(false);
  const [activeView, setView]      = useState<'board' | 'panes' | 'tasks'>('board');

  const openWorkspace    = useNavStore(s => s.openWorkspace);
  const setWorkspacePath = useWorkspaceStore(s => s.setPath);
  const providers        = useProvidersStore(s => s.providers) as any[];
  const loadProviders    = useProvidersStore(s => s.load);
  const tasks            = useTasksStore(s => s.list) as any[];
  const loadTasks        = useTasksStore(s => s.load);
  const panes            = usePanesStore(s => s.panes) as any[];

  useEffect(() => {
    (window as any).codeBrainApp?.workspaces?.recent?.()
      .then((d: string[]) => { if (d) setRecents(d); })
      .catch(() => {});
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
  const activePanes  = panes.filter(p => p.status === 'running');
  const pendingTasks = tasks.filter((t: any) => t.status !== 'done');
  const boardWorkspaces = Array.from(new Set([
    ...tabs.map((tab: any) => tab.workspacePath).filter(Boolean),
    ...recents,
  ]));

  // Group panes by workspace
  // Track which panes have already been assigned to a workspace
  const assignedPaneIds = new Set<string>();

  // First pass: mark panes that will be assigned to tabs
  for (const tab of tabs) {
    for (const p of panes) {
      if (p.workspacePath === tab.workspacePath ||
          (p.cwd && tab.workspacePath && p.cwd.startsWith(tab.workspacePath))) {
        assignedPaneIds.add(p.id);
      }
    }
  }

  const orphanPanes = (panes as any[]).filter(p => !assignedPaneIds.has(p.id));

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <aside className="w-72 border-r border-cb-line-0 hidden md:flex flex-col overflow-hidden cb-sidebar bg-cb-bg-1">
        {/* CTA */}
        <div className="p-5 border-b border-cb-line-0">
          <button
            onClick={() => handleOpen()}
            disabled={launching}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-cb-1 bg-cb-accent text-cb-on-accent text-[11px] font-bold uppercase tracking-widest hover:bg-cb-accent-bright disabled:opacity-60 disabled:cursor-wait transition-all"
          >
            <FolderOpen size={14} />
            {launching ? 'Iniciando…' : 'Abrir Workspace'}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-cb-line-0">
          <StatCard icon={<Terminal size={13} />}  label="Panes"      value={panes.length}     sub={`${activePanes.length} ativos`} />
          <StatCard icon={<Zap size={13} />}        label="Tasks"      value={tasks.length}     sub={`${pendingTasks.length} pendentes`} color="#F59E0B" />
          <StatCard icon={<Bot size={13} />}         label="Providers"  value={providers.length} color="#06B6D4" />
          <StatCard icon={<FolderOpen size={13} />} label="Recentes"   value={recents.length}   color="#10B981" />
        </div>

        {/* Features recentes — quick access to Settings sections */}
        <div className="p-4 space-y-1">
          <p className="text-[9px] font-mono text-cb-fg-3 uppercase tracking-widest mb-1.5 px-1">Acesso rápido</p>
          {([
            { section: 'marketplace', label: 'Marketplace', icon: <Store size={11} />, badge: 'Novo' },
            { section: 'skill',       label: 'Skill & CLI', icon: <Download size={11} />, badge: null },
            { section: 'discord',     label: 'Discord RPC', icon: <Gamepad2 size={11} />, badge: null },
            { section: 'providers',   label: 'Providers',   icon: <Zap size={11} />, badge: null },
          ] as const).map(({ section, label, icon, badge }) => (
            <button key={section}
              onClick={() => {
                try { localStorage.setItem('codebrain.settings.openSection', section); } catch {}
                navigate('/settings');
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-cb-1 border border-transparent hover:border-cb-line-1 hover:bg-cb-bg-2 transition-all group text-left"
            >
              <div className="flex items-center gap-2 text-cb-fg-3 group-hover:text-cb-fg-1">
                {icon}
                <span className="text-[10px] font-medium">{label}</span>
              </div>
              {badge ? (
                <span className="px-1.5 py-0.5 rounded bg-cb-accent-wash text-[8px] font-bold text-cb-accent border border-cb-accent-dim">{badge}</span>
              ) : (
                <ChevronRight size={10} className="text-cb-fg-3 group-hover:text-cb-fg-2 transition-colors" />
              )}
            </button>
          ))}
        </div>

        {/* Navigation links */}
        <div className="p-4 space-y-1.5 border-t border-cb-line-0">
          {([
            { href: '/workspaces' as const, label: 'Ver Workspaces', icon: <FolderOpen size={12} /> },
            { href: '/settings'   as const, label: 'Configurações',   icon: <Zap size={12} /> },
          ]).map(({ href, label, icon }) => (
            <Link key={href} href={href}
              className="flex items-center justify-between p-3 rounded-cb-1 border border-cb-line-1 hover:border-cb-accent-dim hover:bg-cb-accent-wash transition-all group"
            >
              <div className="flex items-center gap-2 text-cb-fg-3 group-hover:text-cb-fg-1">{icon}<span className="text-[10px] font-medium">{label}</span></div>
              <ChevronRight size={12} className="text-cb-fg-3 group-hover:text-cb-accent transition-colors" />
            </Link>
          ))}
        </div>
      </aside>

      {/* ── Center ───────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col bg-cb-bg-0 overflow-hidden">
        {/* Sub-nav */}
        <div className="h-10 border-b border-cb-line-0 flex items-center px-6 justify-between bg-cb-bg-1/50 shrink-0 backdrop-blur-sm">
          <div className="flex h-7 bg-cb-bg-2 rounded-cb-1 p-0.5 border border-cb-line-1">
            {(['board', 'panes', 'tasks'] as const).map(t => (
              <button key={t} onClick={() => setView(t)}
                className={`px-3 text-[10px] font-bold uppercase tracking-tight rounded-cb-1 transition-all ${activeView === t ? 'bg-cb-bg-3 text-cb-fg-0' : 'text-cb-fg-3 hover:text-cb-fg-1'}`}
              >
                {t === 'board' ? `Operações (${boardWorkspaces.length})` : t === 'panes' ? `Panes (${panes.length})` : `Tasks (${tasks.length})`}
              </button>
            ))}
          </div>
          <button onClick={() => loadTasks().catch(() => {})} className="p-1.5 rounded-cb-1 text-cb-fg-3 hover:text-cb-fg-1 hover:bg-cb-bg-2 transition-all">
            <RefreshCw size={12} />
          </button>
          {panes.length > 0 && (
            <button
              onClick={handleCloseAll}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-cb-1 text-[9px] font-mono font-bold uppercase tracking-wider text-cb-fg-3 hover:text-cb-danger hover:bg-cb-danger-wash border border-transparent hover:border-cb-danger/30 transition-all"
              title="Fechar todos os panes"
            >
              <X size={10} strokeWidth={2} />
              Fechar tudo
            </button>
          )}
        </div>

        <div className="flex-1 p-5 overflow-y-auto relative" style={{ scrollbarWidth: 'thin' }}>
          <div className="absolute inset-0 opacity-[0.035] pointer-events-none" style={{ backgroundImage: 'linear-gradient(var(--cb-fg-0) 1px, transparent 1px), linear-gradient(90deg, var(--cb-fg-0) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <AnimatePresence mode="wait">
            {activeView === 'board' ? (
              <OperationsBoard
                workspacePaths={boardWorkspaces}
                onOpenWorkspace={(path) => void activateWorkspace(path)}
                onNewPane={(path) => void handleNewPane(path)}
                onRefresh={() => { void loadTasks(); void loadProviders(); }}
              />
            ) : activeView === 'panes' ? (
              <motion.div key="panes" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative z-10">
                {panes.length === 0 ? (
                  <EmptyState
                    icon={<Terminal size={32} className="text-cb-accent" />}
                    title="Nenhum pane ativo"
                    sub="Abra um workspace para começar"
                    action={{ label: 'Abrir Workspace', onClick: () => handleOpen() }}
                  />
                ) : (
                  <>
                    {/* Open workspace tabs with their panes */}
                    {tabs.length > 0 && tabs.map((tab: any, i: number) => {
                      const tabPanes = (panes as any[]).filter(p =>
                        p.workspacePath === tab.workspacePath ||
                        (p.cwd && tab.workspacePath && p.cwd.startsWith(tab.workspacePath))
                      );
                      return (
                        <WorkspaceGroup
                          key={tab.workspacePath ?? i}
                          tab={tab}
                          panes={tabPanes}
                          onSwitch={() => setActiveTab(i)}
                          onClosePane={handleClosePane}
                        />
                      );
                    })}
                    {/* Panes without workspace (orphans) */}
                    {orphanPanes.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[9px] font-mono text-cb-fg-3 uppercase tracking-widest mb-2">Sem workspace</p>
                        <div className="space-y-1">
                          {orphanPanes.map((p: any) => <PaneRow key={p.id} pane={p} onClose={handleClosePane} />)}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div key="tasks" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative z-10 space-y-2">
                {tasks.length === 0
                  ? <EmptyState icon={<Zap size={32} className="text-cb-warn" />} title="Sem tasks" sub="O agente cria tasks via tool todo_manager" />
                  : tasks.map((t: any, i: number) => <TaskRow key={t.id ?? i} task={t} />)
                }
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Right sidebar — Recent workspaces ────────────────────── */}
      <aside className="w-80 border-l border-cb-line-0 hidden xl:flex flex-col overflow-hidden cb-sidebar bg-cb-bg-1">
        <div className="p-5 border-b border-cb-line-0 flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-cb-fg-3 uppercase tracking-widest">Recentes</h3>
          <span className="text-[9px] font-mono text-cb-fg-3 bg-cb-bg-2 px-1.5 py-0.5 rounded">{recents.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ scrollbarWidth: 'thin' }}>
          {recents.length === 0 ? (
            <EmptyState icon={<FolderOpen size={24} className="text-cb-fg-3" />} title="Nenhum recente" sub="" />
          ) : recents.map((path: string, i: number) => (
            <motion.button
              key={path}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => handleOpen(path)}
              className="w-full p-3.5 rounded-cb-1 border border-cb-line-1 bg-cb-bg-1 hover:border-cb-accent-dim hover:bg-cb-accent-wash transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="w-7 h-7 rounded-cb-1 bg-cb-accent-wash border border-cb-accent-dim flex items-center justify-center shrink-0 group-hover:bg-cb-accent-wash-strong transition-all">
                  <FolderOpen size={13} className="text-cb-accent" />
                </div>
                <ChevronRight size={12} className="text-cb-fg-3 group-hover:text-cb-accent transition-colors" />
              </div>
              <p className="text-[12px] font-bold text-cb-fg-1 truncate group-hover:text-cb-fg-0 transition-colors">{folderName(path)}</p>
              <p className="text-[9px] font-mono text-cb-fg-3 truncate mt-0.5">{path}</p>
            </motion.button>
          ))}
        </div>
        {recents.length > 0 && (
          <div className="p-4 border-t border-cb-line-0">
            <button onClick={() => handleOpen()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-cb-1 border border-cb-line-1 text-cb-fg-3 text-[10px] font-bold uppercase tracking-widest hover:border-cb-accent-dim hover:text-cb-fg-1 hover:bg-cb-accent-wash transition-all cursor-pointer"
            ><Plus size={11} /> Outro Workspace</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function EmptyState({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-16 h-16 rounded-cb-2 bg-cb-accent-wash border border-cb-accent-dim flex items-center justify-center">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-[13px] font-bold text-cb-fg-2">{title}</p>
        {sub && <p className="text-[10px] text-cb-fg-3 mt-1.5 max-w-xs leading-relaxed">{sub}</p>}
      </div>
      {action && (
        <button onClick={action.onClick} className="mt-1 px-5 py-2.5 rounded-cb-1 bg-cb-accent text-cb-on-accent text-[11px] font-bold uppercase tracking-widest hover:bg-cb-accent-bright transition-all cursor-pointer">
          {action.label}
        </button>
      )}
    </div>
  );
}
