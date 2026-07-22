import React from 'react';
import { nanoid } from 'nanoid';
import {
  X, Plus, Settings, Activity, FolderOpen, Save, RotateCcw,
  ListTodo, Terminal, Globe, Users, Zap, Map, FileText,
  ChevronRight, ChevronDown, Home, Mic, MicOff, Volume2,
  Shield, Lock, Unlock, Cpu, MoreHorizontal, FolderTree, ArrowLeft, Database, History,
  Bell, Search, Download, FileJson, UserCircle2,
  GitPullRequest, SlidersHorizontal, Smartphone,
  Clock, UtensilsCrossed,
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
import { useSessionHistoryStore } from '../../stores/session-history-store';
import { useVoiceStore } from '../../stores/voice-store';
import { useBrowserStore } from '../../stores/browser-store';
import { useTerminalSettings } from '../../stores/terminal-settings-store';
import { useRecipeStore } from '../../stores/recipe-store';
import { useCronStore } from '../../stores/cron-store';
import { useRemoteBridgeStore } from '../../stores/remote-bridge-store';
import { ProvidersModal } from '../providers/ProvidersModal';
import { SquadModal, SquadWizard } from '../squads/SquadModal';
import { DiagnosticsModal } from '../diagnostics/DiagnosticsModal';
import { MissionsMenu } from './MissionsMenu';
import { NotificationsBell } from './NotificationsPanel';
import { useNotificationsStore } from '../../stores/notifications-store';
import { notify } from '../../lib/notify';
import { PerfHUD } from './PerfHUD';
import { LibreWizard } from '../squads/LibreWizard';
import { resolveSpawnTarget, HOST_LABELS } from '../../lib/resolve-spawn-target';

// ─── Shared modal-state hook ──────────────────────────────────────────────────
function useModals() {
  const [showProviders, setShowProviders] = React.useState(false);
  const [providersStep, setProvidersStep] = React.useState('list');
  const [showSquad, setShowSquad] = React.useState(false);
  const [showSquadWizard, setShowSquadWizard] = React.useState(false);
  const [showDiag, setShowDiag] = React.useState(false);
  const [showPerfHUD, setShowPerfHUD] = React.useState(false);
  const [showLibreWizard, setShowLibreWizard] = React.useState(false);

  // Ctrl+Shift+M toggles Performance HUD
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        setShowPerfHUD(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openProviders = (step = 'list') => { setProvidersStep(step); setShowProviders(true); };
  const closeProviders = () => { setShowProviders(false); setProvidersStep('list'); };

  return {
    showProviders, openProviders, closeProviders, providersStep,
    showSquad, setShowSquad,
    showSquadWizard, setShowSquadWizard,
    showDiag, setShowDiag,
    showPerfHUD, setShowPerfHUD,
    showLibreWizard, setShowLibreWizard,
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
          ? 'text-violet-400 bg-violet-500/10'
          : danger
            ? 'text-slate-600 hover:text-red-400 hover:bg-red-500/5'
            : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04]'}`}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="absolute top-1.5 right-0.5 font-mono text-[9px] font-bold bg-violet-500 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────
const VDiv = () => <div className="w-px h-5 bg-violet-500/10 shrink-0 self-center" />;

// ─── Shared global-action controls (used by BOTH Home & Workspace headers) ────
// Reads/writes the same preferredAgent as HomeHeader — single source of truth.
function PreferredAgentDropdown() {
  const [preferredAgent, setPreferredAgent] = React.useState<string | null>(() => {
    try { return localStorage.getItem('codebrain.preferredAgent') || null; } catch { return null; }
  });
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: any) => setPreferredAgent(e?.detail?.preferredAgent ?? null);
    window.addEventListener('preferred-agent-changed', handler);
    return () => window.removeEventListener('preferred-agent-changed', handler);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pick = (host: string | null) => {
    setPreferredAgent(host);
    if (host) localStorage.setItem('codebrain.preferredAgent', host);
    else localStorage.removeItem('codebrain.preferredAgent');
    window.dispatchEvent(new CustomEvent('preferred-agent-changed', { detail: { preferredAgent: host } }));
    (window as any).codeBrainApp?.appConfig?.get?.().then((cfg: any) => {
      (window as any).codeBrainApp?.appConfig?.set?.({ ...cfg, preferredAgent: host ?? undefined });
    }).catch(() => {});
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[9px] font-mono font-bold uppercase tracking-widest transition-all cursor-pointer ${
          preferredAgent ? 'border-indigo-500/30 text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10' : 'border-white/10 text-slate-600 hover:text-slate-400 hover:border-white/20'
        }`}
        title="Agent/CLI Preferido"
      >
        <Cpu size={10} />
        {preferredAgent ? HOST_LABELS[preferredAgent]?.split(' ')[0] ?? preferredAgent : 'Auto'}
        <ChevronDown size={9} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-[#12121A] border border-white/10 shadow-2xl py-1 z-[100]">
          {[null, 'claude', 'openclaude', 'gemini', 'codex'].map(host => (
            <button key={host ?? 'auto'} onClick={() => pick(host)}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors ${
                preferredAgent === host ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {host ? HOST_LABELS[host] : 'Automático (nenhum)'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProvidersButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:text-violet-300 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all cursor-pointer"
      title="Providers"
    ><Zap size={11} /> Providers</button>
  );
}

function SquadButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:text-violet-300 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all cursor-pointer"
      title="Squad"
    ><Users size={11} /> Squad</button>
  );
}

// Compact single-button menu for the WorkspaceHeader so the global actions
// (Providers / Preferred Agent / Squad) don't crowd the bar or hide the tabs.
function GlobalActionsMenu({ onProviders, onSquad }: { onProviders: () => void; onSquad: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [preferredAgent, setPreferredAgent] = React.useState<string | null>(() => {
    try { return localStorage.getItem('codebrain.preferredAgent') || null; } catch { return null; }
  });
  const ref = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = React.useState<{ top: number; right: number } | null>(null);

  React.useEffect(() => {
    if (!open || !btnRef.current) { setMenuPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  React.useEffect(() => {
    const handler = (e: any) => setPreferredAgent(e?.detail?.preferredAgent ?? null);
    window.addEventListener('preferred-agent-changed', handler);
    return () => window.removeEventListener('preferred-agent-changed', handler);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const setAgent = (host: string | null) => {
    setPreferredAgent(host);
    if (host) localStorage.setItem('codebrain.preferredAgent', host);
    else localStorage.removeItem('codebrain.preferredAgent');
    window.dispatchEvent(new CustomEvent('preferred-agent-changed', { detail: { preferredAgent: host } }));
    (window as any).codeBrainApp?.appConfig?.get?.().then((cfg: any) => {
      (window as any).codeBrainApp?.appConfig?.set?.({ ...cfg, preferredAgent: host ?? undefined });
    }).catch(() => {});
  };

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        className={`px-3 flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-widest focus:outline-none transition-all cursor-pointer ${open ? 'text-violet-300 bg-violet-500/10' : 'text-slate-600 hover:text-violet-300 hover:bg-violet-500/[0.06]'}`}
        title="Providers · Agent Preferido · Squad"
      >
        <SlidersHorizontal size={13} strokeWidth={1.8} />
        <ChevronDown size={9} />
      </button>
      {open && menuPos && (
        <div
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
          className="w-56 rounded-xl bg-[#12121A] border border-white/10 shadow-2xl py-1.5 z-[99999]">
          <button onClick={() => { onProviders(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-300 hover:bg-white/5 transition-colors">
            <Zap size={12} className="text-violet-400" /> Providers
          </button>
          <button onClick={() => { onSquad(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-slate-300 hover:bg-white/5 transition-colors">
            <Users size={12} className="text-violet-400" /> Squad
          </button>
          <div className="my-1 border-t border-white/[0.06]" />
          <div className="px-3 py-1 text-[9px] font-mono uppercase tracking-widest text-slate-600 flex items-center gap-1.5">
            <Cpu size={10} /> Agent/CLI Preferido
          </div>
          {[null, 'claude', 'openclaude', 'gemini', 'codex'].map(host => (
            <button key={host ?? 'auto'} onClick={() => setAgent(host)}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors ${
                preferredAgent === host ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {host ? HOST_LABELS[host] : 'Automático (nenhum)'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Home Header ─────────────────────────────────────────────────────────────
function HomeHeader() {
  const { route, navigate } = useRouter();
  const tabs = useNavStore(s => s.tabs);
  const goHome = useNavStore(s => s.goHome);
  const authEmail = useAuthStore(s => s.email);
  const activeWorkspace = tabs[(useNavStore(s => s.activeTabIndex))]?.workspacePath as string | undefined;

  const recipesVisible = useRecipeStore(s => s.visible);
  const toggleRecipes = useRecipeStore(s => s.toggle);
  const cronVisible = useCronStore(s => s.visible);
  const toggleCron = useCronStore(s => s.toggle);

  const m = useModals();
  const [showAccount, setShowAccount] = React.useState(false);
  const [preferredAgent, setPreferredAgent] = React.useState<string | null>(() => {
    try { return localStorage.getItem('codebrain.preferredAgent') || null; } catch { return null; }
  });
  const [showPrefAgent, setShowPrefAgent] = React.useState(false);
  const prefAgentRef = React.useRef<HTMLDivElement>(null);

  // Sync with Settings changes
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.preferredAgent !== undefined) setPreferredAgent(detail.preferredAgent);
    };
    window.addEventListener('preferred-agent-changed', handler);
    return () => window.removeEventListener('preferred-agent-changed', handler);
  }, []);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!showPrefAgent) return;
    const h = (e: MouseEvent) => { if (prefAgentRef.current && !prefAgentRef.current.contains(e.target as Node)) setShowPrefAgent(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showPrefAgent]);
  const [profile, setProfile] = React.useState<any>(null);
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
      .catch(() => { });
  }, [showAccount]);

  const NAV: { label: string; href: '/' | '/workspaces' | '/settings' }[] = [
    { label: 'Dashboard', href: '/' },
    { label: 'Workspaces', href: '/workspaces' },
  ];

  return (
    <>

      <header
        className="h-14 border-b border-white/[0.04] grid items-center px-6 shrink-0 z-50 relative cb-header"
        style={{ gridTemplateColumns: '1fr auto 1fr', WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Brand */}
        <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Link href="/" className="flex items-center gap-2.5 group">
            <Logo size={22} />
            <span className="text-[14px] font-bold tracking-tight text-white">
              Codebrain <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">OS</span>
            </span>
          </Link>
        </div>

        {/* Nav — truly centered via grid middle column */}
        <nav className="hidden lg:flex items-center gap-5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {NAV.map(item => (
            <Link key={item.href} href={item.href}
              className={`text-[13px] font-medium transition-colors pb-0.5 border-b-2 ${route === item.href ? 'text-violet-400 border-violet-500 [text-shadow:0_0_12px_rgba(167,139,250,0.45)]' : 'text-slate-400 hover:text-white border-transparent'}`}
            >{item.label}</Link>
          ))}
          <Link href="/settings"
            className={`px-2.5 py-1 border rounded text-[10px] font-mono tracking-widest transition-colors ${route === '/settings' ? 'bg-[#9d4edd]/20 border-[#9d4edd]/40 text-[#9d4edd]' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'}`}
          >SETTINGS</Link>
        </nav>

        {/* Right */}
        <div className="flex items-center gap-2 justify-end" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Notification bell */}
          <NotificationsBell />

          {/* Remote Playback (mobile control) */}
          <button
            onClick={() => useRemoteBridgeStore.getState().toggle()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-indigo-700/30 text-indigo-500/70 text-[10px] font-bold uppercase tracking-widest hover:text-indigo-300 hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all cursor-pointer"
            title="Remote Playback — controle via celular"
          >
            <Smartphone size={11} />
            Remote
          </button>

          {/* Recipes (harness) */}
          <button
            onClick={toggleRecipes}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${
              recipesVisible
                ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                : 'border-indigo-700/30 text-indigo-500/70 hover:text-indigo-300 hover:border-indigo-500/50 hover:bg-indigo-500/10'
            }`}
            title="Recipes — what can I build?"
          >
            <UtensilsCrossed size={11} />
            Recipes
          </button>

          {/* Cron (scheduled jobs) */}
          <button
            onClick={toggleCron}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${
              cronVisible
                ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10'
                : 'border-indigo-700/30 text-indigo-500/70 hover:text-indigo-300 hover:border-indigo-500/50 hover:bg-indigo-500/10'
            }`}
            title="Cron — scheduled autonomous tasks"
          >
            <Clock size={11} />
            Cron
          </button>

          {/* Providers (shared) */}
          <ProvidersButton onClick={() => m.openProviders('list')} />

          {/* Preferred Agent dropdown (shared) */}
          <PreferredAgentDropdown />

          {/* Squad (shared) */}
          <SquadButton onClick={() => m.setShowSquadWizard(true)} />

          {/* Libre Mode */}
          <button onClick={() => m.setShowLibreWizard(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-700/30 text-violet-500/70 text-[10px] font-bold uppercase tracking-widest hover:text-violet-300 hover:border-violet-500/50 hover:bg-violet-500/10 transition-all cursor-pointer"
          ><Zap size={11} /> Libre</button>

          {/* Back to workspace */}
          {tabs.length > 0 && (
            <button
              onClick={() => useNavStore.getState().setActiveTab(useNavStore.getState().activeTabIndex)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500/20 hover:shadow-[0_0_12px_rgba(139,92,246,0.15)] transition-all cursor-pointer"
            ><Activity size={11} /> Workspace</button>
          )}

          {/* Account */}
          <div ref={accountRef} className="relative">
            <button onClick={() => setShowAccount(v => !v)}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/25 flex items-center justify-center hover:from-indigo-500/30 hover:to-violet-500/30 hover:shadow-[0_0_12px_rgba(99,102,241,0.2)] transition-all cursor-pointer"
            >
              {authEmail
                ? <span className="font-mono text-[9px] font-bold text-indigo-400">{authEmail.slice(0, 1).toUpperCase()}</span>
                : <UserCircle2 size={16} className="text-indigo-400/80" />
              }
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
    ...(activeWorkspace ? [{ label: '⬡ Squad', action: () => { onClose(); m.setShowSquad(true); }, icon: <Users size={11} /> }] : []),
    { label: '⚙ Configurações', action: () => { onClose(); goHome(); navigate('/settings'); }, icon: <Settings size={11} /> },
    { label: '⚡ Diagnóstico', action: () => { onClose(); m.setShowDiag(true); }, icon: <Activity size={11} /> },
    { label: 'Sair', action: () => { onClose(); (window as any).codeBrainApp?.auth?.logout?.(); }, danger: true },
  ];

  return (
    <div className="fixed right-2 top-[90px] w-64 bg-[#0c0c14]/95 border border-white/[0.08] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-[10000] overflow-hidden backdrop-blur-md">
      <div className="px-4 py-3 border-b border-white/5">
        <p className="font-mono text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Conta</p>
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

  const addPane = usePanesStore(s => s.addPane);
  const providers = useProvidersStore(s => s.providers) as any[];
  const permMode = localStorage.getItem('codebrain.permissionMode') ?? 'bypassPermissions';

  const handleLibreSpawn = React.useCallback(async (payload: { orchestrator: { providerId: string; model: string }; workers: any[] }) => {
    const workspace = activeWorkspace;
    if (!workspace) return;
    const pty = (window as any).codeBrainApp?.pty;
    if (!pty) return;
    const activityId = nanoid(8);
    const preferredAgent = (() => { try { return localStorage.getItem('codebrain.preferredAgent') || undefined; } catch { return undefined; } })();
    const providerDefaultModels: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem('codebrain.providerDefaultModels') ?? '{}'); } catch { return {}; } })();

    // ── Spawn workers first ──
    const workerIds: string[] = [];
    for (const slot of payload.workers) {
      for (let i = 0; i < slot.count; i++) {
        const target = resolveSpawnTarget({
          providerId: slot.providerId,
          model: slot.model,
          providers,
          preferredAgent,
          providerDefaultModels,
        });
        const r = await pty.spawn({
          agent: target.agent,
          cwd: workspace,
          activityId,
          providerId: target.providerId,
          model: target.model,
          permissionMode: permMode,
          role: 'worker',
        });
        if (r?.ok && r.paneId) {
          workerIds.push(r.paneId);
          addPane({ id: r.paneId, agent: target.agent, cwd: workspace, workspacePath: workspace, activityId, providerId: target.providerId, model: target.model, externallySpawned: true });
        }
      }
    }

    // ── Spawn orchestrator with role=orchestrator + SQUAD_WORKER_IDS ──
    if (workerIds.length > 0) {
      const orchTarget = resolveSpawnTarget({
        providerId: payload.orchestrator.providerId,
        model: payload.orchestrator.model,
        providers,
        preferredAgent,
        providerDefaultModels,
      });
      const orchRes = await pty.spawn({
        agent: orchTarget.agent,
        cwd: workspace,
        activityId,
        providerId: orchTarget.providerId,
        model: orchTarget.model,
        permissionMode: permMode,
        role: 'orchestrator',
        env: { SQUAD_WORKER_IDS: workerIds.join(','), SQUAD_ACTIVITY_ID: activityId },
      });
      if (orchRes?.ok && orchRes.paneId)
        addPane({ id: orchRes.paneId, agent: orchTarget.agent, cwd: workspace, workspacePath: workspace, activityId, providerId: orchTarget.providerId, model: orchTarget.model, externallySpawned: true });
    }
  }, [activeWorkspace, addPane, permMode, providers]);

  return (
    <>
      <ProvidersModal open={m.showProviders} initialStep={m.providersStep} onClose={m.closeProviders} />
      <SquadModal open={m.showSquad} onClose={() => m.setShowSquad(false)} onSpawn={handleSpawnSquad} />
      <SquadWizard open={m.showSquadWizard} onClose={() => m.setShowSquadWizard(false)} onSpawn={handleSpawnSquad} />
      <DiagnosticsModal open={m.showDiag} activeWorkspace={activeWorkspace} onClose={() => m.setShowDiag(false)} />
      <LibreWizard open={m.showLibreWizard} onClose={() => m.setShowLibreWizard(false)} onSpawn={handleLibreSpawn} activeWorkspace={activeWorkspace} />
      <PerfHUD visible={m.showPerfHUD} />
    </>
  );
}

// ─── Squad spawner (shared logic) ────────────────────────────────────────────
function useWorkspaceSquadSpawner() {
  const addPane = usePanesStore(s => s.addPane);
  const providers = useProvidersStore(s => s.providers) as any[];
  const activeWorkspace = useNavStore(s => {
    const tabs = s.tabs as any[];
    const tab = tabs[s.activeTabIndex];
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
    const preferredAgent = (() => { try { return localStorage.getItem('codebrain.preferredAgent') || undefined; } catch { return undefined; } })();
    const providerDefaultModels: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem('codebrain.providerDefaultModels') ?? '{}'); } catch { return {}; } })();

    // ── Detect role from worker label ──
    const detectRole = (label: string): string => {
      const l = (label ?? '').toLowerCase();
      if (l.includes('tester') || l.includes('test')) return 'ui-tester';
      return 'worker';
    };

    // ── Spawn workers first ──
    const workers = squad.workers ?? (squad.worker ? [squad.worker] : []);
    const workerIds: string[] = [];
    for (const w of workers) {
      const target = resolveSpawnTarget({
        providerId: w.providerId,
        model: resolveValidModel(w.providerId, w.model),
        providers,
        preferredAgent,
        providerDefaultModels,
      });
      const role = detectRole(w.role ?? '');
      const r = await pty.spawn({ agent: target.agent, cwd: workspace, activityId, providerId: target.providerId, model: target.model, permissionMode: permMode, role });
      if (!r?.ok || !r.paneId) continue;
      workerIds.push(r.paneId);
      addPane({ id: r.paneId, agent: target.agent, cwd: workspace, workspacePath: workspace, activityId, providerId: target.providerId, model: target.model, externallySpawned: true });
    }
    if (!workerIds.length) return;

    // ── Spawn orchestrator with role=orchestrator ──
    const orchTarget = resolveSpawnTarget({
      providerId: squad.orchestrator.providerId,
      model: resolveValidModel(squad.orchestrator.providerId, squad.orchestrator.model),
      providers,
      preferredAgent,
      providerDefaultModels,
    });
    const orchRes = await pty.spawn({
      agent: orchTarget.agent, cwd: workspace, activityId,
      providerId: orchTarget.providerId, model: orchTarget.model,
      permissionMode: permMode, role: 'orchestrator',
      env: { SQUAD_WORKER_IDS: workerIds.join(','), SQUAD_ACTIVITY_ID: activityId }
    });
    if (orchRes?.ok && orchRes.paneId)
      addPane({ id: orchRes.paneId, agent: orchTarget.agent, cwd: workspace, workspacePath: workspace, activityId, providerId: orchTarget.providerId, model: orchTarget.model, externallySpawned: true });

    // Switch to the workspace tab after spawning
    const tabIdx = useNavStore.getState().tabs.findIndex((t: any) => t.workspacePath === workspace);
    if (tabIdx >= 0) useNavStore.getState().setActiveTab(tabIdx);
  }, [activeWorkspace, providers, addPane, permMode, resolveValidModel]);
}

// ─── Files navbar (path breadcrumb) ──────────────────────────────────────────
function FilesNavBar({ workspacePath }: { workspacePath: string }) {
  const parts = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  return (
    <div className="h-9 border-b border-white/5 bg-[#0F0F13]/80 flex items-center px-4 gap-2 shrink-0 overflow-x-auto"
      style={{ scrollbarWidth: 'none' } as React.CSSProperties}
    >
      <FolderTree size={12} className="text-[#5855e5] shrink-0" />
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


// ─── Static model pricing ($/1M tokens) — source: cost-tracker.js ───────────
const MODEL_PRICES: Record<string, { i: number; o: number }> = {
  // Claude (Anthropic OAuth / API)
  "claude-opus-4-8": { i: 5.0, o: 25.0 }, "claude-opus-4-7": { i: 5.0, o: 25.0 },
  "claude-opus-4-6": { i: 5.0, o: 25.0 },
  "claude-sonnet-4-6": { i: 3.0, o: 15.0 }, "claude-sonnet-4-5-20250929": { i: 3.0, o: 15.0 },
  "claude-haiku-4-5-20251001": { i: 1.0, o: 5.0 },
  // OpenRouter
  "anthropic/claude-3.5-sonnet": { i: 3.0, o: 15.0 }, "anthropic/claude-sonnet-4": { i: 3.0, o: 15.0 },
  "anthropic/claude-opus-4": { i: 15.0, o: 75.0 }, "anthropic/claude-opus-4.8": { i: 5.0, o: 25.0 },
  "anthropic/claude-opus-4.7": { i: 5.0, o: 25.0 },
  "openai/gpt-4o": { i: 2.5, o: 10.0 }, "openai/gpt-4.1": { i: 2.0, o: 8.0 },
  "openai/o3": { i: 2.0, o: 8.0 }, "openai/o4-mini": { i: 1.1, o: 4.4 },
  // Gemini 3+ (via API) — Gemini 2.x deprecated
  "gemini-3.5-flash": { i: 1.5, o: 9.0 }, "gemini-3.1-pro-preview": { i: 2.0, o: 12.0 },
  "gemini-3.1-flash-lite": { i: 0.25, o: 1.5 }, "gemini-3-flash-preview": { i: 0.5, o: 3.0 },
  // MIMO
  "mimo-v2.5-pro": { i: 0.435, o: 0.87 }, "mimo-v2.5": { i: 0.14, o: 0.28 },
  "mimo-v2-pro": { i: 1.0, o: 3.0 }, "mimo-v2-omni": { i: 0.4, o: 2.0 },
  "mimo-v2-flash": { i: 0.1, o: 0.3 },
};
function modelPricingLabel(model: string, orPrices?: Record<string, { i: number; o: number }>): string | null {
  const lower = model.toLowerCase();
  // 1. Static table first
  const v = MODEL_PRICES[lower] ?? MODEL_PRICES[Object.keys(MODEL_PRICES).find(k => lower.includes(k)) ?? ""];
  if (v) return `IN $${v.i.toFixed(2)} / OUT $${v.o.toFixed(2)}`;
  // 2. Dynamic OpenRouter prices (fetched at runtime)
  if (orPrices) {
    const dv = orPrices[model] ?? orPrices[lower];
    if (dv) return `IN $${dv.i.toFixed(2)} / OUT $${dv.o.toFixed(2)}`;
  }
  return null;
}

// ─── + PANE Dropdown ─────────────────────────────────────────────────────────
function PaneMenu({
  onClose, activeWorkspace, permissionMode, setPermissionMode,
  savedPanes, snapshotBusy, onSave, onRestore, onRestorePane,
}: any) {
  const addPane = usePanesStore(s => s.addPane);
  const removePane = usePanesStore(s => s.removePane);
  const providers = useProvidersStore(s => s.providers) as any[];
  const detectedUrl = useBrowserStore(s => s.detectedUrl);
  const m = useModals();
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const favoritePane = React.useRef<any>(null);
  const [favLoaded, setFavLoaded] = React.useState(false);
  const [modelSearch, setModelSearch] = React.useState('');
  const [orPrices, setOrPrices] = React.useState<Record<string, { i: number; o: number }>>({});

  // Load OpenRouter pricing (uses 5-min backend cache — instant if already fetched)
  React.useEffect(() => {
    const hasOrProvider = providers.some((p: any) =>
      p.type === 'openai-compat' &&
      ((p.id ?? '').startsWith('openrouter') || (p.baseUrl ?? '').toLowerCase().includes('openrouter'))
    );
    if (!hasOrProvider) return;
    (window as any).codeBrainApp?.providers?.listOpenRouterModels?.()
      .then((r: any) => {
        if (r?.ok && r.models) {
          const map: Record<string, { i: number; o: number }> = {};
          for (const m of r.models) {
            if (m.pricing) map[m.id] = { i: m.pricing.prompt, o: m.pricing.completion };
          }
          setOrPrices(map);
        }
      })
      .catch(() => {});
  }, [providers]);
  const [collapsedProviders, setCollapsedProviders] = React.useState<Record<string, boolean>>(() => {
    // Collapse all providers by default if there are many (>= 2)
    return {};
  });
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Auto-focus search when opened; auto-expand providers when searching
  React.useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const toggleProvider = (pid: string) => {
    setCollapsedProviders(prev => ({ ...prev, [pid]: !prev[pid] }));
  };

  const isProviderCollapsed = (pid: string) => {
    // If user never toggled, default: collapse when there are >= 2 providers
    if (pid in collapsedProviders) return collapsedProviders[pid];
    return providers.length >= 2;
  };


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
    const rawPid = explicit ? providerId : favoritePane.current?.providerId;
    const rawModel = explicit ? model : favoritePane.current?.model;
    const preferredAgent = (() => { try { return localStorage.getItem('codebrain.preferredAgent') || undefined; } catch { return undefined; } })();

    const target = resolveSpawnTarget({
      providerId: rawPid,
      model: rawModel,
      providers,
      preferredAgent,
      explicit,
      favoriteAgent: favoritePane.current?.agent,
    });

    const envKeys = Object.keys(target.env);
    (window as any).codeBrainApp?.pty.spawn({ agent: target.agent, cwd: activeWorkspace, providerId: target.providerId, model: target.model, permissionMode, ...(envKeys.length ? { env: target.env } : {}) })
      .then((r: any) => { if (r?.ok && r.paneId) addPane({ id: r.paneId, agent: target.agent, cwd: activeWorkspace, workspacePath: activeWorkspace, providerId: target.providerId, model: target.model, permissionMode, externallySpawned: true }); })
      .catch(() => { });
  };

  const handleTerminal = () => {
    if (!activeWorkspace) return;
    onClose();
    navigateInActiveTab({ kind: 'workspace' });
    (window as any).codeBrainApp?.pty.spawn({ agent: 'shell', cwd: activeWorkspace })
      .then((r: any) => { if (r?.ok && r.paneId) addPane({ id: r.paneId, agent: 'shell', cwd: activeWorkspace, workspacePath: activeWorkspace, externallySpawned: true }); })
      .catch(() => { });
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
    { id: 'auto', label: 'Auto', cls: (a: boolean) => a ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'border-white/10 text-slate-600 hover:text-green-400' },
    { id: 'default', label: 'Pend', cls: (a: boolean) => a ? 'bg-white/10 text-slate-200 border-white/20' : 'border-white/10 text-slate-600 hover:text-slate-300' },
    { id: 'plan', label: 'Plan', cls: (a: boolean) => a ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'border-white/10 text-slate-600 hover:text-indigo-400' },
  ];

  // Sort providers intelligently:
  // 1. OAuth/native plan (claude-oauth) first
  // 2. Native CLI agents (codex, gemini-cli, kimi, cursor, copilot) — by model count desc
  // 3. Compat adapters (anthropic-compat, mimo-compat) — by model count desc
  // 4. Generic API / openai-compat — by model count desc
  const NATIVE_CLI_KEYWORDS = ['codex', 'gemini cli', 'gemini-cli', 'kimi', 'cursor', 'copilot', 'github'];
  const providerSortKey = (p: any): number => {
    if (p.type === 'oauth') return 0;
    const label = (p.label ?? '').toLowerCase();
    const isNativeCli = NATIVE_CLI_KEYWORDS.some(k => label.includes(k));
    if (isNativeCli) return 1;
    if (p.type === 'anthropic-compat' || p.type === 'mimo-compat') return 2;
    return 3;
  };
  const sortedProviders = [...providers].sort((a, b) => {
    const ga = providerSortKey(a), gb = providerSortKey(b);
    if (ga !== gb) return ga - gb;
    // within same group: more models first
    return (b.models?.length ?? 0) - (a.models?.length ?? 0);
  });

  // Filter models across all providers by search term
  const searchLower = modelSearch.trim().toLowerCase();
  const filteredProviders = sortedProviders.map(p => {
    const models = p.models ?? [];
    if (!searchLower) return { ...p, filteredModels: models };
    const filteredModels = models.filter((m: string) => m.toLowerCase().includes(searchLower));
    return { ...p, filteredModels };
  }).filter(p => !searchLower || p.filteredModels.length > 0 || (p.label as string).toLowerCase().includes(searchLower));

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
        <div className="px-3 pt-2 pb-1 border-t border-white/5 flex items-center gap-2">
          <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest">Agente</p>
          {providers.length > 0 && (
            <input
              ref={searchRef}
              value={modelSearch}
              onChange={e => setModelSearch(e.target.value)}
              placeholder="buscar modelo…"
              className="ml-auto flex-1 bg-white/[0.04] border border-white/[0.08] rounded px-2 py-0.5 font-mono text-[9px] text-slate-300 placeholder-slate-700 outline-none focus:border-indigo-500/40 focus:bg-indigo-500/5 transition-all"
              onKeyDown={e => e.key === 'Escape' && (modelSearch ? setModelSearch('') : onClose())}
            />
          )}
        </div>
        {providers.length === 0 && (
          <p className="px-3 py-2 font-mono text-[10px] text-slate-700">Nenhum provider configurado</p>
        )}
        {filteredProviders.map(p => {
          // Always pass the actual provider ID — backend needs it to resolve the correct provider.
          // For claude-oauth (Claude CLI), backend will use agent: "claude" with native OAuth.
          // For anthropic (API key), backend will use agent: "openclaude" with Anthropic provider.
          const pid = p.id;
          const models: string[] = p.filteredModels ?? [];
          const allModels: string[] = p.models ?? [];
          const collapsed = !searchLower && isProviderCollapsed(pid);
          return (
            <div key={p.id} className="border-b border-white/5">
              <button
                onClick={() => !searchLower && toggleProvider(pid)}
                className={`w-full px-3 pt-1.5 pb-1 flex items-center justify-between gap-2 transition-colors ${!searchLower ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-default'}`}
              >
                <span className="font-mono text-[10px] font-bold text-indigo-400 truncate">{p.label}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {allModels.length > 0 && (
                    <span className="font-mono text-[9px] text-slate-700">{allModels.length} modelo{allModels.length !== 1 ? 's' : ''}</span>
                  )}
                  {(() => {
                    const isPlanBased = p.type === 'oauth' ||
                      ['gemini', 'kimi', 'codex', 'copilot', 'cursor', 'antigravity'].includes(p.host ?? '') ||
                      NATIVE_CLI_KEYWORDS.some(k => (p.label ?? '').toLowerCase().includes(k));
                    // Only show "plano" badge if the label doesn't already make it obvious
                    const labelLower = (p.label ?? '').toLowerCase();
                    const labelAlreadySaysPlan = labelLower.includes('plano') || labelLower.includes('cli') ||
                      labelLower.includes('copilot') || labelLower.includes('cursor') || labelLower.includes('kimi');
                    if (isPlanBased && !labelAlreadySaysPlan) return <span className="font-mono text-[9px] text-violet-400/80">plano</span>;
                    if (!isPlanBased) return <span className="font-mono text-[9px] text-slate-600">API</span>;
                    return null;
                  })()}
                  {!searchLower && (
                    <span className={`font-mono text-[9px] text-slate-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
                  )}
                </div>
              </button>
              {!collapsed && (
                <>
                  {models.length === 0
                    ? <button onClick={() => handleAddPane(pid)} className="w-full text-left px-3 py-1 font-mono text-[10px] text-slate-300 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all cursor-pointer">+ default</button>
                    : models.map((model: string) => (
                      <button key={model} onClick={() => handleAddPane(pid, model)} className="w-full text-left px-5 py-1 font-mono text-[10px] text-slate-300 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all cursor-pointer">
                        <div className="truncate">+ {model}</div>
                        {modelPricingLabel(model, orPrices) && (
                          <div className="font-mono text-[10px] text-emerald-400/70 mt-0.5">{modelPricingLabel(model, orPrices)}</div>
                        )}
                      </button>
                    ))
                  }
                </>
              )}
            </div>
          );
        })}
        {searchLower && filteredProviders.length === 0 && (
          <p className="px-3 py-2 font-mono text-[10px] text-slate-700">Nenhum modelo encontrado</p>
        )}
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
                const ago = new Date(p.savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

        {/* Cleanup: close stuck/booting panes */}
        {(() => {
          const allPanes = usePanesStore.getState().panes as any[];
          const stuckPanes = allPanes.filter((p: any) =>
            p.status !== "running" && p.status !== "hibernated" && p.kind !== "browser"
          );
          if (stuckPanes.length === 0) return null;
          return (
            <>
              <p className="px-3 pt-2 pb-0.5 font-mono text-[9px] text-slate-600 uppercase tracking-widest">Limpeza</p>
              <button
                onClick={() => {
                  stuckPanes.forEach((p: any) => {
                    try { (window as any).codeBrainApp?.pty?.kill?.(p.id); } catch {}
                    removePane(p.id);
                  });
                  onClose();
                }}
                className="w-full text-left px-3 py-2 font-mono text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/5 transition-colors flex items-center gap-2"
              >
                <span className="text-[9px]">⊗</span>
                Fechar {stuckPanes.length} pane{stuckPanes.length > 1 ? "s" : ""} travado{stuckPanes.length > 1 ? "s" : ""}
              </button>
            </>
          );
        })()}
      </div>
    </>
  );
}

// ─── Export Menu ─────────────────────────────────────────────────────────────
function ExportMenu() {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleExport = async (format: "markdown" | "json") => {
    setBusy(true);
    setOpen(false);
    try {
      const result = await window.codeBrainApp.session.export({ format, includeAll: true });
      if (!result) {
        notify("Codebrain", "Erro: sem resposta do processo principal", "error");
      } else if (!result.ok) {
        if (result.error === "cancelado") {
          // usuário cancelou o dialog — silencioso
        } else if (result.error === "Nenhum pane ativo para exportar") {
          notify("Codebrain", "Abra um terminal antes de exportar a sessão", "warning");
        } else {
          notify("Codebrain", `Erro ao exportar: ${result.error}`, "error");
        }
      } else {
        notify("Codebrain", "Sessão exportada com sucesso!", "success");
      }
    } catch (err: any) {
      notify("Codebrain", `Erro ao exportar sessão: ${err?.message ?? String(err)}`, "error");
    }
    setBusy(false);
  };

  return (
    <div ref={ref} className="relative h-full">
      <IconBtn icon={<Download size={15} strokeWidth={1.5} />} label="Exportar Sessão" onClick={() => setOpen(!open)} disabled={busy} />
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[9999] bg-[#0c0c14] border border-white/10 rounded-lg shadow-2xl py-1 w-44">
          <button
            onClick={() => handleExport("markdown")}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-white/[0.05] cursor-pointer transition-colors"
          >
            <FileText size={13} className="text-violet-400" />
            <span className="font-mono text-[11px] text-gray-300">Markdown (.md)</span>
          </button>
          <button
            onClick={() => handleExport("json")}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-white/[0.05] cursor-pointer transition-colors"
          >
            <FileJson size={13} className="text-emerald-400" />
            <span className="font-mono text-[11px] text-gray-300">JSON (.json)</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Audio / Voice Indicator ──────────────────────────────────────────────────
function AudioIndicator({ audioConfig, audioModeBusy, onToggleMode }: any) {
  const voiceStats = useVoiceStore(s => s.stats);
  const requestCancel = useVoiceStore(s => s.requestCancel);
  const voiceCancelable = voiceStats.visible || voiceStats.phase !== 'idle' || voiceStats.chunksPending > 0;

  const phaseColor =
    voiceStats.phase === 'listening' ? 'text-cyan-300 bg-cyan-500/10'
      : voiceStats.phase === 'transcribing' ? 'text-yellow-300 bg-yellow-500/10'
        : 'text-slate-700';

  const mode = normalizedVoiceMode(audioConfig?.interactionMode);

  return (
    <div className={`flex items-stretch h-full border-l border-white/[0.06] ${audioModeBusy ? 'opacity-60' : ''}`}>
      {/* Waveform / audio level indicator */}
      <div
        className={`flex items-center gap-1 px-2.5 border-r border-white/[0.06] ${phaseColor}`}
      >
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

// ─── Workspace Access Mode Selector ──────────────────────────────────────────
const ACCESS_OPTIONS = [
  { id: "write_external", label: "R/W Externo", desc: "Ler e editar dentro e fora do workspace", Icon: Unlock },
  { id: "read_external", label: "R Externo", desc: "Edita só o workspace; pode ler fora", Icon: Lock },
] as const;

function AccessModeSelector({ activeWorkspace }: { activeWorkspace: string }) {
  const [mode, setMode] = React.useState<string>("write_external");
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!activeWorkspace) return;
    (window as any).codeBrainApp?.workspaceConfig?.get(activeWorkspace)
      .then((cfg: any) => setMode(cfg?.accessMode === "read_external" ? "read_external" : "write_external"))
      .catch(() => {});
  }, [activeWorkspace]);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = ACCESS_OPTIONS.find(o => o.id === mode) ?? ACCESS_OPTIONS[0];
  const CurrIcon = current.Icon;

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(v => !v);
  };

  const handleSelect = async (id: string) => {
    setMode(id);
    setOpen(false);
    try { await (window as any).codeBrainApp?.workspaceConfig?.set(activeWorkspace, { accessMode: id }); } catch {}
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`flex items-center gap-1 px-2 py-1 rounded font-mono text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
          mode === "read_external"
            ? "text-amber-400/80 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15"
            : "text-emerald-400/60 hover:text-emerald-300 bg-emerald-500/[0.06] hover:bg-emerald-500/10"
        }`}
        title={current.desc}
      >
        <CurrIcon size={11} strokeWidth={2} />
        <span className="hidden xl:inline">{current.label}</span>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className="fixed w-56 bg-[#0c0c14]/95 border border-white/10 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden backdrop-blur-md"
          style={{ top: anchor.top, right: anchor.right, zIndex: 100000 }}
        >
          <div className="px-3 py-2 border-b border-white/5">
            <p className="font-mono text-[8px] text-slate-500 uppercase tracking-widest">Acesso ao Workspace</p>
          </div>
          {ACCESS_OPTIONS.map(opt => {
            const active = mode === opt.id;
            const Icon = opt.Icon;
            return (
              <button
                key={opt.id}
                onClick={() => handleSelect(opt.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-all cursor-pointer ${
                  active ? "bg-violet-500/10 text-violet-300" : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
                }`}
              >
                <Icon size={13} strokeWidth={1.8} />
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-bold">{opt.label}</p>
                  <p className="font-mono text-[9px] text-slate-500 truncate">{opt.desc}</p>
                </div>
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── MCP Port Indicator ───────────────────────────────────────────────────────
function McpPortIndicator() {
  const [mcpPort, setMcpPort] = React.useState<number | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const api = (window as any).codeBrainApp?.diagnostics;
    if (!api) return;
    api.snapshot().then((s: any) => {
      if (s?.mcp?.active && s.mcp.port) setMcpPort(s.mcp.port);
    }).catch(() => {});
  }, []);

  if (mcpPort === null) return null;

  const handleClick = () => {
    navigator.clipboard.writeText(String(mcpPort)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[9px] tracking-wider transition-all cursor-pointer
        text-emerald-400/70 hover:text-emerald-300 hover:bg-emerald-500/[0.08]"
      title={copied ? 'Copiado!' : `MCP rodando na porta ${mcpPort} — clique para copiar`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      MCP:{mcpPort}
    </button>
  );
}

// ─── Workspace Header ─────────────────────────────────────────────────────────
function WorkspaceHeader() {
  const tabs = useNavStore(s => s.tabs) as any[];
  const activeTabIndex = useNavStore(s => s.activeTabIndex);
  const onHome = useNavStore(s => s.onHome);
  const goHome = useNavStore(s => s.goHome);
  const setActiveTab = useNavStore(s => s.setActiveTab);
  const moveTab = useNavStore(s => s.moveTab);
  const closeTab = useNavStore(s => s.closeTab);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);

  const addPane = usePanesStore(s => s.addPane);
  const authEmail = useAuthStore(s => s.email);
  const providers = useProvidersStore(s => s.providers) as any[];
  const loadProviders = useProvidersStore(s => s.load);

  const tasksVisible = useTasksStore(s => s.visible);
  const tasksCount = useTasksStore(s => s.list.length);
  const toggleTasks = useTasksStore(s => s.toggle);

  const memoryVisible = useMemoryStore(s => s.visible);
  const toggleMemory = useMemoryStore(s => s.toggle);


  const historyVisible = useSessionHistoryStore(s => s.visible);
  const toggleHistory = useSessionHistoryStore(s => s.toggle);

  const recipesVisible = useRecipeStore(s => s.visible);
  const toggleRecipes = useRecipeStore(s => s.toggle);

  const cronVisible = useCronStore(s => s.visible);
  const toggleCron = useCronStore(s => s.toggle);

  const remoteVisible = useRemoteBridgeStore(s => s.visible);
  const toggleRemote = useRemoteBridgeStore(s => s.toggle);

  const appZoom = useTerminalSettings(s => s.appZoom);
  const increaseAppZoom = useTerminalSettings(s => s.increaseAppZoom);
  const decreaseAppZoom = useTerminalSettings(s => s.decreaseAppZoom);
  const resetAppZoom = useTerminalSettings(s => s.resetAppZoom);

  const m = useModals();

  const [showAccount, setShowAccount] = React.useState(false);
  const [showPaneMenu, setShowPaneMenu] = React.useState(false);
  const [profile, setProfile] = React.useState<any>(null);
  const [savedPanes, setSavedPanes] = React.useState<any[]>([]);
  const [snapshotBusy, setSnapshotBusy] = React.useState(false);
  const [permMode, setPermMode] = React.useState(() => localStorage.getItem('codebrain.permissionMode') ?? 'bypassPermissions');
  const [audioConfig, setAudioConfig] = React.useState<any>(null);
  const [audioModeBusy, setAudioModeBusy] = React.useState(false);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);

  const accountRef = React.useRef<HTMLDivElement>(null);
  const paneMenuRef = React.useRef<HTMLDivElement>(null);

  const activeTab = !onHome ? tabs[activeTabIndex] : undefined;
  const activeWorkspace = activeTab?.workspacePath as string | undefined;
  const isMapView = activeTab?.view?.kind === 'map';
  const isFilesView = activeTab?.view?.kind === 'files';

  // ── Effects ──────────────────────────────────────────────────────────────
  React.useEffect(() => { loadProviders(); }, [loadProviders]);
  React.useEffect(() => { localStorage.setItem('codebrain.permissionMode', permMode); }, [permMode]);

  const refreshAudio = React.useCallback(() => {
    const api = (window as any).codeBrainApp?.audio;
    if (!api) { setAudioConfig(null); return; }
    api.getConfig().then((c: any) => setAudioConfig(c)).catch(() => setAudioConfig(null));
  }, []);
  React.useEffect(() => { refreshAudio(); }, [refreshAudio]);

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
      .catch(() => { });
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
      const byKey = new Map<string, any>();
      for (const p of all) { const sess = p.session ?? (p.claudeSessionId ? { provider: 'claude', id: p.claudeSessionId } : undefined); const key = sess ? `${sess.provider}:${sess.id}` : `${p.agent}:${p.id}`; const ex = byKey.get(key); if (!ex || p.savedAt > ex.savedAt) byKey.set(key, p); }
      setSavedPanes([...byKey.values()].sort((a, b) => b.savedAt - a.savedAt));
    }).catch(() => setSavedPanes([]));
  }, [showPaneMenu, activeWorkspace]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const r = await (window as any).codeBrainApp?.session?.saveSnapshot(activeWorkspace);
      if (r?.ok) notify('Sessão salva', 'Snapshot salvo.', 'success');
    } finally { setSnapshotBusy(false); }
  };

  const handleRestore = async () => {
    if (!activeWorkspace || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const r = await (window as any).codeBrainApp?.session?.loadSnapshot(activeWorkspace);
      if (!r?.ok || !r.snapshot) return;
      const { deterministicRestore } = await import("../../lib/session-restore");
      const result = await deterministicRestore(r.snapshot, addPane, permMode);
      if (result.restored > 0) {
        notify(
          "Sessão restaurada",
          `${result.restored} pane(s) restaurado(s).` +
            (result.skipped > 0 ? ` ${result.skipped} pulado(s).` : ""),
          'success'
        );
      }
    } finally { setSnapshotBusy(false); }
  };

  const handleRestorePane = async (pane: any) => {
    const restProv = pane.providerId ? providers.find(p => p.id === pane.providerId) : null;
    const env: Record<string, string> = { ...(restProv?.env ?? {}), ...(pane.model ? { ANTHROPIC_MODEL: pane.model, MODEL: pane.model } : {}) };
    const r = await (window as any).codeBrainApp?.pty.spawn({ paneId: pane.id, agent: pane.agent, cwd: pane.cwd, args: pane.args, session: pane.session, claudeSessionId: pane.claudeSessionId, providerId: pane.providerId, model: pane.model, ...(Object.keys(env).length ? { env } : {}) });
    if (r?.ok && r.paneId) addPane({ id: r.paneId, agent: pane.agent, cwd: pane.cwd, args: pane.args, workspacePath: activeWorkspace, session: pane.session, claudeSessionId: pane.claudeSessionId, lastLines: pane.lastLines, providerId: pane.providerId, model: pane.model, externallySpawned: true });
    if (usePanesStore.getState().panes.find((p: any) => p.session?.provider === pane.session?.provider && p.session?.id === pane.session?.id)) {
      usePanesStore.getState().setActive(usePanesStore.getState().panes.find((p: any) => p.session?.id === pane.session?.id)?.id!);
    }
  };

  const handleToggleAudioMode = async () => {
    if (!audioConfig || audioModeBusy) return;
    setAudioModeBusy(true);
    const cur = normalizedVoiceMode(audioConfig.interactionMode);
    const newMode = cur === 'coding' ? 'conversation' : 'coding';
    const patch = { interactionMode: newMode, outputMode: outputModeForInteractionMode(newMode) };
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

      {/* ── Main header row ───────────────────────────────────────── */}
      <div
        className="h-12 border-b border-white/[0.04] flex items-stretch shrink-0 overflow-x-auto relative cb-header"
        style={{ WebkitAppRegion: 'drag', scrollbarWidth: 'none' } as React.CSSProperties}
      >
        {/* Brand / Home */}
        <button
          onClick={goHome}
          className={`shrink-0 px-5 flex items-center gap-3 border-r border-white/[0.06] focus:outline-none group transition-all cursor-pointer ${onHome ? 'bg-violet-500/[0.06]' : 'hover:bg-white/[0.04]'}`}
          style={{ WebkitAppRegion: 'no-drag', minWidth: 140 } as React.CSSProperties}
          title="Home"
        >
          <Logo size={16} />
          <span className={`font-mono text-[9px] font-bold tracking-[0.2em] transition-colors ${onHome ? 'bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent' : 'text-slate-500 group-hover:text-violet-300'}`}>
            CODEBRAIN
          </span>
        </button>

        {/* Workspace Tabs */}
        <div className="flex items-stretch min-w-0 overflow-x-auto gap-0.5 px-2" style={{ WebkitAppRegion: 'no-drag', scrollbarWidth: 'none' } as React.CSSProperties}>
          {tabs.map((tab: any, i: number) => {
            const isActive = !onHome && i === activeTabIndex;
            const label = tabLabel(tab);
            const isMissing = tab.missing === true;
            const isDragging = dragIndex === i;
            const isTarget = dropIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <div
                key={tab.id ?? i}
                draggable
                onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                onDragOver={e => { if (dragIndex === null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropIndex !== i) setDropIndex(i); }}
                onDragLeave={() => { if (dropIndex === i) setDropIndex(null); }}
                onDrop={e => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) moveTab(dragIndex, i); setDragIndex(null); setDropIndex(null); }}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                onClick={() => setActiveTab(i)}
                title={tab.workspacePath}
                className={`group relative flex items-center gap-2 px-5 cursor-pointer shrink-0 min-w-0 max-w-[180px] rounded-md select-none transition-all
                  ${isActive ? 'bg-violet-500/12 text-slate-50 border border-violet-500/30 after:absolute after:bottom-1.5 after:left-2 after:right-2 after:h-1 after:bg-gradient-to-r after:from-[#9d4edd] after:to-[#00d9ff] after:rounded' : isMissing ? 'text-slate-500' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] border border-transparent'}
                  ${isDragging ? 'opacity-40' : ''}
                  ${isTarget ? 'bg-[#9d4edd]/15 border border-[#9d4edd]/30' : ''} border`}
                style={{ height: 44 }}
              >
                <span className="font-mono text-[10px] font-medium truncate">{isMissing ? `${label} ×` : label}</span>
                <button
                  onClick={e => { e.stopPropagation(); closeTab(i); }}
                  className="shrink-0 w-4 h-4 rounded flex items-center justify-center opacity-50 group-hover:opacity-100 hover:!opacity-100 hover:bg-white/15 text-slate-400 hover:text-white transition-all focus:outline-none"
                >
                  <X size={9} strokeWidth={1.8} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Missions menu + Access Mode — só aparece quando há workspace ativo */}
        {activeWorkspace && (
          <div className="flex items-stretch border-l border-white/[0.06] gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <MissionsMenu activeWorkspace={activeWorkspace} />
            <div className="flex items-center px-1.5">
              <AccessModeSelector activeWorkspace={activeWorkspace} />
            </div>
          </div>
        )}

        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

        {/* ── Right toolbar ──────────────────────────────────────── */}
        <div className="flex items-stretch shrink-0 gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>

          {/* Notifications */}
          <div className="flex items-center px-1">
            <NotificationsBell />
          </div>
          <VDiv />

          {/* Tasks */}
          <IconBtn icon={<ListTodo size={15} strokeWidth={1.5} />} label="Tasks" onClick={toggleTasks} active={tasksVisible} badge={tasksCount} />

          {/* Memory */}
          <IconBtn icon={<Database size={15} strokeWidth={1.5} />} label="Memory" onClick={toggleMemory} active={memoryVisible} />

          {/* Usage */}
          {/* History */}
          <IconBtn icon={<History size={15} strokeWidth={1.5} />} label="History" onClick={toggleHistory} active={historyVisible} />

          {/* Recipes (harness) */}
          <IconBtn icon={<UtensilsCrossed size={15} strokeWidth={1.5} />} label="Recipes" onClick={toggleRecipes} active={recipesVisible} />

          {/* Cron (scheduled jobs) */}
          <IconBtn icon={<Clock size={15} strokeWidth={1.5} />} label="Cron Jobs" onClick={toggleCron} active={cronVisible} />

          {/* Remote Playback (mobile control) */}
          <IconBtn icon={<Smartphone size={15} strokeWidth={1.5} />} label="Remote" onClick={toggleRemote} active={remoteVisible} />

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

          {/* Export Session */}
          <ExportMenu />

          {/* Restore Session */}
          {activeWorkspace && (
            <IconBtn icon={<RotateCcw size={15} strokeWidth={1.5} />} label="Restaurar Sessão" onClick={handleRestore} disabled={snapshotBusy} />
          )}

          {activeWorkspace && <VDiv />}

          {/* MCP Port Indicator */}
          <McpPortIndicator />

          {/* Audio / Voice mode indicator */}
          {activeWorkspace && audioConfig && (
            <AudioIndicator audioConfig={audioConfig} audioModeBusy={audioModeBusy} onToggleMode={handleToggleAudioMode} />
          )}

          {/* Global actions grouped into a single compact menu (keeps the bar uncluttered) */}
          <VDiv />
          <GlobalActionsMenu
            onProviders={() => m.openProviders('list')}
            onSquad={() => m.setShowSquadWizard(true)}
          />

          {/* Libre Mode */}
          {activeWorkspace && (
            <>
              <VDiv />
              <button
                onClick={() => m.setShowLibreWizard(true)}
                className="px-3 flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-widest focus:outline-none transition-all border-l border-white/[0.06] cursor-pointer text-violet-500/60 hover:text-violet-300 hover:bg-violet-500/[0.06]"
                title="Libre Mode — spawn N panes across providers"
              >
                <Zap size={12} strokeWidth={2.5} /> LIBRE
              </button>
            </>
          )}

          {/* + PANE */}
          {activeWorkspace && (
            <div ref={paneMenuRef} className="flex items-stretch shrink-0">
              <VDiv />
              <button
                onClick={() => setShowPaneMenu(v => !v)}
                className={`px-3 flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-widest focus:outline-none transition-all border-l border-white/[0.06] cursor-pointer ${showPaneMenu ? 'text-[#00d9ff] bg-[#00d9ff]/10' : 'text-violet-400/70 hover:text-[#00d9ff] hover:bg-[#00d9ff]/[0.06] hover:shadow-[0_0_8px_rgba(0,217,255,0.08)]'}`}
                title="Novo terminal / Restaurar sessão"
              >
                <Plus size={12} strokeWidth={2.5} /> SHELL
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
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/25 flex items-center justify-center hover:from-indigo-500/30 hover:to-violet-500/30 hover:shadow-[0_0_10px_rgba(99,102,241,0.15)] transition-all">
                {authEmail
                ? <span className="font-mono text-[9px] font-bold text-indigo-400">{authEmail.slice(0, 1).toUpperCase()}</span>
                : <UserCircle2 size={16} className="text-indigo-400/80" />
              }
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
  const tabs = useNavStore(s => s.tabs);
  return onHome || (tabs as any[]).length === 0 ? <HomeHeader /> : <WorkspaceHeader />;
}
