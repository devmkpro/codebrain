import React from 'react';
import { nanoid } from 'nanoid';
import {
  X, Plus, Settings, Activity, FolderOpen, Save, RotateCcw,
  ListTodo, Terminal, Globe, Users, Zap, Map, FileText,
  ChevronRight, ChevronDown, Home, Mic, MicOff, Volume2,
  Shield, Cpu, MoreHorizontal, FolderTree, ArrowLeft, Database, DollarSign,
} from 'lucide-react';
import { Logo } from '../auth/Logo';
import { Link, useRouter } from '../../lib/router';
import { useNavStore } from '../../stores/nav-store';
import { usePanesStore } from '../../stores/panes-store';
import { useAuthStore } from '../../stores/auth-store';
import { useProvidersStore } from '../../stores/providers-store';
import {
  useTasksStore,
  tabLabel,
  outputModeForInteractionMode,
  normalizedVoiceMode,
} from '../../stores/tasks-store';
import { useMemoryStore } from '../../stores/memory-store';
import { useCostStore } from '../../stores/cost-store';
import { useVoiceStore } from '../../stores/voice-store';
import { useBrowserStore } from '../../stores/browser-store';
import { useTerminalSettings } from '../../stores/terminal-settings-store';
import { ProvidersModal } from '../providers/ProvidersModal';
import { SquadModal } from '../squads/SquadModal';
import { SettingsModal } from '../settings/SettingsModal';
import { DiagnosticsModal } from '../diagnostics/DiagnosticsModal';

// ─── Shared modal-state hook ──────────────────────────────────────────────────
function useModals() {
  const [showProviders,  setShowProviders]  = React.useState(false);
  const [providersStep,  setProvidersStep]  = React.useState('list');
  const [showSquad,      setShowSquad]      = React.useState(false);
  const [showSettings,   setShowSettings]   = React.useState(false);
  const [showDiag,       setShowDiag]       = React.useState(false);

  const openProviders = (step = 'list') => { setProvidersStep(step); setShowProviders(true); };
  const closeProviders = () => { setShowProviders(false); setProvidersStep('list'); };

  return {
    showProviders, openProviders, closeProviders, providersStep,
    showSquad,    setShowSquad,
    showSettings, setShowSettings,
    showDiag,     setShowDiag,
  };
}

// ─── Icon button ─────────────────────────────────────────────────────────────
function IconBtn({
  icon, label, onClick, active = false, badge, danger = false, disabled = false,
}: {
  icon: React.ReactNode; label: string; onClick?: () => void;
  active?: boolean; badge?: number; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`relative flex items-center gap-1.5 px-2 h-full text-[11px] font-mono font-bold uppercase tracking-widest transition-all focus:outline-none cursor-pointer
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${active
          ? 'text-indigo-400 bg-indigo-500/10'
          : danger
          ? 'text-slate-600 hover:text-red-400 hover:bg-red-500/5'
          : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04]'}`}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1.5 right-0.5 font-mono text-[7px] font-bold bg-indigo-500 text-white rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-0.5">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────
const VDiv = () => <div className="w-px h-5 bg-white/[0.06] shrink-0 self-center" />;

// ─── Home Header ─────────────────────────────────────────────────────────────
function HomeHeader() {
  const { route } = useRouter();
  const tabs       = useNavStore(s => s.tabs);
  const authEmail  = useAuthStore(s => s.email);
  const activeWorkspace = tabs[(useNavStore(s => s.activeTabIndex))]?.workspacePath as string | undefined;

  const m = useModals();
  const [showAccount, setShowAccount] = React.useState(false);
  const [profile,     setProfile]     = React.useState<any>(null);
  const accountRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!showAccount) return;
    const h = (e: MouseEvent) => { if (accountRef.current && !accountRef.current.contains(e.target as Node)) setShowAccount(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showAccount]);

  React.useEffect(() => {
    if (!showAccount) return;
    (window as any).codeBrainApp?.auth?.profile?.()
      .then((p: any) => setProfile({ plan: p.plan, status: p.status, periodEnd: p.periodEnd }))
      .catch(() => {});
  }, [showAccount]);

  const NAV: { label: string; href: '/' | '/workspaces' | '/logs' | '/settings' }[] = [
    { label: 'Dashboard',  href: '/' },
    { label: 'Workspaces', href: '/workspaces' },
    { label: 'Logs',       href: '/logs' },
  ];

  return (
    <>
      <div className="h-[38px] w-full shrink-0 flex relative z-[60]" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex-1" />
        {/* Adicionado o padding na margem direita de 140px por conta dos botões window controls nativos do Electron/Windows */}
        <div className="w-[140px] shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any} />
      </div>

      <header
        className="h-14 border-b border-white/5 flex items-center px-6 justify-between bg-[#0F0F13] shrink-0 z-50 relative"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Brand */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Link href="/" className="flex items-center gap-2.5 group">
            <Logo size={22} />
            <span className="text-[14px] font-bold tracking-tight text-white">
              Codebrain <span className="text-[#4F46E5]">OS</span>
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="hidden lg:flex items-center gap-5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {NAV.map(item => (
            <Link key={item.href} href={item.href}
              className={`text-[13px] font-medium transition-colors ${route === item.href ? 'text-[#4F46E5]' : 'text-slate-400 hover:text-white'}`}
            >{item.label}</Link>
          ))}
          <Link href="/settings"
            className={`px-2.5 py-1 border rounded text-[10px] font-mono tracking-widest transition-colors ${route === '/settings' ? 'bg-[#4F46E5]/20 border-[#4F46E5]/40 text-[#4F46E5]' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'}`}
          >SETTINGS</Link>
        </nav>

        {/* Right */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Providers */}
          <button onClick={() => m.openProviders('list')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:text-slate-300 hover:border-white/20 transition-all cursor-pointer"
          ><Zap size={11} /> Providers</button>

          {/* Squad */}
          <button onClick={() => m.setShowSquad(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:text-slate-300 hover:border-white/20 transition-all cursor-pointer"
          ><Users size={11} /> Squad</button>

          {/* Back to workspace */}
          {tabs.length > 0 && (
            <button
              onClick={() => useNavStore.getState().setActiveTab(useNavStore.getState().activeTabIndex)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4F46E5]/10 border border-[#4F46E5]/20 text-indigo-400 text-[10px] font-bold uppercase tracking-widest hover:bg-[#4F46E5]/20 transition-all cursor-pointer"
            ><Activity size={11} /> Workspace</button>
          )}

          {/* Account */}
          <div ref={accountRef} className="relative">
            <button onClick={() => setShowAccount(v => !v)}
              className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/25 flex items-center justify-center hover:bg-indigo-500/30 transition-all cursor-pointer"
            >
              <span className="font-mono text-[9px] font-bold text-indigo-400">{authEmail?.slice(0,1).toUpperCase() ?? '?'}</span>
            </button>
            {showAccount && <AccountDropdown profile={profile} authEmail={authEmail} activeWorkspace={activeWorkspace} modals={m} onClose={() => setShowAccount(false)} />}
          </div>
        </div>
      </header>

      <Modals modals={m} activeWorkspace={activeWorkspace} />
    </>
  );
}

// ─── Account dropdown (shared) ───────────────────────────────────────────────
function AccountDropdown({ profile, authEmail, activeWorkspace, modals: m, onClose }: any) {
  const { navigate } = useRouter();
  const goHome = useNavStore(s => s.goHome);
  const rows = [
    ...(activeWorkspace ? [{ label: '⬡ Squad',        action: () => { onClose(); m.setShowSquad(true);    }, icon: <Users size={11} /> }] : []),
    { label: '💲 Token Usage',          action: () => { onClose(); useCostStore.getState().toggle();       }, icon: <DollarSign size={11} /> },
    { label: '⚙ Configurações',        action: () => { onClose(); goHome(); navigate('/settings');       }, icon: <Settings size={11} /> },
    { label: '⚡ Diagnóstico',          action: () => { onClose(); m.setShowDiag(true);                   }, icon: <Activity size={11} /> },
    { label: 'Sair',                   action: () => { onClose(); (window as any).codeBrainApp?.auth?.logout?.(); }, danger: true },
  ];

  return (
    <div className="fixed right-2 top-[90px] w-64 bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl z-[10000] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-0.5">Conta</p>
        <p className="font-mono text-[11px] text-slate-300 truncate">{authEmail}</p>
      </div>
      {/* profile && (
        <div className="px-4 py-2.5 border-b border-white/5">
          <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Assinatura</p>
          {profile.plan ? (
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-slate-300 capitalize">{profile.plan}</span>
              <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${['active','trialing'].includes(profile.status) ? 'text-green-400 bg-green-500/10 border border-green-500/20' : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'}`}>{profile.status ?? '—'}</span>
            </div>
          ) : <p className="font-mono text-[11px] text-amber-400">sem plano ativo</p>}
        </div>
      ) */}
      {rows.map(({ label, action, danger, icon }: any) => (
        <button key={label} onClick={action}
          className={`w-full text-left px-4 py-2.5 font-mono text-[11px] border-b border-white/5 transition-all flex items-center gap-2 cursor-pointer ${danger ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/5' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
        >
          {icon}{label}
        </button>
      ))}
    </div>
  );
}

// ─── Modals renderer (shared) ─────────────────────────────────────────────────
function Modals({ modals: m, activeWorkspace }: { modals: ReturnType<typeof useModals>; activeWorkspace?: string }) {
  const handleSpawnSquad = useWorkspaceSquadSpawner();
  
  React.useEffect(() => {
    const handleOpenProviders = () => m.openProviders('list');
    document.addEventListener('open-providers-modal', handleOpenProviders);
    return () => document.removeEventListener('open-providers-modal', handleOpenProviders);
  }, [m]);

  return (
    <>
      <ProvidersModal open={m.showProviders} initialStep={m.providersStep} onClose={m.closeProviders} />
      <SquadModal     open={m.showSquad}     onClose={() => m.setShowSquad(false)} onSpawn={handleSpawnSquad} />
      <SettingsModal  open={m.showSettings}  onClose={() => m.setShowSettings(false)} />
      <DiagnosticsModal open={m.showDiag}   activeWorkspace={activeWorkspace} onClose={() => m.setShowDiag(false)} />
    </>
  );
}

// ─── Squad spawner (shared logic) ────────────────────────────────────────────
function useWorkspaceSquadSpawner() {
  const addPane         = usePanesStore(s => s.addPane);
  const providers       = useProvidersStore(s => s.providers) as any[];
  const activeWorkspace = useNavStore(s => {
    const tabs = s.tabs as any[];
    const tab  = tabs[s.activeTabIndex];
    return tab?.workspacePath as string | undefined;
  });
  const permMode = localStorage.getItem('codebrain.permissionMode') ?? 'bypassPermissions';

  const resolveValidModel = React.useCallback((providerId: string, requestedModel?: string): string | undefined => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return undefined;
    const models = provider.models ?? [];
    if (models.length === 0) return undefined;
    if (requestedModel && models.includes(requestedModel)) return requestedModel;
    return models[0];
  }, [providers]);

  return React.useCallback(async (squad: any) => {
    // Use workspacePath from squad (selected in SquadModal), fallback to activeWorkspace
    const workspace = squad.workspacePath ?? activeWorkspace;
    if (!workspace) return;
    const activityId = nanoid(8);
    const pty = (window as any).codeBrainApp?.pty;

    // ── Detect role from worker label ──
    const detectRole = (label: string): string => {
      const l = (label ?? '').toLowerCase();
      if (l.includes('tester') || l.includes('test')) return 'ui-tester';
      return 'worker';
    };

    // ── Spawn workers first ──
    const workers    = squad.workers ?? (squad.worker ? [squad.worker] : []);
    const workerIds: string[] = [];
    for (const w of workers) {
      const prov  = providers.find(p => p.id === w.providerId);
      const agent = w.agent ?? prov?.host ?? 'openclaude';
      const validModel = resolveValidModel(w.providerId, w.model);
      const role = detectRole(w.role ?? '');
      const r = await pty.spawn({ agent, cwd: workspace, activityId, providerId: w.providerId, model: validModel, permissionMode: permMode, role });
      if (!r?.ok || !r.paneId) continue;
      workerIds.push(r.paneId);
      addPane({ id: r.paneId, agent, cwd: workspace, workspacePath: workspace, activityId, providerId: w.providerId, model: validModel, externallySpawned: true });
    }
    if (!workerIds.length) return;

    // ── Spawn orchestrator with role=orchestrator ──
    const orchProv  = providers.find(p => p.id === squad.orchestrator.providerId);
    const orchAgent = squad.orchestrator.agent ?? orchProv?.host ?? 'openclaude';
    const validOrchModel = resolveValidModel(squad.orchestrator.providerId, squad.orchestrator.model);
    const orchRes = await pty.spawn({
      agent: orchAgent, cwd: workspace, activityId,
      providerId: squad.orchestrator.providerId, model: validOrchModel,
      permissionMode: permMode, role: 'orchestrator',
      env: { SQUAD_WORKER_IDS: workerIds.join(','), SQUAD_ACTIVITY_ID: activityId }
    });
    if (orchRes?.ok && orchRes.paneId)
      addPane({ id: orchRes.paneId, agent: orchAgent, cwd: workspace, workspacePath: workspace, activityId, providerId: squad.orchestrator.providerId, model: validOrchModel, externallySpawned: true });

    // Switch to the workspace tab after spawning
    const tabIdx = useNavStore.getState().tabs.findIndex((t: any) => t.workspacePath === workspace);
    if (tabIdx >= 0) useNavStore.getState().setActiveTab(tabIdx);
  }, [activeWorkspace, providers, addPane, permMode, resolveValidModel]);
}

// ─── Files navbar (path breadcrumb) ──────────────────────────────────────────
function FilesNavBar({ workspacePath }: { workspacePath: string }) {
  const parts   = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  return (
    <div className="h-9 border-b border-white/5 bg-[#0F0F13]/80 flex items-center px-4 gap-2 shrink-0 overflow-x-auto"
      style={{ scrollbarWidth: 'none' } as React.CSSProperties}
    >
      <FolderTree size={12} className="text-[#4F46E5] shrink-0" />
      <div className="flex items-center gap-1 min-w-0">
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={10} className="text-slate-700 shrink-0" />}
            <span className={`font-mono text-[10px] truncate ${i === parts.length - 1 ? 'text-slate-300 font-bold' : 'text-slate-600'}`}>{p}</span>
          </React.Fragment>
        ))}
      </div>
      <button
        onClick={() => navigateInActiveTab({ kind: 'workspace' })}
        className="ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-all"
        title="Fechar Files"
      >
        <X size={10} /> fechar
      </button>
    </div>
  );
}

// ─── + PANE Dropdown ─────────────────────────────────────────────────────────
function PaneMenu({
  onClose, activeWorkspace, permissionMode, setPermissionMode,
  savedPanes, snapshotBusy, onSave, onRestore, onRestorePane,
}: any) {
  const addPane   = usePanesStore(s => s.addPane);
  const providers = useProvidersStore(s => s.providers) as any[];
  const detectedUrl = useBrowserStore(s => s.detectedUrl);
  const m         = useModals();
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const favoritePane = React.useRef<any>(null);
  const [favLoaded, setFavLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!activeWorkspace) return;
    (window as any).codeBrainApp?.workspaceConfig?.get(activeWorkspace)
      .then((cfg: any) => { favoritePane.current = cfg?.favoritePane ?? null; setFavLoaded(true); })
      .catch(() => setFavLoaded(true));
  }, [activeWorkspace]);

  const handleAddPane = (providerId?: string, model?: string) => {
    if (!activeWorkspace) return;
    onClose();
    navigateInActiveTab({ kind: 'workspace' });
    const explicit = providerId !== undefined || model !== undefined;
    const nextPid  = explicit ? providerId : favoritePane.current?.providerId;
    const nextMod  = explicit ? model      : favoritePane.current?.model;
    const prov     = nextPid ? providers.find(p => p.id === nextPid) : null;
    const agent    = explicit ? prov?.host ?? 'openclaude' : favoritePane.current?.agent ?? prov?.host ?? 'openclaude';
    const env: Record<string,string> = { ...(prov?.env ?? {}), ...(nextMod ? { ANTHROPIC_MODEL: nextMod, MODEL: nextMod } : {}) };
    (window as any).codeBrainApp?.pty.spawn({ agent, cwd: activeWorkspace, providerId: nextPid, model: nextMod, permissionMode, ...(Object.keys(env).length ? { env } : {}) })
      .then((r: any) => { if (r?.ok && r.paneId) addPane({ id: r.paneId, agent, cwd: activeWorkspace, workspacePath: activeWorkspace, providerId: nextPid, model: nextMod, permissionMode, externallySpawned: true }); })
      .catch(() => {});
  };

  const handleTerminal = () => {
    if (!activeWorkspace) return;
    onClose();
    navigateInActiveTab({ kind: 'workspace' });
    (window as any).codeBrainApp?.pty.spawn({ agent: 'shell', cwd: activeWorkspace })
      .then((r: any) => { if (r?.ok && r.paneId) addPane({ id: r.paneId, agent: 'shell', cwd: activeWorkspace, workspacePath: activeWorkspace, externallySpawned: true }); })
      .catch(() => {});
  };

  const handleBrowser = () => {
    if (!activeWorkspace) return;
    onClose();
    navigateInActiveTab({ kind: 'workspace' });
    const pane = addPane({ kind: 'browser', cwd: activeWorkspace, url: detectedUrl ?? 'about:blank' }) as any;
    if (pane?.id) (window as any).codeBrainApp?.browser?.registerPane?.(pane.id, activeWorkspace);
  };

  const PERM_MODES = [
    { id: 'bypassPermissions', label: 'Danger', cls: (a: boolean) => a ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'border-white/10 text-slate-600 hover:text-rose-400' },
    { id: 'auto',              label: 'Auto',   cls: (a: boolean) => a ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'border-white/10 text-slate-600 hover:text-green-400' },
    { id: 'default',           label: 'Pend',   cls: (a: boolean) => a ? 'bg-white/10 text-slate-200 border-white/20' : 'border-white/10 text-slate-600 hover:text-slate-300' },
    { id: 'plan',              label: 'Plan',   cls: (a: boolean) => a ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'border-white/10 text-slate-600 hover:text-indigo-400' },
  ];

  return (
    <>
      <div className="fixed top-[90px] right-2 w-72 max-h-[calc(100vh-100px)] bg-[#0c0c14] border border-white/[0.08] rounded-xl shadow-2xl z-[10000] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {/* Permission mode */}
        <div className="px-3 pt-2.5 pb-1">
          <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-2">Modo</p>
          <div className="flex gap-1">
            {PERM_MODES.map(m => (
              <button key={m.id} onClick={() => setPermissionMode(m.id)}
                className={`flex-1 px-1.5 py-1 rounded border font-mono text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${m.cls(permissionMode === m.id)}`}
              >{m.label}</button>
            ))}
          </div>
        </div>

        {/* Types */}
        <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] text-slate-600 uppercase tracking-widest border-t border-white/5">Tipo</p>
        <button onClick={handleTerminal} className="w-full text-left px-3 py-2 font-mono text-[10px] text-slate-300 hover:text-white hover:bg-white/5 border-b border-white/5 flex items-center gap-2 transition-all cursor-pointer">
          <Terminal size={11} className="text-slate-600" /> Terminal
        </button>
        <button onClick={handleBrowser} className={`w-full text-left px-3 py-2 font-mono text-[10px] border-b border-white/5 flex items-center gap-2 transition-all cursor-pointer ${detectedUrl ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-slate-300 hover:bg-white/5'}`}>
          <Globe size={11} className="text-slate-600" /> Browser
          {detectedUrl && <span className="text-[9px] text-indigo-500/60 truncate">{detectedUrl}</span>}
        </button>

        {/* AI Providers */}
        <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] text-slate-600 uppercase tracking-widest">Agente</p>
        {providers.length === 0 && (
          <p className="px-3 py-2 font-mono text-[10px] text-slate-700">Nenhum provider configurado</p>
        )}
        {providers.map(p => {
          const pid    = p.id === 'claude-oauth' ? undefined : p.id;
          const models = p.models ?? [];
          return (
            <div key={p.id} className="border-b border-white/5">
              <div className="px-3 pt-1.5 pb-0.5 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold text-indigo-400 truncate">{p.label}</span>
                <span className="font-mono text-[9px] text-slate-600 ml-2">{p.type === 'oauth' ? 'OAuth' : p.type === 'anthropic-compat' ? 'Compat' : 'OpenAI'}</span>
              </div>
              {models.length === 0
                ? <button onClick={() => handleAddPane(pid)} className="w-full text-left px-3 py-1 font-mono text-[10px] text-slate-300 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all cursor-pointer">+ default</button>
                : models.map((model: string) => (
                    <button key={model} onClick={() => handleAddPane(pid, model)} className="w-full text-left px-5 py-1 font-mono text-[10px] text-slate-300 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all truncate cursor-pointer">+ {model}</button>
                  ))
              }
            </div>
          );
        })}
        <button onClick={() => { onClose(); m.openProviders('pickTemplate'); }}
          className="w-full text-left px-3 py-2 font-mono text-[10px] text-slate-500 hover:text-slate-300 hover:bg-white/5 border-b border-white/5 transition-all cursor-pointer"
        >⚙ Configurar providers…</button>

        {/* Session */}
        <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] text-slate-600 uppercase tracking-widest border-t border-white/5">Sessão</p>
        <button onClick={() => { onClose(); onSave(); }} disabled={snapshotBusy}
          className={`w-full text-left px-3 py-2 font-mono text-[10px] border-b border-white/5 flex items-center gap-2 transition-all cursor-pointer ${snapshotBusy ? 'text-slate-700 cursor-wait' : 'text-slate-300 hover:bg-white/5'}`}
        ><Save size={11} className="text-slate-600" />{snapshotBusy ? 'Salvando…' : 'Salvar Sessão'}</button>
        <button onClick={() => { onClose(); onRestore(); }} disabled={snapshotBusy}
          className={`w-full text-left px-3 py-2 font-mono text-[10px] border-b border-white/5 flex items-center gap-2 transition-all cursor-pointer ${snapshotBusy ? 'text-slate-700 cursor-wait' : 'text-slate-300 hover:bg-white/5'}`}
        ><RotateCcw size={11} className="text-slate-600" />{snapshotBusy ? 'Restaurando…' : 'Restaurar Sessão'}</button>

        {/* Saved panes */}
        {savedPanes.length > 0 && (
          <>
            <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] text-slate-600 uppercase tracking-widest">Restaurar Pane</p>
            <div className="max-h-56 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {savedPanes.map((p: any) => {
                const preview = p.summary || '(sem mensagens)';
                const ago     = new Date(p.savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                return (
                  <button key={p.id} onClick={() => { onClose(); onRestorePane(p); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-all border-b border-white/[0.03] cursor-pointer"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-mono text-[10px] truncate text-slate-300">{preview}</span>
                      <span className="font-mono text-[9px] text-slate-600 shrink-0">{ago}</span>
                    </div>
                    <p className="font-mono text-[9px] text-slate-600">{p.agent} · {p.session?.confidence === 'high' ? 'Resume' : 'Reopen'}</p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Audio / Voice Indicator ──────────────────────────────────────────────────
function AudioIndicator({ audioConfig, audioModeBusy, onToggleMode }: any) {
  const voiceStats        = useVoiceStore(s => s.stats);
  const requestCancel     = useVoiceStore(s => s.requestCancel);
  const voiceCancelable   = voiceStats.visible || voiceStats.phase !== 'idle' || voiceStats.chunksPending > 0;

  const phaseColor =
    voiceStats.phase === 'listening'    ? 'text-cyan-300 bg-cyan-500/10'
    : voiceStats.phase === 'transcribing' ? 'text-yellow-300 bg-yellow-500/10'
    : 'text-slate-700';

  const mode = normalizedVoiceMode(audioConfig?.interactionMode);

  return (
    <div className={`flex items-stretch h-full border-l border-white/[0.06] ${audioModeBusy ? 'opacity-60' : ''}`}>
      {/* Waveform / audio level indicator */}
      <div className={`flex items-center gap-1 px-2.5 border-r border-white/[0.06] transition-colors ${phaseColor}`} title={voiceStats.error ?? 'BrainVoice'}>
        {voiceStats.phase === 'idle'
          ? <MicOff size={12} className="text-slate-700" />
          : <Mic size={12} />
        }
        <div className="flex items-end gap-[2px] h-3">
          {voiceStats.levels.slice(-8).map((level: number, i: number) => (
            <span key={i}
              className={`w-[2px] rounded-full transition-all duration-75 ${voiceStats.phase === 'listening' ? 'bg-cyan-400/80' : voiceStats.phase === 'transcribing' ? 'bg-yellow-400/80' : 'bg-slate-800'}`}
              style={{ height: `${Math.max(2, Math.round(level * 12))}px` }}
            />
          ))}
        </div>
      </div>

      {/* Cancel button */}
      {voiceCancelable && (
        <button onClick={requestCancel}
          className="px-2 flex items-center text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border-r border-white/[0.06] focus:outline-none transition-all"
          title="Cancelar BrainVoice"
        ><X size={10} strokeWidth={1.8} /></button>
      )}

      {/* Coding / Chat mode toggle */}
      <button onClick={onToggleMode}
        className="px-2.5 flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-white hover:bg-white/5 transition-all focus:outline-none cursor-pointer"
        title={mode === 'coding' ? 'Modo Coding — clique para Chat' : 'Modo Chat — clique para Coding'}
      >
        <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${mode === 'coding' ? 'bg-red-500' : 'bg-indigo-500'}`} />
        {mode === 'coding' ? 'CODE' : 'CHAT'}
      </button>
    </div>
  );
}

// ─── Workspace Header ─────────────────────────────────────────────────────────
function WorkspaceHeader() {
  const tabs             = useNavStore(s => s.tabs) as any[];
  const activeTabIndex   = useNavStore(s => s.activeTabIndex);
  const onHome           = useNavStore(s => s.onHome);
  const goHome           = useNavStore(s => s.goHome);
  const setActiveTab     = useNavStore(s => s.setActiveTab);
  const moveTab          = useNavStore(s => s.moveTab);
  const closeTab         = useNavStore(s => s.closeTab);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);

  const addPane          = usePanesStore(s => s.addPane);
  const authEmail        = useAuthStore(s => s.email);
  const providers        = useProvidersStore(s => s.providers) as any[];
  const loadProviders    = useProvidersStore(s => s.load);

  const tasksVisible = useTasksStore(s => s.visible);
  const tasksCount   = useTasksStore(s => s.list.length);
  const toggleTasks  = useTasksStore(s => s.toggle);

  const memoryVisible = useMemoryStore(s => s.visible);
  const toggleMemory  = useMemoryStore(s => s.toggle);

  const costVisible = useCostStore(s => s.visible);
  const toggleCost  = useCostStore(s => s.toggle);

  const appZoom          = useTerminalSettings(s => s.appZoom);
  const increaseAppZoom  = useTerminalSettings(s => s.increaseAppZoom);
  const decreaseAppZoom  = useTerminalSettings(s => s.decreaseAppZoom);
  const resetAppZoom     = useTerminalSettings(s => s.resetAppZoom);

  const m = useModals();

  const [showAccount,   setShowAccount]   = React.useState(false);
  const [showPaneMenu,  setShowPaneMenu]  = React.useState(false);
  const [profile,       setProfile]       = React.useState<any>(null);
  const [savedPanes,    setSavedPanes]    = React.useState<any[]>([]);
  const [snapshotBusy,  setSnapshotBusy]  = React.useState(false);
  const [permMode,      setPermMode]      = React.useState(() => localStorage.getItem('codebrain.permissionMode') ?? 'bypassPermissions');
  const [audioConfig,   setAudioConfig]   = React.useState<any>(null);
  const [audioModeBusy, setAudioModeBusy] = React.useState(false);
  const [dragIndex,     setDragIndex]     = React.useState<number|null>(null);
  const [dropIndex,     setDropIndex]     = React.useState<number|null>(null);

  const accountRef  = React.useRef<HTMLDivElement>(null);
  const paneMenuRef = React.useRef<HTMLDivElement>(null);

  const activeTab       = !onHome ? tabs[activeTabIndex] : undefined;
  const activeWorkspace = activeTab?.workspacePath as string | undefined;
  const isMapView       = activeTab?.view?.kind === 'map';
  const isFilesView     = activeTab?.view?.kind === 'files';

  // ── Effects ──────────────────────────────────────────────────────────────
  React.useEffect(() => { loadProviders(); }, [loadProviders]);
  React.useEffect(() => { localStorage.setItem('codebrain.permissionMode', permMode); }, [permMode]);

  const refreshAudio = React.useCallback(() => {
    const api = (window as any).codeBrainApp?.audio;
    if (!api) { setAudioConfig(null); return; }
    api.getConfig().then((c: any) => setAudioConfig(c)).catch(() => setAudioConfig(null));
  }, []);
  React.useEffect(() => { refreshAudio(); }, [refreshAudio]);
  React.useEffect(() => { if (!m.showSettings) refreshAudio(); }, [m.showSettings, refreshAudio]);

  React.useEffect(() => {
    if (!showAccount) return;
    const h = (e: MouseEvent) => { if (accountRef.current && !accountRef.current.contains(e.target as Node)) setShowAccount(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showAccount]);

  React.useEffect(() => {
    if (!showPaneMenu) return;
    const h = (e: MouseEvent) => { if (paneMenuRef.current && !paneMenuRef.current.contains(e.target as Node)) setShowPaneMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showPaneMenu]);

  React.useEffect(() => {
    if (!showAccount) return;
    (window as any).codeBrainApp?.auth?.profile?.()
      .then((p: any) => setProfile({ plan: p.plan, status: p.status, periodEnd: p.periodEnd }))
      .catch(() => {});
  }, [showAccount]);

  // Load saved panes when pane menu opens
  React.useEffect(() => {
    if (!showPaneMenu || !activeWorkspace) return;
    const loadSaved = (window as any).codeBrainApp?.session?.loadAll;
    if (!loadSaved) { setSavedPanes([]); return; }
    Promise.all([
      loadSaved(activeWorkspace).catch(() => []),
      (window as any).codeBrainApp?.claude?.sessions?.(activeWorkspace).catch(() => []) ?? Promise.resolve([]),
    ]).then(([saved, claude]: [any[], any[]]) => {
      const all: any[] = [];
      for (const s of saved) for (const p of s.panes) all.push({ ...p, savedAt: s.savedAt });
      for (const s of claude) all.push({ id: s.paneId ?? s.sessionId, agent: 'openclaude', cwd: s.cwd, lastLines: s.summary ? [s.summary] : [], session: s.session ?? { provider: 'claude', id: s.sessionId, capturedAt: s.savedAt ?? s.lastUsedAt ?? s.firstSeenAt, confidence: 'high', source: 'transcript-file' }, claudeSessionId: s.sessionId, providerId: s.providerId, model: s.model, summary: s.summary, savedAt: s.savedAt ?? s.lastUsedAt ?? s.firstSeenAt });
      const byKey = new Map<string,any>();
      for (const p of all) { const sess = p.session ?? (p.claudeSessionId ? { provider: 'claude', id: p.claudeSessionId } : undefined); const key = sess ? `${sess.provider}:${sess.id}` : `${p.agent}:${p.id}`; const ex = byKey.get(key); if (!ex || p.savedAt > ex.savedAt) byKey.set(key, p); }
      setSavedPanes([...byKey.values()].sort((a,b) => b.savedAt - a.savedAt));
    }).catch(() => setSavedPanes([]));
  }, [showPaneMenu, activeWorkspace]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const r = await (window as any).codeBrainApp?.session?.saveSnapshot(activeWorkspace);
      if (r?.ok) (window as any).codeBrainApp?.notify?.('Sessão salva', 'Snapshot salvo.');
    } finally { setSnapshotBusy(false); }
  };

  const handleRestore = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const r = await (window as any).codeBrainApp?.session?.loadSnapshot(activeWorkspace);
      if (!r?.ok || !r.snapshot) return;
      const orch = await (window as any).codeBrainApp?.pty?.spawn({ agent: 'openclaude', cwd: activeWorkspace, role: 'orchestrator', permissionMode: permMode, sessionContext: r.snapshot.orchestratorPrompt });
      if (orch?.ok && orch.paneId) addPane({ id: orch.paneId, agent: 'openclaude', cwd: activeWorkspace, workspacePath: activeWorkspace, externallySpawned: true });
    } finally { setSnapshotBusy(false); }
  };

  const handleRestorePane = async (pane: any) => {
    const restProv = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;
    const env: Record<string,string> = { ...(restProv?.env ?? {}), ...(pane.model ? { ANTHROPIC_MODEL: pane.model, MODEL: pane.model } : {}) };
    const r = await (window as any).codeBrainApp?.pty.spawn({ paneId: pane.id, agent: pane.agent, cwd: pane.cwd, args: pane.args, session: pane.session, claudeSessionId: pane.claudeSessionId, providerId: pane.providerId, model: pane.model, ...(Object.keys(env).length ? { env } : {}) });
    if (r?.ok && r.paneId) addPane({ id: r.paneId, agent: pane.agent, cwd: pane.cwd, args: pane.args, workspacePath: activeWorkspace, session: pane.session, claudeSessionId: pane.claudeSessionId, lastLines: pane.lastLines, providerId: pane.providerId, model: pane.model, externallySpawned: true });
    if (usePanesStore.getState().panes.find((p: any) => p.session?.provider === pane.session?.provider && p.session?.id === pane.session?.id)) {
      usePanesStore.getState().setActive(usePanesStore.getState().panes.find((p: any) => p.session?.id === pane.session?.id)?.id!);
    }
  };

  const handleToggleAudioMode = async () => {
    if (!audioConfig || audioModeBusy) return;
    setAudioModeBusy(true);
    const cur     = normalizedVoiceMode(audioConfig.interactionMode);
    const newMode = cur === 'coding' ? 'conversation' : 'coding';
    const patch   = { interactionMode: newMode, outputMode: outputModeForInteractionMode(newMode) };
    setAudioConfig((c: any) => c ? { ...c, ...patch } : c);
    try {
      const res = await (window as any).codeBrainApp?.audio?.saveConfig(patch);
      if (res?.ok && res.config) setAudioConfig(res.config); else refreshAudio();
    } finally { setAudioModeBusy(false); }
  };

  const handleSpawnSquad = useWorkspaceSquadSpawner();

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="h-[38px] w-full shrink-0 flex relative z-[60]" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex-1" />
        {/* Adicionado o padding na margem direita de 140px por conta dos botões window controls nativos do Electron/Windows */}
        <div className="w-[140px] shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any} />
      </div>
      
      {/* ── Main header row ───────────────────────────────────────── */}
      <div
        className="h-12 border-b border-white/[0.06] flex items-stretch bg-[#0F0F13] shrink-0 overflow-x-auto relative"
        style={{ WebkitAppRegion: 'drag', scrollbarWidth: 'none' } as React.CSSProperties}
      >
        {/* Brand / Home */}
        <button
          onClick={goHome}
          className={`shrink-0 px-4 flex items-center gap-2.5 border-r border-white/[0.06] focus:outline-none group transition-all cursor-pointer ${onHome ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]'}`}
          style={{ WebkitAppRegion: 'no-drag', minWidth: 120 } as React.CSSProperties}
          title="Home"
        >
          <Logo size={16} />
          <span className={`font-mono text-[9px] font-bold tracking-[0.2em] transition-colors ${onHome ? 'text-indigo-400' : 'text-slate-700 group-hover:text-indigo-300'}`}>
            CODEBRAIN
          </span>
        </button>

        {/* Workspace Tabs */}
        <div className="flex items-stretch min-w-0 overflow-x-auto" style={{ WebkitAppRegion: 'no-drag', scrollbarWidth: 'none' } as React.CSSProperties}>
          {tabs.map((tab: any, i: number) => {
            const isActive   = !onHome && i === activeTabIndex;
            const label      = tabLabel(tab);
            const isMissing  = tab.missing === true;
            const isDragging = dragIndex === i;
            const isTarget   = dropIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <div
                key={tab.id ?? i}
                draggable
                onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                onDragOver={e  => { if (dragIndex === null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropIndex !== i) setDropIndex(i); }}
                onDragLeave={() => { if (dropIndex === i) setDropIndex(null); }}
                onDrop={e      => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) moveTab(dragIndex, i); setDragIndex(null); setDropIndex(null); }}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                onClick={() => setActiveTab(i)}
                title={tab.workspacePath}
                className={`group relative flex items-center gap-1.5 px-4 cursor-pointer shrink-0 min-w-0 max-w-[160px] border-r border-white/[0.06] select-none transition-all
                  ${isActive ? 'bg-indigo-500/[0.06] text-slate-100 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-violet-500' : isMissing ? 'text-slate-700' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'}
                  ${isDragging ? 'opacity-40' : ''}
                  ${isTarget ? 'bg-indigo-500/10' : ''}`}
                style={{ height: 48 }}
              >
                <span className="font-mono text-[10px] font-medium truncate">{isMissing ? `${label} ×` : label}</span>
                <button
                  onClick={e => { e.stopPropagation(); closeTab(i); }}
                  className="shrink-0 w-3.5 h-3.5 rounded flex items-center justify-center opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:bg-white/10 text-slate-600 hover:text-slate-200 transition-all focus:outline-none"
                >
                  <X size={9} strokeWidth={1.8} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

        {/* ── Right toolbar ──────────────────────────────────────── */}
        <div className="flex items-stretch shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>

          {/* Tasks */}
          <IconBtn icon={<ListTodo size={15} strokeWidth={1.5} />} label="Tasks" onClick={toggleTasks} active={tasksVisible} badge={tasksCount} />

          {/* Memory */}
          <IconBtn icon={<Database size={15} strokeWidth={1.5} />} label="Memory" onClick={toggleMemory} active={memoryVisible} />

          {/* Usage */}
          <IconBtn icon={<DollarSign size={15} strokeWidth={1.5} />} label="Token Usage" onClick={toggleCost} active={costVisible} />
          <VDiv />

          {/* Session Map */}
          {activeWorkspace && (
            <IconBtn icon={<Map size={15} strokeWidth={1.5} />} label="Session Map" onClick={() => navigateInActiveTab(isMapView ? { kind: 'workspace' } : { kind: 'map' })} active={isMapView} />
          )}

          {/* Files */}
          {activeWorkspace && (
            <IconBtn icon={<FolderTree size={15} strokeWidth={1.5} />} label="Files" onClick={() => navigateInActiveTab(isFilesView ? { kind: 'workspace' } : { kind: 'files' })} active={isFilesView} />
          )}
          {activeWorkspace && <VDiv />}

          {/* Save Session */}
          {activeWorkspace && (
            <IconBtn icon={<Save size={15} strokeWidth={1.5} />} label="Salvar Sessão" onClick={handleSave} disabled={snapshotBusy} />
          )}

          {/* Restore Session */}
          {activeWorkspace && (
            <IconBtn icon={<RotateCcw size={15} strokeWidth={1.5} />} label="Restaurar Sessão" onClick={handleRestore} disabled={snapshotBusy} />
          )}

          {activeWorkspace && <VDiv />}

          {/* Audio / Voice mode indicator */}
          {activeWorkspace && audioConfig && (
            <AudioIndicator audioConfig={audioConfig} audioModeBusy={audioModeBusy} onToggleMode={handleToggleAudioMode} />
          )}

          {/* + PANE */}
          {activeWorkspace && (
            <div ref={paneMenuRef} className="flex items-stretch shrink-0">
              <VDiv />
              <button
                onClick={() => setShowPaneMenu(v => !v)}
                className={`px-3 flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-widest focus:outline-none transition-all border-l border-white/[0.06] cursor-pointer ${showPaneMenu ? 'text-indigo-300 bg-indigo-500/10' : 'text-indigo-400/70 hover:text-indigo-300 hover:bg-indigo-500/[0.06]'}`}
                title="Novo terminal / Restaurar sessão"
              >
                <Plus size={12} strokeWidth={2.5} /> TERMINAL
              </button>
              {showPaneMenu && (
                <PaneMenu
                  onClose={() => setShowPaneMenu(false)}
                  activeWorkspace={activeWorkspace}
                  permissionMode={permMode}
                  setPermissionMode={setPermMode}
                  savedPanes={savedPanes}
                  snapshotBusy={snapshotBusy}
                  onSave={handleSave}
                  onRestore={handleRestore}
                  onRestorePane={handleRestorePane}
                />
              )}
            </div>
          )}

          <VDiv />

          {/* Account */}
          <div ref={accountRef} className="relative">
            <button
              onClick={() => setShowAccount(v => !v)}
              className="h-full px-3 flex items-center gap-1.5 text-slate-600 hover:text-slate-300 hover:bg-white/[0.03] transition-all focus:outline-none cursor-pointer"
              title="Conta"
            >
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/25 flex items-center justify-center">
                <span className="font-mono text-[9px] font-bold text-indigo-400">{authEmail?.slice(0,1).toUpperCase() ?? '?'}</span>
              </div>
            </button>
            {showAccount && (
              <AccountDropdown
                profile={profile}
                authEmail={authEmail}
                activeWorkspace={activeWorkspace}
                modals={m}
                onClose={() => setShowAccount(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Files Navbar ──────────────────────────────────────────── */}
      {isFilesView && activeWorkspace && <FilesNavBar workspacePath={activeWorkspace} />}

      <Modals modals={m} activeWorkspace={activeWorkspace} />
    </>
  );
}

// ─── AppHeader ────────────────────────────────────────────────────────────────
export function AppHeader() {
  const onHome = useNavStore(s => s.onHome);
  const tabs   = useNavStore(s => s.tabs);
  return onHome || (tabs as any[]).length === 0 ? <HomeHeader /> : <WorkspaceHeader />;
}
