import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FolderOpen, Plus, X, Activity, Terminal,
  Bot, ChevronRight, Globe, Zap, Clock,
  Trash2, RefreshCw, Server,
} from 'lucide-react';
import { useNavStore }       from '../../stores/nav-store';
import { useProvidersStore } from '../../stores/providers-store';
import { usePanesStore }     from '../../stores/panes-store';
import { useWorkspaceStore } from '../../stores/workspace-store';

function folderName(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

// ─── Open Workspace Card ──────────────────────────────────────────────────────
function OpenWorkspaceCard({ tab, idx, panes, onSwitch, onClose }: any) {
  const name      = folderName(tab.workspacePath);
  const tabPanes  = panes.filter((p: any) => p.workspacePath === tab.workspacePath || (p.cwd && p.cwd.startsWith(tab.workspacePath)));
  const running   = tabPanes.filter((p: any) => p.status === 'running').length;
  const viewKind  = tab.view?.kind ?? 'workspace';
  const isActive  = useNavStore.getState().activeTabIndex === idx && !useNavStore.getState().onHome;

  return (
    <div className={`p-4 rounded-xl border transition-all ${isActive ? 'border-[#5855e5]/40 bg-[#5855e5]/5 ring-1 ring-[#5855e5]/10' : 'border-white/5 bg-[#0A0A0B]/60 hover:border-white/10'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'bg-[#5855e5]/20 border border-[#5855e5]/30' : 'bg-white/5 border border-white/10'}`}>
            <Server size={15} className={isActive ? 'text-[#5855e5]' : 'text-slate-500'} />
          </div>
          <div>
            <p className="text-[12px] font-bold text-slate-200 truncate max-w-[160px]">{name}</p>
            <p className="text-[9px] font-mono text-slate-600 truncate max-w-[160px]">{tab.workspacePath}</p>
          </div>
        </div>
        <button onClick={() => onClose(idx)} className="p-1 text-slate-700 hover:text-red-400 transition-colors" title="Fechar workspace">
          <X size={13} />
        </button>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'Panes',   value: tabPanes.length },
          { label: 'Running', value: running },
          { label: 'View',    value: viewKind },
        ].map(({ label, value }) => (
          <div key={label} className="text-center p-2 rounded-lg bg-white/5">
            <p className="text-[12px] font-bold text-white truncate">{value}</p>
            <p className="text-[8px] text-slate-600 uppercase tracking-widest mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Pane list */}
      {tabPanes.length > 0 && (
        <div className="space-y-1 mb-3">
          {tabPanes.slice(0, 3).map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'running' ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'}`} />
              <span className="text-[10px] font-mono text-slate-400 truncate flex-1">{p.agent ?? 'shell'}{p.model ? ` · ${p.model}` : ''}</span>
              <span className="text-[9px] font-mono text-slate-600">{p.kind === 'browser' ? '🌐' : '⬛'}</span>
            </div>
          ))}
          {tabPanes.length > 3 && <p className="text-[9px] text-slate-700 text-center">+{tabPanes.length - 3} panes</p>}
        </div>
      )}

      <button
        onClick={() => onSwitch(idx)}
        className={`w-full py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
          isActive
            ? 'bg-[#5855e5] text-white hover:bg-[#4a47d6]'
            : 'border border-white/10 text-slate-400 hover:border-[#5855e5]/30 hover:text-slate-300'
        }`}
      >
        <Activity size={11} /> {isActive ? 'Ativo' : 'Ir para Workspace'}
      </button>
    </div>
  );
}

// ─── Recent Workspace Row ────────────────────────────────────────────────────
function RecentRow({ path, openTabs, onOpen, onRemove }: { path: string; openTabs: any[]; onOpen: (p: string) => void; onRemove: (p: string) => void }) {
  const name    = folderName(path);
  const isOpen  = openTabs.some((t: any) => t.workspacePath === path);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] group transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <FolderOpen size={14} className={isOpen ? 'text-emerald-400' : 'text-slate-600'} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-300 truncate">{name}</p>
          <p className="text-[9px] font-mono text-slate-700 truncate">{path}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        {isOpen && <span className="text-[8px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full uppercase">aberto</span>}
        <button onClick={() => onOpen(path)} className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-[9px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all">
          {isOpen ? 'Ir' : 'Abrir'}
        </button>
        <button onClick={() => onRemove(path)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-700 hover:text-red-400 transition-all" title="Remover dos recentes">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function WorkspacesPage() {
  const [recents,   setRecents]   = useState<string[]>([]);
  const [launching, setLaunching] = useState(false);

  const tabs            = useNavStore(s => s.tabs) as any[];
  const closeTab        = useNavStore(s => s.closeTab);
  const setActiveTab    = useNavStore(s => s.setActiveTab);
  const openWorkspace   = useNavStore(s => s.openWorkspace);
  const setWorkspacePath = useWorkspaceStore(s => s.setPath);
  const providers       = useProvidersStore(s => s.providers) as any[];
  const loadProviders   = useProvidersStore(s => s.load);
  const panes           = usePanesStore(s => s.panes) as any[];

  useEffect(() => {
    (window as any).codeBrainApp?.workspaces?.recent?.()
      .then((d: string[]) => { if (d) setRecents(d); })
      .catch(() => {});
    loadProviders().catch(() => {});
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
        agent: prov?.id === 'claude-oauth' ? 'claude' : (prov?.host ?? 'openclaude'), cwd: selected,
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
          const existingIdx = useNavStore.getState().tabs.findIndex((t: any) => t.workspacePath === result.path);
          if (existingIdx >= 0) {
            useNavStore.getState().setActiveTab(existingIdx);
          }
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const handleSwitch = (idx: number) => {
    useNavStore.getState().setActiveTab(idx);
  };

  const handleCloseTab = (idx: number) => {
    closeTab(idx);
  };

  const handleRemoveRecent = async (path: string) => {
    try { await (window as any).codeBrainApp?.workspaces?.remove?.(path); } catch {}
    setRecents(r => r.filter(p => p !== path));
  };

  const recentNotOpen = recents.filter(r => !tabs.some((t: any) => t.workspacePath === r));

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar — Providers */}
      <aside className="w-56 border-r border-white/5 bg-[#0F0F13] hidden md:flex flex-col overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Providers</h3>
          {providers.length === 0 ? (
            <p className="text-[10px] text-slate-700 font-mono">Nenhum configurado</p>
          ) : (
            <div className="space-y-2">
              {providers.map((p: any) => (
                <div key={p.id} className="p-2.5 rounded-lg border border-white/5 bg-[#0A0A0B]/50">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <p className="text-[10px] font-bold text-slate-300 truncate">{p.label}</p>
                  </div>
                  <p className="text-[9px] font-mono text-slate-600 truncate">{p.type ?? 'custom'}</p>
                  {(p.models ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(p.models as string[]).slice(0, 2).map((m: string) => (
                        <span key={m} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 truncate max-w-[90px]">{m}</span>
                      ))}
                      {p.models.length > 2 && <span className="text-[8px] text-slate-600">+{p.models.length - 2}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 mt-auto">
          <div className="p-3 rounded-lg bg-[#0A0A0B]/50 border border-white/5 text-center">
            <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">{panes.length} pane{panes.length !== 1 ? 's' : ''} total</p>
            <p className="text-[9px] font-mono text-emerald-400 mt-0.5">{panes.filter((p: any) => p.status === 'running').length} rodando</p>
          </div>
        </div>
      </aside>

      {/* Center — open workspaces grid */}
      <section className="flex-1 p-5 overflow-y-auto relative" style={{ scrollbarWidth: 'thin' }}>
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative z-10">
          {/* Open workspaces */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-[15px] font-bold text-white">Workspaces</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">{tabs.length} aberto{tabs.length !== 1 ? 's' : ''} · {recents.length} recente{recents.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => handleOpen()}
              disabled={launching}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#5855e5] text-white text-[11px] font-bold uppercase tracking-widest hover:bg-[#4a47d6] disabled:opacity-60 transition-colors"
            >
              <Plus size={12} /> {launching ? 'Abrindo…' : 'Novo'}
            </button>
          </div>

          {tabs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Server size={40} className="text-slate-800" />
              <div className="text-center">
                <p className="text-[13px] font-bold text-slate-600">Nenhum workspace aberto</p>
                <p className="text-[10px] text-slate-700 mt-1">Abra uma pasta para começar</p>
              </div>
              <button onClick={() => handleOpen()} className="px-4 py-2 rounded-lg bg-[#5855e5] text-white text-[11px] font-bold uppercase tracking-widest hover:bg-[#4a47d6] transition-colors">
                Abrir Workspace
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-8">
              {tabs.map((tab: any, i: number) => (
                <OpenWorkspaceCard
                  key={tab.workspacePath ?? i}
                  tab={tab} idx={i} panes={panes}
                  onSwitch={handleSwitch}
                  onClose={handleCloseTab}
                />
              ))}
            </div>
          )}

          {/* Recent (not open) */}
          {recentNotOpen.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 pt-2 border-t border-white/5">
                <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Recentes (não abertos)</h2>
                <span className="text-[9px] font-mono text-slate-700">{recentNotOpen.length}</span>
              </div>
              <div className="rounded-xl border border-white/5 bg-[#0A0A0B]/30 overflow-hidden">
                {recentNotOpen.map((path: string) => (
                  <RecentRow key={path} path={path} openTabs={tabs} onOpen={handleOpen} onRemove={handleRemoveRecent} />
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
