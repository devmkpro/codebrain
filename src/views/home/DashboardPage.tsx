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
function StatCard({ icon, label, value, sub, color = '#4F46E5' }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-4 rounded-xl border border-white/5 bg-[#0A0A0B]/60 flex flex-col gap-2 hover:border-white/10 hover:bg-[#0A0A0B]/80 transition-all group cursor-default">
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-600">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white font-mono group-hover:scale-105 transition-transform origin-left">{value}</p>
      {sub && <p className="text-[9px] text-slate-700">{sub}</p>}
    </div>
  );
}

function PaneRow({ pane, onClose }: { pane: any; onClose?: (id: string) => void }) {
  const isRun = pane.status === 'running';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-white/[0.04] bg-[#0A0A0B]/50 hover:border-white/10 hover:bg-[#0A0A0B]/70 transition-all group/pane">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRun ? 'bg-emerald-400 animate-pulse shadow-[0_0_4px_rgba(52,211,153,0.4)]' : pane.kind === 'browser' ? 'bg-cyan-400' : 'bg-slate-700'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-slate-300 truncate">
          {pane.agent ?? 'shell'}{pane.model ? ` · ${pane.model}` : ''}
        </p>
      </div>
      <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-full shrink-0 ${
        isRun ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15' : pane.kind === 'browser' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-white/5 text-slate-600'
      }`}>
        {pane.kind === 'browser' ? 'browser' : pane.status ?? 'idle'}
      </span>
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(pane.id); }}
          className="opacity-0 group-hover/pane:opacity-100 w-5 h-5 rounded flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
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
    <div className="rounded-xl border border-white/[0.04] bg-[#0A0A0B]/30 overflow-hidden mb-3 hover:border-white/[0.06] transition-all">
      <div
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.02] transition-all cursor-pointer"
      >
        <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
          <Server size={12} className="text-violet-400" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[11px] font-bold text-slate-200 truncate">{name}</p>
          <p className="text-[9px] font-mono text-slate-600 truncate">{tab.workspacePath}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${running > 0 ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/15' : 'text-slate-600 bg-white/5'}`}>
            {panes.length} pane{panes.length !== 1 ? 's' : ''}{running > 0 ? ` · ${running} ativo${running !== 1 ? 's' : ''}` : ''}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onSwitch(); }}
            className="text-[9px] font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded hover:bg-violet-500/20 hover:shadow-[0_0_8px_rgba(139,92,246,0.1)] transition-all uppercase tracking-widest"
          >
            ir →
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-white/[0.04] px-3 pb-2 pt-1.5 space-y-1">
          {panes.length === 0 ? (
            <p className="text-[9px] font-mono text-slate-700 py-1">Sem panes ativos</p>
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
    <div className={`flex items-start gap-2.5 p-3 rounded-lg border transition-all ${
      task.status === 'in_progress' ? 'border-violet-500/15 bg-violet-500/5'
      : task.status === 'done'      ? 'border-white/[0.03] opacity-60'
      : 'border-white/[0.04] bg-[#0A0A0B]/50 hover:border-white/[0.06]'
    }`}>
      {task.status === 'done'
        ? <Activity size={11} className="text-emerald-500 shrink-0 mt-0.5" />
        : task.status === 'in_progress'
        ? <RefreshCw size={11} className="text-red-400 animate-spin shrink-0 mt-0.5" />
        : <Circle size={11} className="text-slate-700 shrink-0 mt-0.5" />}
      <p className={`text-[10px] font-mono leading-snug ${
        task.status === 'done' ? 'text-slate-600 line-through'
        : task.status === 'in_progress' ? 'text-white'
        : 'text-slate-400'
      }`}>{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { navigate } = useRouter();
  const [recents,    setRecents]   = useState<string[]>([]);
  const [launching,  setLaunching] = useState(false);
  const [activeView, setView]      = useState<'panes' | 'tasks'>('panes');

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

  const handleOpen = useCallback(async (path?: string) => {
    if (launching) return;
    const selected = path ?? await (window as any).codeBrainApp?.workspace?.open?.();
    if (!selected) return;
    setLaunching(true);
    setWorkspacePath(selected);
    try { await (window as any).codeBrainApp?.workspaces?.touch?.(selected); } catch {}
    openWorkspace(selected);
    const prov = providers[0];
    try {
      await (window as any).codeBrainApp?.pty?.spawn?.({
        agent: prov?.id === 'claude-oauth' ? 'claude' : (prov?.host ?? 'openclaude'),
        cwd: selected,
        providerId: prov?.id,
      });
    } catch {}
    setLaunching(false);
  }, [launching, openWorkspace, setWorkspacePath, providers]);

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
      <aside className="w-72 border-r border-white/[0.04] hidden md:flex flex-col overflow-hidden cb-sidebar">
        {/* CTA */}
        <div className="p-5 border-b border-white/[0.04]">
          <button
            onClick={() => handleOpen()}
            disabled={launching}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[11px] font-bold uppercase tracking-widest hover:from-violet-500 hover:to-indigo-500 hover:shadow-[0_0_20px_rgba(139,92,246,0.25)] disabled:opacity-60 disabled:cursor-wait transition-all"
          >
            <FolderOpen size={14} />
            {launching ? 'Iniciando…' : 'Abrir Workspace'}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-white/5">
          <StatCard icon={<Terminal size={13} />}  label="Panes"      value={panes.length}     sub={`${activePanes.length} ativos`} />
          <StatCard icon={<Zap size={13} />}        label="Tasks"      value={tasks.length}     sub={`${pendingTasks.length} pendentes`} color="#F59E0B" />
          <StatCard icon={<Bot size={13} />}         label="Providers"  value={providers.length} color="#06B6D4" />
          <StatCard icon={<FolderOpen size={13} />} label="Recentes"   value={recents.length}   color="#10B981" />
        </div>

        {/* Features recentes — quick access to Settings sections */}
        <div className="p-4 space-y-1">
          <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1.5 px-1">Features Recentes</p>
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
              className="w-full flex items-center justify-between p-2.5 rounded-lg border border-transparent hover:border-white/[0.04] hover:bg-white/[0.02] transition-all group text-left"
            >
              <div className="flex items-center gap-2 text-slate-600 group-hover:text-slate-300">
                {icon}
                <span className="text-[10px] font-medium">{label}</span>
              </div>
              {badge ? (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-[8px] font-bold text-indigo-400 border border-indigo-500/20">{badge}</span>
              ) : (
                <ChevronRight size={10} className="text-slate-700 group-hover:text-slate-500 transition-colors" />
              )}
            </button>
          ))}
        </div>

        {/* Navigation links */}
        <div className="p-4 space-y-1.5 border-t border-white/[0.04]">
          {([
            { href: '/workspaces' as const, label: 'Ver Workspaces', icon: <FolderOpen size={12} /> },
            { href: '/settings'   as const, label: 'Configurações',   icon: <Zap size={12} /> },
          ]).map(({ href, label, icon }) => (
            <Link key={href} href={href}
              className="flex items-center justify-between p-3 rounded-lg border border-white/[0.04] hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group"
            >
              <div className="flex items-center gap-2 text-slate-500 group-hover:text-slate-300">{icon}<span className="text-[10px] font-medium">{label}</span></div>
              <ChevronRight size={12} className="text-slate-700 group-hover:text-violet-400 transition-colors" />
            </Link>
          ))}
        </div>
      </aside>

      {/* ── Center ───────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col bg-[#0B0B0E] overflow-hidden">
        {/* Sub-nav */}
        <div className="h-10 border-b border-white/[0.04] flex items-center px-6 justify-between bg-[#0F0F13]/50 shrink-0 backdrop-blur-sm">
          <div className="flex h-7 bg-white/5 rounded p-0.5 border border-white/10">
            {(['panes', 'tasks'] as const).map(t => (
              <button key={t} onClick={() => setView(t)}
                className={`px-3 text-[10px] font-bold uppercase tracking-tight rounded transition-all ${activeView === t ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {t === 'panes' ? `Panes (${panes.length})` : `Tasks (${tasks.length})`}
              </button>
            ))}
          </div>
          <button onClick={() => loadTasks().catch(() => {})} className="p-1.5 rounded text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-all">
            <RefreshCw size={12} />
          </button>
          {panes.length > 0 && (
            <button
              onClick={handleCloseAll}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[9px] font-mono font-bold uppercase tracking-wider text-slate-600 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
              title="Fechar todos os panes"
            >
              <X size={10} strokeWidth={2} />
              Fechar tudo
            </button>
          )}
        </div>

        <div className="flex-1 p-5 overflow-y-auto relative" style={{ scrollbarWidth: 'thin' }}>
          <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          <AnimatePresence mode="wait">
            {activeView === 'panes' ? (
              <motion.div key="panes" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative z-10">
                {panes.length === 0 ? (
                  <EmptyState
                    icon={<Terminal size={32} className="text-violet-500/40" />}
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
                        <p className="text-[9px] font-mono text-slate-700 uppercase tracking-widest mb-2">Sem workspace</p>
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
                  ? <EmptyState icon={<Zap size={32} className="text-slate-800" />} title="Sem tasks" sub="O agente cria tasks via tool todo_manager" />
                  : tasks.map((t: any, i: number) => <TaskRow key={t.id ?? i} task={t} />)
                }
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Right sidebar — Recent workspaces ────────────────────── */}
      <aside className="w-80 border-l border-white/[0.04] hidden xl:flex flex-col overflow-hidden cb-sidebar">
        <div className="p-5 border-b border-white/[0.04] flex items-center justify-between">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recentes</h3>
          <span className="text-[9px] font-mono text-slate-700 bg-white/5 px-1.5 py-0.5 rounded">{recents.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ scrollbarWidth: 'thin' }}>
          {recents.length === 0 ? (
            <EmptyState icon={<FolderOpen size={24} className="text-slate-800" />} title="Nenhum recente" sub="" />
          ) : recents.map((path: string, i: number) => (
            <motion.button
              key={path}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => handleOpen(path)}
              className="w-full p-3.5 rounded-xl border border-white/[0.04] bg-[#0A0A0B]/60 hover:border-violet-500/20 hover:bg-violet-500/[0.04] hover:shadow-[0_0_16px_rgba(139,92,246,0.06)] transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0 group-hover:bg-violet-500/15 group-hover:border-violet-500/25 transition-all">
                  <FolderOpen size={13} className="text-violet-400" />
                </div>
                <ChevronRight size={12} className="text-slate-700 group-hover:text-violet-400 transition-colors" />
              </div>
              <p className="text-[12px] font-bold text-slate-200 truncate group-hover:text-white transition-colors">{folderName(path)}</p>
              <p className="text-[9px] font-mono text-slate-600 truncate mt-0.5">{path}</p>
            </motion.button>
          ))}
        </div>
        {recents.length > 0 && (
          <div className="p-4 border-t border-white/[0.04]">
            <button onClick={() => handleOpen()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:border-violet-500/30 hover:text-slate-300 hover:bg-violet-500/5 transition-all cursor-pointer"
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
      <div className="w-16 h-16 rounded-2xl bg-violet-500/5 border border-violet-500/10 flex items-center justify-center">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-[13px] font-bold text-slate-500">{title}</p>
        {sub && <p className="text-[10px] text-slate-600 mt-1.5 max-w-xs leading-relaxed">{sub}</p>}
      </div>
      {action && (
        <button onClick={action.onClick} className="mt-1 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[11px] font-bold uppercase tracking-widest hover:from-violet-500 hover:to-indigo-500 hover:shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all cursor-pointer">
          {action.label}
        </button>
      )}
    </div>
  );
}
