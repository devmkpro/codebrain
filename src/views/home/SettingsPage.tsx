import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Terminal, Zap, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Info, Save,
  RotateCcw, Download, Trash2, RefreshCw, Shield,
  Type, Monitor, Plus, X, Variable, Gamepad2, Bell,
  Mic, Cloud, Cpu, Link, Copy, Check, ExternalLink,
  Globe, Lock, GitPullRequest, FolderGit2,
} from 'lucide-react';
import {
  useTerminalSettings,
  FONT_OPTIONS,
  SCROLLBACK_OPTIONS,
  DEFAULT_SIZE,
  MIN_SIZE,
  MAX_SIZE,
} from '../../stores/terminal-settings-store';
import { useProvidersStore } from '../../stores/providers-store';
import { normalizedVoiceMode, outputModeForInteractionMode } from '../../stores/tasks-store';
import { useMrReviewStore } from '../../stores/mr-review-store';

type Section = 'terminal' | 'shell' | 'providers' | 'spawn' | 'envvars' | 'skill' | 'voice' | 'notifications' | 'discord' | 'oauth' | 'advanced';

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${enabled ? 'bg-[#4F46E5]' : 'bg-white/10 hover:bg-white/15'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ value, onIncrease, onDecrease, onReset, unit = '' }: {
  value: number | string; onIncrease?: () => void; onDecrease?: () => void; onReset?: () => void; unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {onDecrease && <button onClick={onDecrease} className="w-6 h-6 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center text-[14px] transition-colors">−</button>}
      <span className="font-mono text-[12px] text-[#4F46E5] w-14 text-center">{value}{unit}</span>
      {onIncrease && <button onClick={onIncrease} className="w-6 h-6 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center text-[14px] transition-colors">+</button>}
      {onReset && <button onClick={onReset} className="text-[9px] font-mono text-slate-600 hover:text-slate-400 transition-colors">reset</button>}
    </div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ id, icon, title, badge, children, active, onToggle }: {
  id: Section; icon: React.ReactNode; title: string; badge?: string;
  children: React.ReactNode; active: boolean; onToggle: (s: Section) => void;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#0A0A0B]/50 overflow-hidden">
      <button onClick={() => onToggle(id)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#4F46E5]/10 border border-[#4F46E5]/20 flex items-center justify-center text-[#4F46E5]">{icon}</div>
          <span className="text-[12px] font-bold text-slate-200">{title}</span>
          {badge && <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-[#4F46E5]/10 text-indigo-400 uppercase tracking-widest border border-indigo-500/20">{badge}</span>}
        </div>
        {active ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-700" />}
      </button>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-5 pb-5 space-y-5 border-t border-white/5 pt-5"
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-300">{label}</p>
        {description && <p className="text-[10px] text-slate-600 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-white/5" />;
}

// ─── Add Env Var Row ─────────────────────────────────────────────────────────
function AddEnvVarRow({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const handleAdd = () => {
    if (!key.trim()) return;
    onAdd(key.trim(), value);
    setKey('');
    setValue('');
  };
  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        type="text"
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="KEY"
        className="flex-1 bg-black/30 border border-white/10 rounded px-2.5 py-1.5 text-[10px] font-mono text-slate-300 placeholder-slate-700 focus:outline-none focus:border-[#4F46E5]/40 transition-colors"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="value"
        className="flex-1 bg-black/30 border border-white/10 rounded px-2.5 py-1.5 text-[10px] font-mono text-slate-300 placeholder-slate-700 focus:outline-none focus:border-[#4F46E5]/40 transition-colors"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <button
        onClick={handleAdd}
        disabled={!key.trim()}
        className="w-7 h-7 flex items-center justify-center rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-30 transition-all"
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

// ─── CliRow — reutilizável para cada CLI na seção Skill & CLI ────────────────
function CliRow({
  label, description, status, installKey, cliBusy, onDetect, onInstalled, setCliBusy,
}: {
  label: string;
  description: React.ReactNode;
  status: { found: boolean; path?: string; version?: string } | null;
  installKey: string | null; // null = sem auto-install (ex: Claude Code)
  cliBusy: boolean;
  onDetect: () => void;
  onInstalled: ((key: string) => void) | null;
  setCliBusy: (v: boolean) => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installErr, setInstallErr] = useState<string | null>(null);

  const handleInstall = async () => {
    if (!installKey) return;
    setInstalling(true);
    setInstallErr(null);
    try {
      const r = await (window as any).codeBrainApp?.cli?.installCli?.(installKey);
      if (r?.ok) {
        onInstalled?.(installKey);
        onDetect();
      } else {
        setInstallErr(r?.error || 'Erro ao instalar.');
      }
    } catch (e) {
      setInstallErr(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const isInstalling = installing || (cliBusy && installing);

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-[11px] font-medium text-slate-300">{label}</p>
          {status && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${status.found ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' : 'text-amber-400 border-amber-500/20 bg-amber-500/5'}`}>
              {status.found ? '✓ instalado' : '✗ não encontrado'}
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">{description}</p>
        {status?.path && status.found && (
          <p className="text-[9px] font-mono text-slate-700 mt-0.5 truncate">{status.path}</p>
        )}
        {status?.version && (
          <p className="text-[9px] font-mono text-slate-700 mt-0.5">{status.version}</p>
        )}
        {installErr && (
          <p className="text-[9px] font-mono text-red-400 mt-1 leading-relaxed">{installErr}</p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {installKey && !status?.found && (
          <button
            onClick={handleInstall}
            disabled={isInstalling || cliBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-300 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500/20 disabled:opacity-40 transition-all whitespace-nowrap"
          >
            {isInstalling
              ? <RefreshCw size={11} className="animate-spin" />
              : <Download size={11} />}
            {isInstalling ? 'Instalando…' : 'Instalar'}
          </button>
        )}
        <button
          onClick={onDetect}
          disabled={cliBusy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 disabled:opacity-40 transition-all whitespace-nowrap"
        >
          <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const [open,      setOpen]   = useState<Section[]>(['terminal']);
  const [saved,     setSaved]  = useState(false);
  const [shells,    setShells] = useState<string[]>([]);
  const [skillStatus, setSkillStatus] = useState<{ installed: boolean } | null>(null);
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  const [cliStatus,        setCliStatus]        = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [claudeCliStatus,  setClaudeCliStatus]  = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [codexCliStatus,   setCodexCliStatus]   = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [geminiCliStatus,  setGeminiCliStatus]  = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [kimiCliStatus,    setKimiCliStatus]    = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [cursorCliStatus,  setCursorCliStatus]  = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [copilotCliStatus, setCopilotCliStatus] = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [oauthStatus, setOauthStatus] = useState<{ github: { connected: boolean; account?: string }; gitlab: { connected: boolean; account?: string } } | null>(null);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null); // 'github' | 'gitlab' | null
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [gitlabClientId, setGitlabClientId] = useState('');
  const [gitlabClientSecret, setGitlabClientSecret] = useState('');
  const [githubClientId, setGithubClientId] = useState('');
  const [gitlabBotToken, setGitlabBotToken] = useState('');
  const [githubBotToken, setGithubBotToken] = useState('');
  const [botTokenSaving, setBotTokenSaving] = useState<string | null>(null); // 'gitlab' | 'github' | null
  const [botTokenSaved, setBotTokenSaved] = useState<string | null>(null);    // 'gitlab' | 'github' | null
  const [tutorialOpen, setTutorialOpen] = useState<{ gitlab: boolean; github: boolean }>({ gitlab: false, github: false });
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [mrAutoReview, setMrAutoReview] = useState(false);
  const [mrReviewProvider, setMrReviewProvider] = useState('');
  const [mrReviewModel, setMrReviewModel] = useState('');
  const { detectedWorkspaces, loading: mrLoading, fetchAllowed, toggleWorkspace, allowedWorkspaces } = useMrReviewStore();
  const [skillBusy,   setSkillBusy]   = useState(false);
  const [cliBusy,     setCliBusy]     = useState(false);
  // Voice / BrainVoice
  const [audioConfig, setAudioConfig] = useState<any>(null);
  const [audioKey, setAudioKey] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioMsg, setAudioMsg] = useState<string | null>(null);
  // Whisper local: hardware detection + 1-click install
  const [audioHw, setAudioHw] = useState<any>(null);
  const [installModel, setInstallModel] = useState<string>('small');
  const [installDir, setInstallDir] = useState<string>('');
  const [installBusy, setInstallBusy] = useState(false);
  const [installLog, setInstallLog] = useState<string | null>(null);
  // Discord RPC
  const [discordClientId, setDiscordClientId] = useState('');
  const [discordConnected, setDiscordConnected] = useState(false);
  const [discordMsg, setDiscordMsg] = useState<string | null>(null);
  // Global env vars
  const [globalEnv, setGlobalEnv] = useState<Record<string, string>>({});
  const [envMsg, setEnvMsg] = useState<string | null>(null);
  // Notification settings
  const [notifOnTaskComplete, setNotifOnTaskComplete] = useState(true);
  const [notifOnMessage, setNotifOnMessage] = useState(true);
  const [notifOnBuildResult, setNotifOnBuildResult] = useState(false);

  // Default spawn config (per workspace + per provider)
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [defaultProviderId, setDefaultProviderId] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [spawnMsg, setSpawnMsg] = useState<string | null>(null);
  const [providerDefaultModels, setProviderDefaultModels] = useState<Record<string, string>>({});

  // Terminal settings
  const fontSize         = useTerminalSettings(s => s.fontSize);
  const fontFamily       = useTerminalSettings(s => s.fontFamily);
  const lineHeight       = useTerminalSettings(s => s.lineHeight);
  const theme            = useTerminalSettings(s => s.theme);
  const appZoom          = useTerminalSettings(s => s.appZoom);
  const defaultShellPath = useTerminalSettings(s => s.defaultShellPath);
  const setFontSize      = useTerminalSettings(s => s.setFontSize);
  const setFontFamily    = useTerminalSettings(s => s.setFontFamily);
  const setLineHeight    = useTerminalSettings(s => s.setLineHeight);
  const setTheme         = useTerminalSettings(s => s.setTheme);
  const setDefaultShell  = useTerminalSettings(s => s.setDefaultShellPath);
  const increaseFontSize = useTerminalSettings(s => s.increaseFontSize);
  const decreaseFontSize = useTerminalSettings(s => s.decreaseFontSize);
  const resetFontSize    = useTerminalSettings(s => s.resetFontSize);
  const increaseAppZoom  = useTerminalSettings(s => s.increaseAppZoom);
  const decreaseAppZoom  = useTerminalSettings(s => s.decreaseAppZoom);
  const resetAppZoom     = useTerminalSettings(s => s.resetAppZoom);
  const cursorBlink      = useTerminalSettings(s => s.cursorBlink);
  const setCursorBlink   = useTerminalSettings(s => s.setCursorBlink);
  const gpuAcceleration  = useTerminalSettings(s => s.gpuAcceleration);
  const setGpuAcceleration = useTerminalSettings(s => s.setGpuAcceleration);
  const lowGpuMode       = useTerminalSettings(s => s.lowGpuMode);
  const setLowGpuMode    = useTerminalSettings(s => s.setLowGpuMode);
  const scrollbackSize   = useTerminalSettings(s => (s as any).scrollbackSize ?? 5000);
  const setScrollbackSize = useTerminalSettings(s => (s as any).setScrollbackSize);
  const reducedAnimations = useTerminalSettings(s => (s as any).reducedAnimations ?? false);
  const setReducedAnimations = useTerminalSettings(s => (s as any).setReducedAnimations);
  const disableBackdropBlur = useTerminalSettings(s => (s as any).disableBackdropBlur ?? false);
  const setDisableBackdropBlur = useTerminalSettings(s => (s as any).setDisableBackdropBlur);

  // Providers
  const providers    = useProvidersStore(s => s.providers) as any[];
  const loadProviders = useProvidersStore(s => s.load);

  useEffect(() => {
    // Load shells
    (window as any).codeBrainApp?.shells?.list?.()
      .then((s: string[]) => setShells(s ?? []))
      .catch(() => {});
    // Load audio/voice config
    (window as any).codeBrainApp?.audio?.getConfig?.()
      .then((cfg: any) => { if (cfg) setAudioConfig(cfg); })
      .catch(() => {});
    // Load skill status
    (window as any).codeBrainApp?.skill?.status?.()
      .then((s: any) => setSkillStatus(s))
      .catch(() => {});
    // Load skills list
    (window as any).codeBrainApp?.skill?.list?.()
      .then((skills: string[]) => setInstalledSkills(skills))
      .catch(() => {});
    // Load CLI status — detect returns AllCliInfo { openclaude, claude, shell }
    (window as any).codeBrainApp?.cli?.detect?.()
      .then((s: any) => {
        setCliStatus(s?.openclaude ?? null);
        setClaudeCliStatus(s?.claude ?? null);
        setCodexCliStatus(s?.codex ?? null);
        setGeminiCliStatus(s?.gemini ?? null);
        setKimiCliStatus(s?.kimi ?? null);
        setCursorCliStatus(s?.cursor ?? null);
        setCopilotCliStatus(s?.copilot ?? null);
      })
      .catch(() => {});
    loadProviders().catch(() => {});
    // Load active workspace + default spawn config
    (async () => {
      const recentWs = await (window as any).codeBrainApp?.workspaces?.recent?.().catch(() => []) ?? [];
      const ws = recentWs[0] ?? null;
      setActiveWorkspace(ws);
      if (ws) {
        const cfg = await (window as any).codeBrainApp?.workspaceConfig?.get?.(ws).catch(() => null);
        if (cfg?.favoritePane) {
          setDefaultProviderId(cfg.favoritePane.providerId ?? '');
          setDefaultModel(cfg.favoritePane.model ?? '');
        }
      }
      // Load per-provider default models from localStorage
      try {
        const saved = JSON.parse(localStorage.getItem('codebrain.providerDefaultModels') ?? '{}');
        setProviderDefaultModels(saved);
      } catch {}
    })();
    // Load appConfig (globalEnv, discordClientId, notifications)
    (window as any).codeBrainApp?.appConfig?.get?.()
      .then((cfg: any) => {
        if (cfg && typeof cfg.globalEnv === 'object' && cfg.globalEnv) setGlobalEnv(cfg.globalEnv as Record<string, string>);
        if (cfg?.discordClientId) setDiscordClientId(cfg.discordClientId);
        if (cfg?.notifications) {
          if (cfg.notifications.onTaskComplete !== undefined) setNotifOnTaskComplete(cfg.notifications.onTaskComplete);
          if (cfg.notifications.onMessage !== undefined) setNotifOnMessage(cfg.notifications.onMessage);
          if (cfg.notifications.onBuildResult !== undefined) setNotifOnBuildResult(cfg.notifications.onBuildResult);
        }
      })
      .catch(() => {});
    // Load Discord status
    (window as any).codeBrainApp?.discord?.status?.()
      .then((s: any) => {
        if (s?.clientId) setDiscordClientId(s.clientId);
        setDiscordConnected(s?.connected ?? false);
      })
      .catch(() => {});
    // Load OAuth status
    (window as any).codeBrainApp?.oauth?.status?.()
      .then((r: any) => { if (r?.ok && r.data) setOauthStatus(r.data); })
      .catch(() => {});
    // Load auto-review config
    (window as any).codeBrainApp?.appConfig?.get?.()
      .then((cfg: any) => {
        if (cfg?.mr_auto_review) setMrAutoReview(true);
        if (cfg?.gitlab_bot_token) setGitlabBotToken(cfg.gitlab_bot_token);
        if (cfg?.github_bot_token) setGithubBotToken(cfg.github_bot_token);
        if (cfg?.mr_review_provider) setMrReviewProvider(cfg.mr_review_provider);
        if (cfg?.mr_review_model) setMrReviewModel(cfg.mr_review_model);
      })
      .catch(() => {});
    // Load detected repos for permission toggles
    fetchAllowed();
  }, []);

  const toggleSection = (s: Section) => setOpen(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const handleSkillToggle = async () => {
    if (skillBusy) return;
    setSkillBusy(true);
    try {
      if (skillStatus?.installed) {
        await (window as any).codeBrainApp?.skill?.uninstall?.();
        setSkillStatus({ installed: false });
      } else {
        await (window as any).codeBrainApp?.skill?.install?.();
        setSkillStatus({ installed: true });
      }
      // Update skills list
      const list = await (window as any).codeBrainApp?.skill?.list?.();
      if (list) setInstalledSkills(list);
    } catch {
      (window as any).codeBrainApp?.notify?.('Erro', 'Falha ao alterar skill.');
    } finally {
      setSkillBusy(false);
    }
  };

  const handleRedetectCli = async () => {
    if (cliBusy) return;
    setCliBusy(true);
    try {
      const res = await (window as any).codeBrainApp?.cli?.redetect?.();
      // redetect returns [{name,found,path,version}, ...]
      if (Array.isArray(res)) {
        const oc = res.find((r: any) => r.name === 'openclaude');
        const cl = res.find((r: any) => r.name === 'claude');
        const cx = res.find((r: any) => r.name === 'codex');
        const gc = res.find((r: any) => r.name === 'gemini');
        if (oc) setCliStatus(oc);
        if (cl) setClaudeCliStatus(cl);
        if (cx) setCodexCliStatus(cx);
        if (gc) setGeminiCliStatus(gc);
      } else {
        setCliStatus(res?.openclaude ?? res);
        setClaudeCliStatus(res?.claude ?? null);
        setCodexCliStatus(res?.codex ?? null);
        setGeminiCliStatus(res?.gemini ?? null);
      }
    } catch {} finally { setCliBusy(false); }
  };

  // ── OAuth handlers ──────────────────────────────────────────────────────
  const handleOAuthConnect = async (provider: 'github' | 'gitlab') => {
    setOauthBusy(provider);
    setOauthError(null);
    try {
      let args: any = { provider };
      if (provider === 'gitlab') {
        if (!gitlabClientId.trim()) { setOauthError('Preencha o Client ID do GitLab'); setOauthBusy(null); return; }
        args.clientId = gitlabClientId.trim();
        if (gitlabClientSecret.trim()) args.clientSecret = gitlabClientSecret.trim();
      } else {
        if (!githubClientId.trim()) { setOauthError('Preencha o Client ID do GitHub'); setOauthBusy(null); return; }
        args.clientId = githubClientId.trim();
      }
      const res = await (window as any).codeBrainApp?.oauth?.connect?.(args);
      if (!res?.ok) { setOauthError(res?.error || `Falha ao conectar ${provider}`); return; }
      // GitHub Device Flow — show user code
      if (res.userCode && res.verificationUri) {
        window.open(`${res.verificationUri}?user_code=${res.userCode}`, '_blank');
        setOauthError(null);
      }
      // Refresh status
      const s = await (window as any).codeBrainApp?.oauth?.status?.();
      if (s?.ok && s.data) setOauthStatus(s.data);
    } catch (err: any) {
      setOauthError(err?.message || `Erro ao conectar ${provider}`);
    } finally {
      setOauthBusy(null);
    }
  };

  const handleOAuthDisconnect = async (provider: 'github' | 'gitlab') => {
    setOauthBusy(provider);
    try {
      await (window as any).codeBrainApp?.oauth?.disconnect?.({ provider });
      const s = await (window as any).codeBrainApp?.oauth?.status?.();
      if (s?.ok && s.data) setOauthStatus(s.data);
    } catch {} finally { setOauthBusy(null); }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {}
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left nav */}
      <aside className="w-52 border-r border-white/5 bg-[#0F0F13] p-5 hidden md:flex flex-col gap-2 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-3">Seções</h3>
        {([
          { id: 'terminal'  as Section, icon: <Type size={12} />,     label: 'Terminal'  },
          { id: 'shell'     as Section, icon: <Terminal size={12} />, label: 'Shell'     },
          { id: 'providers' as Section, icon: <Zap size={12} />,      label: 'Providers' },
          { id: 'spawn'     as Section, icon: <Monitor size={12} />,  label: 'Spawn Padrão' },
          { id: 'envvars'   as Section, icon: <Variable size={12} />, label: 'Env Vars' },
          { id: 'skill'          as Section, icon: <Download size={12} />, label: 'Skill & CLI' },
          { id: 'notifications'  as Section, icon: <Bell size={12} />,     label: 'Notificações' },
          { id: 'discord'        as Section, icon: <Gamepad2 size={12} />, label: 'Discord'   },
          { id: 'oauth'          as Section, icon: <Link size={12} />,     label: 'Review Bot' },
          { id: 'advanced'       as Section, icon: <Shield size={12} />,   label: 'Avançado'  },
        ] as const).map(({ id, icon, label }) => (
          <button key={id} onClick={() => toggleSection(id)}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-[11px] transition-all ${open.includes(id) ? 'bg-[#4F46E5]/10 border border-[#4F46E5]/20 text-indigo-300' : 'text-slate-500 hover:bg-white/5 border border-transparent hover:border-white/5 hover:text-slate-300'}`}
          >{icon}{label}</button>
        ))}

        <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
          <div className="p-2.5 rounded-lg bg-[#0A0A0B]/50 border border-white/5">
            <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">Skill</p>
            <p className={`text-[10px] font-bold ${skillStatus?.installed ? 'text-emerald-400' : 'text-slate-600'}`}>
              {skillStatus === null ? '—' : skillStatus.installed ? '✓ Instalada' : '✗ Não instalada'}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#0A0A0B]/50 border border-white/5">
            <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">CLI</p>
            <p className={`text-[10px] font-bold ${cliStatus?.found ? 'text-emerald-400' : 'text-slate-600'}`}>
              {cliStatus === null ? '—' : cliStatus.found ? '✓ Encontrada' : '✗ Não encontrada'}
            </p>
          </div>
        </div>
      </aside>

      {/* Center */}
      <section className="flex-1 p-5 overflow-y-auto relative" style={{ scrollbarWidth: 'thin' }}>
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative z-10 max-w-2xl space-y-4">

          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div>
              <h1 className="text-[16px] font-bold text-white">Settings</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">Configurações aplicadas em tempo real</p>
            </div>
            <button onClick={handleSave}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all ${saved ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400' : 'bg-[#4F46E5] text-white hover:bg-[#4338CA]'}`}
            >
              {saved ? <><CheckCircle2 size={12} />Salvo!</> : <><Save size={12} />Salvar</>}
            </button>
          </div>

          {/* ── Terminal ─────────────────────────────────────────────── */}
          <SectionCard id="terminal" icon={<Type size={13} />} title="Terminal" badge="Ativo" active={open.includes('terminal')} onToggle={toggleSection}>
            <Row label="Tamanho da Fonte" description={`Tamanho atual: ${fontSize}px`}>
              <Stepper value={fontSize} unit="px" onIncrease={increaseFontSize} onDecrease={decreaseFontSize} onReset={resetFontSize} />
            </Row>
            <div>
              <input type="range" min={MIN_SIZE} max={MAX_SIZE} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full h-1 bg-white/5 rounded-full appearance-none accent-[#4F46E5]" />
              <div className="flex justify-between text-[9px] text-slate-700 mt-1"><span>{MIN_SIZE}px</span><span>{MAX_SIZE}px</span></div>
            </div>
            <Divider />

            <Row label="Família de Fonte">
              <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}
                className="bg-[#1A1A22] border border-white/10 rounded px-3 py-1.5 text-[11px] text-slate-300 outline-none focus:border-[#4F46E5] appearance-none cursor-pointer hover:border-white/20 transition-colors"
              >
                {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </Row>
            <Divider />

            <Row label="Altura de Linha" description="Espaçamento entre linhas no terminal">
              <Stepper
                value={lineHeight.toFixed(1)}
                onIncrease={() => setLineHeight(Math.min(2, +(lineHeight + 0.1).toFixed(1)))}
                onDecrease={() => setLineHeight(Math.max(1, +(lineHeight - 0.1).toFixed(1)))}
                onReset={() => setLineHeight(1)}
              />
            </Row>
            <Divider />

            <Row label="Zoom da Interface" description={`Zoom atual: ${(appZoom * 100).toFixed(0)}%`}>
              <Stepper value={`${(appZoom * 100).toFixed(0)}%`} onIncrease={increaseAppZoom} onDecrease={decreaseAppZoom} onReset={resetAppZoom} />
            </Row>
            <div>
              <input type="range" min={50} max={200} step={10} value={Math.round(appZoom * 100)} onChange={e => useTerminalSettings.setState({ appZoom: Math.max(0.5, Math.min(3, Number(e.target.value) / 100)) })} className="w-full h-1 bg-white/5 rounded-full appearance-none accent-[#4F46E5]" />
              <div className="flex justify-between text-[9px] text-slate-700 mt-1"><span>50%</span><span>200%</span></div>
            </div>
            <Divider />

            <Row label="Tema Claro" description="Alterna entre modo escuro e claro">
              <Toggle enabled={theme === 'light'} onChange={v => setTheme(v ? 'light' : 'dark')} />
            </Row>
            <Divider />

            <Row label="Cursor piscando" description="Mantém o cursor animado dentro dos panes">
              <Toggle enabled={cursorBlink} onChange={setCursorBlink} />
            </Row>
            <Divider />

            <Row label="Aceleração de hardware" description="Usa a GPU para compor a janela do Electron">
              <Toggle enabled={gpuAcceleration} onChange={setGpuAcceleration} />
            </Row>
            <Divider />

            <Row label="Baixo uso de GPU" description="Remove fundo animado, blur, glows e animações sem mudar para tema claro">
              <Toggle enabled={lowGpuMode} onChange={setLowGpuMode} />
            </Row>
            <Divider />

            <Row label="Animações reduzidas" description="Desativa animações Framer Motion (motion/react) — menos CPU em PCs fracos">
              <Toggle enabled={reducedAnimations} onChange={setReducedAnimations} />
            </Row>
            <Divider />

            <Row label="Sem Backdrop Blur" description="Desativa backdrop-blur nos panes — GPU-intensivo em muitos terminais abertos">
              <Toggle enabled={disableBackdropBlur} onChange={setDisableBackdropBlur} />
            </Row>
            <Divider />

            <Row label="Buffer de rolagem" description="Linhas mantidas em memória por pane — reduza para PCs com pouca RAM">
              <select
                value={scrollbackSize}
                onChange={e => setScrollbackSize(Number(e.target.value))}
                className="bg-[#1A1A22] border border-white/10 rounded px-3 py-1.5 text-[11px] text-slate-300 outline-none focus:border-[#4F46E5] appearance-none cursor-pointer hover:border-white/20 transition-colors"
              >
                {SCROLLBACK_OPTIONS.map(o => (
                  <option key={o.id} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
          </SectionCard>

          {/* ── Shell ────────────────────────────────────────────────── */}
          <SectionCard id="shell" icon={<Terminal size={13} />} title="Shell" active={open.includes('shell')} onToggle={toggleSection}>
            {shells.length > 0 ? (
              <Row label="Shell padrão" description="Shell usado ao abrir um terminal novo">
                <select
                  value={defaultShellPath ?? ''}
                  onChange={e => setDefaultShell(e.target.value || null)}
                  className="bg-[#1A1A22] border border-white/10 rounded px-3 py-1.5 text-[11px] text-slate-300 outline-none focus:border-[#4F46E5] appearance-none cursor-pointer hover:border-white/20 transition-colors max-w-[200px] truncate"
                >
                  <option value="">Sistema padrão</option>
                  {shells.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Row>
            ) : (
              <p className="text-[10px] text-slate-600 font-mono">Nenhum shell detectado além do padrão do sistema.</p>
            )}
            {defaultShellPath && (
              <p className="text-[9px] font-mono text-slate-600 truncate">Atual: {defaultShellPath}</p>
            )}
          </SectionCard>

          {/* ── Providers ────────────────────────────────────────────── */}
          <SectionCard id="providers" icon={<Zap size={13} />} title="Providers" active={open.includes('providers')} onToggle={toggleSection}>
            <Row label="Modelos e APIs" description="Cada pane pode usar um endpoint ou modelo LLM próprio. Configure aqui — depois escolhe no + PANE">
              <button
                onClick={() => { document.dispatchEvent(new CustomEvent('open-providers-modal')); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 text-[10px] font-mono text-indigo-400 uppercase tracking-widest transition-all"
              >
                Configurar Providers
              </button>
            </Row>
            {providers.length > 0 && <Divider />}
            {providers.length === 0 ? (
              <div className="py-2 text-center">
                <p className="text-[11px] text-slate-600">Nenhum provider configurado</p>
                <p className="text-[10px] text-slate-700 mt-1">Clique acima para adicionar</p>
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((p: any) => (
                  <div key={p.id} className="p-3.5 rounded-xl border border-white/5 bg-[#1A1A22]">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-[11px] font-bold text-slate-200">{p.label}</p>
                        <p className="text-[9px] font-mono text-slate-600 mt-0.5">{p.id}</p>
                      </div>
                      <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase">{p.type ?? 'custom'}</span>
                    </div>
                    {(p.models ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(p.models as string[]).map((m: string) => (
                          <span key={m} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-500 border border-white/5 truncate max-w-[160px]">{m}</span>
                        ))}
                      </div>
                    )}
                    {p.host && <p className="text-[9px] font-mono text-slate-600 mt-1.5">host: {p.host}</p>}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => loadProviders()}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 transition-all"
            ><RefreshCw size={11} /> Recarregar Providers</button>
          </SectionCard>

          {/* ── Spawn Padrão ─────────────────────────────────────────── */}
          <SectionCard id="spawn" icon={<Monitor size={13} />} title="Spawn Padrão" badge="Por Workspace" active={open.includes('spawn')} onToggle={toggleSection}>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Modelo aberto ao clicar em <span className="text-slate-300 font-mono">+Pane</span> ou ao abrir um workspace.
              {activeWorkspace && <span className="ml-1 font-mono text-indigo-400 text-[9px]">{activeWorkspace.split(/[\\/]/).pop()}</span>}
            </p>
            <div className="space-y-3 mt-2">
              <div>
                <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Provider padrão</label>
                <select
                  value={defaultProviderId}
                  onChange={e => {
                    setDefaultProviderId(e.target.value);
                    const p = providers.find((p: any) => p.id === e.target.value);
                    setDefaultModel(providerDefaultModels[e.target.value] ?? p?.models?.[0] ?? '');
                  }}
                  className="w-full bg-[#1A1A22] border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 outline-none focus:border-[#4F46E5] appearance-none cursor-pointer"
                >
                  <option value="">— Sem preferência —</option>
                  {providers.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.label ?? p.id}</option>
                  ))}
                </select>
              </div>
              {defaultProviderId && (() => {
                const p = providers.find((p: any) => p.id === defaultProviderId);
                const models: string[] = p?.models ?? [];
                return models.length > 0 ? (
                  <div>
                    <label className="block font-mono text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Modelo padrão</label>
                    <select
                      value={defaultModel}
                      onChange={e => setDefaultModel(e.target.value)}
                      className="w-full bg-[#1A1A22] border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 outline-none focus:border-[#4F46E5] appearance-none cursor-pointer"
                    >
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                ) : null;
              })()}
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    try {
                      const agent = providers.find((p: any) => p.id === defaultProviderId)?.host ?? 'openclaude';
                      if (activeWorkspace) {
                        const existing = await (window as any).codeBrainApp?.workspaceConfig?.get?.(activeWorkspace).catch(() => ({})) ?? {};
                        await (window as any).codeBrainApp?.workspaceConfig?.set?.(activeWorkspace, {
                          ...existing,
                          favoritePane: defaultProviderId ? { providerId: defaultProviderId, model: defaultModel || undefined, agent } : undefined,
                        });
                      }
                      // Also persist per-provider default
                      if (defaultProviderId && defaultModel) {
                        const next = { ...providerDefaultModels, [defaultProviderId]: defaultModel };
                        setProviderDefaultModels(next);
                        localStorage.setItem('codebrain.providerDefaultModels', JSON.stringify(next));
                      }
                      setSpawnMsg('Salvo!');
                      setTimeout(() => setSpawnMsg(null), 2500);
                    } catch {
                      setSpawnMsg('Erro ao salvar');
                      setTimeout(() => setSpawnMsg(null), 2500);
                    }
                  }}
                  className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-[#4F46E5] text-white rounded-lg hover:bg-[#4338CA] transition-colors"
                >Salvar Padrão</button>
                {spawnMsg && <span className={`font-mono text-[10px] ${spawnMsg.startsWith('Erro') ? 'text-red-400' : 'text-emerald-400'}`}>{spawnMsg}</span>}
              </div>
            </div>
            {providers.length > 0 && (
              <>
                <Divider />
                <p className="font-mono text-[9px] text-slate-500 uppercase tracking-widest mb-2">Padrão por provider</p>
                <div className="space-y-2">
                  {providers.map((p: any) => {
                    const models: string[] = p.models ?? [];
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 w-28 truncate shrink-0">{p.label ?? p.id}</span>
                        {models.length > 0 ? (
                          <select
                            value={providerDefaultModels[p.id] ?? models[0]}
                            onChange={e => {
                              const next = { ...providerDefaultModels, [p.id]: e.target.value };
                              setProviderDefaultModels(next);
                              localStorage.setItem('codebrain.providerDefaultModels', JSON.stringify(next));
                            }}
                            className="flex-1 bg-[#1A1A22] border border-white/10 rounded px-2 py-1 text-[10px] text-slate-300 outline-none focus:border-[#4F46E5] appearance-none cursor-pointer"
                          >
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="ex: llama3.2, qwen2.5"
                            value={providerDefaultModels[p.id] ?? ''}
                            onChange={e => {
                              const next = { ...providerDefaultModels, [p.id]: e.target.value };
                              setProviderDefaultModels(next);
                              localStorage.setItem('codebrain.providerDefaultModels', JSON.stringify(next));
                            }}
                            className="flex-1 bg-[#1A1A22] border border-white/10 rounded px-2 py-1 text-[10px] text-slate-300 placeholder-slate-700 outline-none focus:border-[#4F46E5] transition-colors"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </SectionCard>

          {/* ── Custom Env Vars ───────────────────────────────────────── */}
          <SectionCard id="envvars" icon={<Variable size={13} />} title="Custom Env Vars" badge="Global" active={open.includes('envvars')} onToggle={toggleSection}>
            <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
              Variáveis de ambiente aplicadas a <span className="text-slate-300 font-medium">todos</span> os agentes spawnados.
              Útil para API keys, base URLs, e flags que precisam estar disponíveis em qualquer terminal.
            </p>
            <div className="space-y-2">
              {Object.entries(globalEnv).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={key}
                    readOnly
                    className="flex-1 bg-black/30 border border-white/10 rounded px-2.5 py-1.5 text-[10px] font-mono text-slate-400 placeholder-slate-700 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={value}
                    onChange={e => {
                      const next = { ...globalEnv, [key]: e.target.value };
                      setGlobalEnv(next);
                    }}
                    className="flex-1 bg-black/30 border border-white/10 rounded px-2.5 py-1.5 text-[10px] font-mono text-slate-300 placeholder-slate-700 focus:outline-none focus:border-[#4F46E5]/40 transition-colors"
                  />
                  <button
                    onClick={() => {
                      const next = { ...globalEnv };
                      delete next[key];
                      setGlobalEnv(next);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded bg-white/5 border border-white/10 text-slate-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {Object.keys(globalEnv).length === 0 && (
                <p className="text-[10px] text-slate-600 font-mono py-2 text-center">Nenhuma variável configurada</p>
              )}
            </div>
            <AddEnvVarRow onAdd={(k, v) => setGlobalEnv(prev => ({ ...prev, [k]: v }))} />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={async () => {
                  try {
                    await (window as any).codeBrainApp?.appConfig?.set?.({ globalEnv });
                    setEnvMsg('Salvo!');
                    setTimeout(() => setEnvMsg(null), 2500);
                  } catch {
                    setEnvMsg('Erro ao salvar');
                    setTimeout(() => setEnvMsg(null), 2500);
                  }
                }}
                className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-[#4F46E5] text-white rounded-lg hover:bg-[#4338CA] transition-colors"
              >
                Salvar Env Vars
              </button>
              {envMsg && (
                <span className={`font-mono text-[10px] ${envMsg.startsWith('Erro') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {envMsg}
                </span>
              )}
            </div>
            <p className="text-[9px] text-slate-600 font-mono mt-2">Aplicado em todos os spawns. Para session-only, use export no terminal.</p>
          </SectionCard>

          {/* ── Skill & CLI ──────────────────────────────────────────── */}
          <SectionCard id="skill" icon={<Download size={13} />} title="Skill & CLI" active={open.includes('skill')} onToggle={toggleSection}>
            {/* Outras skills */}
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-slate-300">Skills do OpenClaude</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">Skills instaladas em <span className="font-mono bg-white/5 px-1 rounded">~/.claude/skills</span></p>
                </div>
                <button
                  onClick={() => (window as any).codeBrainApp?.skill?.openFolder?.()}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/10 hover:bg-white/5 text-slate-300 transition-colors"
                >
                  Abrir Pasta
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {installedSkills.length === 0 ? (
                  <span className="text-[10px] text-slate-600">Nenhuma skill encontrada (abra a pasta e coloque a sua lá).</span>
                ) : (
                  installedSkills.map(skill => (
                    <span key={skill} className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-mono text-indigo-300 flex items-center gap-1.5">
                      <Zap size={10} className={skill === 'codebrain-skill' ? 'text-emerald-400' : 'text-indigo-400'} />
                      {skill}
                    </span>
                  ))
                )}
              </div>
            </div>

            <Divider />

            {/* Codebrain Skill */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-300">Codebrain Skill</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Instala o skill do Codebrain no ambiente Claude.</p>
                {skillStatus && (
                  <p className={`text-[9px] font-mono mt-1 ${skillStatus.installed ? 'text-emerald-400' : 'text-slate-700'}`}>
                    {skillStatus.installed ? '✓ Instalada' : '✗ Não instalada'}
                  </p>
                )}
              </div>
              <button
                onClick={handleSkillToggle}
                disabled={skillBusy || skillStatus === null}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 ${skillStatus?.installed ? 'border border-red-500/20 text-red-400 hover:bg-red-500/5' : 'bg-[#4F46E5] text-white hover:bg-[#4338CA]'}`}
              >
                {skillBusy ? '…' : skillStatus?.installed ? 'Desinstalar' : 'Instalar'}
              </button>
            </div>

            <Divider />

            {/* OpenClaude CLI */}
            <CliRow
              label="OpenClaude CLI"
              description={<>Motor principal dos agentes Codebrain. Instale via <span className="font-mono">npm install -g @gitlawb/openclaude</span>.</>}
              status={cliStatus}
              installKey="openclaude"
              cliBusy={cliBusy}
              onDetect={handleRedetectCli}
              onInstalled={(k) => { setCliStatus({ found: true }); }}
              setCliBusy={setCliBusy}
            />

            <Divider />

            {/* Claude CLI (official) */}
            <CliRow
              label="Claude Code CLI"
              description={<>CLI oficial da Anthropic — provider <span className="font-mono">Claude (Plano)</span>. Instale via <span className="font-mono">npm install -g @anthropic-ai/claude-code</span>.</>}
              status={claudeCliStatus}
              installKey={null}
              cliBusy={cliBusy}
              onDetect={handleRedetectCli}
              onInstalled={null}
              setCliBusy={setCliBusy}
            />

            <Divider />

            {/* Codex CLI (OpenAI) */}
            <CliRow
              label="Codex CLI (OpenAI)"
              description={<>CLI da OpenAI — provider <span className="font-mono">Codex (ChatGPT)</span>. Instale via <span className="font-mono">npm install -g @openai/codex</span>.</>}
              status={codexCliStatus}
              installKey="codex"
              cliBusy={cliBusy}
              onDetect={handleRedetectCli}
              onInstalled={(k) => { setCodexCliStatus({ found: true }); }}
              setCliBusy={setCliBusy}
            />

            <Divider />

            {/* Gemini CLI (Google) */}
            <CliRow
              label="Gemini CLI (Google)"
              description={<>CLI nativo da Google — provider <span className="font-mono">Gemini CLI</span>. Instale via <span className="font-mono">npm install -g @google/gemini-cli</span>.</>}
              status={geminiCliStatus}
              installKey="gemini"
              cliBusy={cliBusy}
              onDetect={handleRedetectCli}
              onInstalled={(k) => { setGeminiCliStatus({ found: true }); }}
              setCliBusy={setCliBusy}
            />

            <Divider />

            {/* Kimi CLI (Moonshot) */}
            <CliRow
              label="Kimi CLI (Moonshot)"
              description={<>Kimi Code CLI da Moonshot AI. Instala via script oficial: <span className="font-mono">curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash</span></>}
              status={kimiCliStatus}
              installKey="kimi"
              cliBusy={cliBusy}
              onDetect={handleRedetectCli}
              onInstalled={(k) => { setKimiCliStatus({ found: true }); }}
              setCliBusy={setCliBusy}
            />

            <Divider />

            {/* Cursor CLI */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-300">Cursor CLI</p>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  Cursor Agent — binário <span className="font-mono">cursor-agent</span>.
                  {!cursorCliStatus?.found && (
                    <> Instale via <span className="font-mono">cursor.com</span>.</>
                  )}
                </p>
                {cursorCliStatus && (
                  <>
                    <p className={`text-[9px] font-mono mt-1 ${cursorCliStatus.found ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {cursorCliStatus.found ? `✓ ${cursorCliStatus.path ?? 'encontrado'}` : '✗ Não encontrado no PATH'}
                    </p>
                    {cursorCliStatus.version && <p className="text-[9px] font-mono text-slate-700 mt-0.5">{cursorCliStatus.version}</p>}
                  </>
                )}
              </div>
              <button
                onClick={handleRedetectCli}
                disabled={cliBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 disabled:opacity-40 transition-all"
              >
                <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
              </button>
            </div>

            <Divider />

            {/* Copilot CLI (GitHub) */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-300">GitHub Copilot CLI</p>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  GitHub Copilot — binário <span className="font-mono">copilot</span>.
                  {!copilotCliStatus?.found && (
                    <> Instale com <span className="font-mono">npm install -g @github/copilot</span>.</>
                  )}
                </p>
                {copilotCliStatus && (
                  <>
                    <p className={`text-[9px] font-mono mt-1 ${copilotCliStatus.found ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {copilotCliStatus.found ? `✓ ${copilotCliStatus.path ?? 'encontrado'}` : '✗ Não encontrado no PATH'}
                    </p>
                    {copilotCliStatus.version && <p className="text-[9px] font-mono text-slate-700 mt-0.5">{copilotCliStatus.version}</p>}
                  </>
                )}
              </div>
              <button
                onClick={handleRedetectCli}
                disabled={cliBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 disabled:opacity-40 transition-all"
              >
                <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
              </button>
            </div>
          </SectionCard>

          {/* ── Notificações ──────────────────────────────────────────── */}
          <SectionCard id="notifications" icon={<Bell size={13} />} title="Notificações" badge="Desktop" active={open.includes('notifications')} onToggle={toggleSection}>
            <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
              Notificações desktop nativas. Configure quando o Codebrain deve te alertar.
            </p>
            <Row label="Agente completa tarefa" description="Notifica quando um agente fica idle após >30s de atividade">
              <Toggle
                enabled={notifOnTaskComplete}
                onChange={async (v) => {
                  setNotifOnTaskComplete(v);
                  await (window as any).codeBrainApp?.appConfig?.set?.({ notifications: { onTaskComplete: v, onMessage: notifOnMessage, onBuildResult: notifOnBuildResult } });
                }}
              />
            </Row>
            <Divider />
            <Row label="Agente recebe mensagem" description="Notifica ao receber mensagens de outros agentes via pane_send_message">
              <Toggle
                enabled={notifOnMessage}
                onChange={async (v) => {
                  setNotifOnMessage(v);
                  await (window as any).codeBrainApp?.appConfig?.set?.({ notifications: { onTaskComplete: notifOnTaskComplete, onMessage: v, onBuildResult: notifOnBuildResult } });
                }}
              />
            </Row>
            <Divider />
            <Row label="Build falha ou sucede" description="Notifica quando um build/test termina com sucesso ou falha">
              <Toggle
                enabled={notifOnBuildResult}
                onChange={async (v) => {
                  setNotifOnBuildResult(v);
                  await (window as any).codeBrainApp?.appConfig?.set?.({ notifications: { onTaskComplete: notifOnTaskComplete, onMessage: notifOnMessage, onBuildResult: v } });
                }}
              />
            </Row>
            <p className="text-[9px] text-slate-600 font-mono mt-3">
              As notificações são salvas automaticamente ao alternar.
            </p>
          </SectionCard>

          {/* ── Voice / BrainVoice ───────────────────────────────────── */}
          <SectionCard id="voice" icon={<Mic size={13} />} title="Voz / BrainVoice" badge={audioConfig?.apiKeySet || audioConfig?.localReady ? '✓ Pronto' : 'Config'} active={open.includes('voice')} onToggle={toggleSection}>
            <div className="space-y-3">
              {/* Provider selector */}
              <div>
                <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1.5">Provider de transcrição</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAudioConfig((c: any) => c ? { ...c, provider: 'local' } : { provider: 'local' })}
                    className={`text-left p-2 rounded border transition-all ${audioConfig?.provider === 'local' ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-white/10 bg-white/[0.02] text-slate-500 hover:text-slate-300 hover:border-white/20'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                      <Cpu size={12} strokeWidth={1.5} /> Local
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-slate-600">Zero custo. Usa CPU/GPU e modelo no disco.</p>
                  </button>
                  <button
                    onClick={() => setAudioConfig((c: any) => c ? { ...c, provider: 'groq' } : { provider: 'groq' })}
                    className={`text-left p-2 rounded border transition-all ${audioConfig?.provider === 'groq' || !audioConfig?.provider ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-white/10 bg-white/[0.02] text-slate-500 hover:text-slate-300 hover:border-white/20'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] font-bold uppercase tracking-widest">
                      <Cloud size={12} strokeWidth={1.5} /> Groq
                    </div>
                    <p className="font-mono text-[9px] leading-relaxed text-slate-600">Cloud rápido. Usa API key Groq (whisper-large-v3).</p>
                  </button>
                </div>
              </div>

              {/* Local config */}
              {audioConfig?.provider === 'local' ? (
                <div className="space-y-2">
                  <div>
                    <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Binário whisper.cpp</p>
                    <input
                      value={audioConfig?.localBinaryPath ?? ''}
                      onChange={e => setAudioConfig((c: any) => ({ ...c, localBinaryPath: e.target.value }))}
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-violet-500/40"
                      placeholder="Auto: whisper-cli no PATH"
                    />
                  </div>
                  <div>
                    <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Modelo local .bin</p>
                    <input
                      value={audioConfig?.localModelPath ?? ''}
                      onChange={e => setAudioConfig((c: any) => ({ ...c, localModelPath: e.target.value }))}
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-violet-500/40"
                      placeholder="ex: ~/.codebrain-app/models/ggml-small.bin"
                    />
                    <p className="font-mono text-[9px] text-slate-700 mt-1">whisper.cpp + modelo ggml. O Codebrain converte chunks com ffmpeg.</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Groq API Key</p>
                  <input
                    type="password"
                    value={audioKey}
                    onChange={e => setAudioKey(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-violet-500/40"
                    placeholder={audioConfig?.apiKeySet ? '••••••••' : 'gsk_...'}
                  />
                </div>
              )}

              <Divider />

              {/* Model + Language */}
              <div className="grid grid-cols-2 gap-2">
                {audioConfig?.provider !== 'local' && (
                  <div>
                    <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Modelo</p>
                    <select
                      value={audioConfig?.model ?? 'whisper-large-v3'}
                      onChange={e => setAudioConfig((c: any) => ({ ...c, model: e.target.value }))}
                      className="w-full bg-[#1A1A22] border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-slate-300 focus:outline-none focus:border-violet-500/40 appearance-none"
                    >
                      <option value="whisper-large-v3">whisper-large-v3</option>
                      <option value="whisper-large-v3-turbo">whisper-large-v3-turbo</option>
                    </select>
                  </div>
                )}
                <div>
                  <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Idioma</p>
                  <select
                    value={audioConfig?.language ?? ''}
                    onChange={e => setAudioConfig((c: any) => ({ ...c, language: e.target.value }))}
                    className="w-full bg-[#1A1A22] border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-slate-300 focus:outline-none focus:border-violet-500/40 appearance-none"
                  >
                    <option value="">Auto</option>
                    <option value="pt">pt</option>
                    <option value="en">en</option>
                    <option value="es">es</option>
                  </select>
                </div>
              </div>

              {/* Capture mode */}
              <div>
                <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Captura</p>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setAudioConfig((c: any) => ({ ...c, captureMode: 'hold' }))}
                    className={`px-2 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${(audioConfig?.captureMode ?? 'hold') === 'hold' ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'}`}
                  >Hold</button>
                  <button
                    onClick={() => setAudioConfig((c: any) => ({ ...c, captureMode: 'toggle' }))}
                    className={`px-2 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${audioConfig?.captureMode === 'toggle' ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20'}`}
                  >Toggle</button>
                </div>
              </div>

              {/* Interaction mode */}
              <div>
                <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Modo</p>
                <button
                  onClick={() => {
                    const cur = normalizedVoiceMode(audioConfig?.interactionMode);
                    const next = cur === 'coding' ? 'conversation' : 'coding';
                    setAudioConfig((c: any) => ({ ...c, interactionMode: next, outputMode: outputModeForInteractionMode(next) }));
                  }}
                  className="w-full px-2 py-1.5 rounded border border-white/10 bg-white/[0.02] font-mono text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-white/20 transition-all"
                >
                  {normalizedVoiceMode(audioConfig?.interactionMode) === 'coding' ? '🖥 Code (traduz para EN)' : '💬 Chat (mantém idioma original)'}
                </button>
              </div>

              {/* Chunk ms + Target WPM */}
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest">Chunk</p>
                    <span className="font-mono text-[9px] text-slate-500">{((audioConfig?.chunkMs ?? 2800) / 1000).toFixed(1)}s</span>
                  </div>
                  <input type="range" min={1800} max={6000} step={100}
                    value={audioConfig?.chunkMs ?? 2800}
                    onChange={e => setAudioConfig((c: any) => ({ ...c, chunkMs: Number(e.target.value) }))}
                    className="w-full accent-violet-500" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest">Ritmo alvo</p>
                    <span className="font-mono text-[9px] text-slate-500">{audioConfig?.targetWpm ?? 150} PPM</span>
                  </div>
                  <input type="range" min={80} max={240} step={5}
                    value={audioConfig?.targetWpm ?? 150}
                    onChange={e => setAudioConfig((c: any) => ({ ...c, targetWpm: Number(e.target.value) }))}
                    className="w-full accent-violet-500" />
                </div>
              </div>

              {/* STT Prompt */}
              <div>
                <p className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">Prompt STT (contexto técnico)</p>
                <input
                  value={audioConfig?.prompt ?? ''}
                  onChange={e => setAudioConfig((c: any) => ({ ...c, prompt: e.target.value }))}
                  className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-violet-500/40"
                  placeholder="Codebrain, Claude, Codex, MCP, Supabase, Groq"
                />
              </div>

              {/* Save button */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={async () => {
                    if (!audioConfig) return;
                    setAudioBusy(true);
                    setAudioMsg(null);
                    try {
                      const patch: any = {
                        provider: audioConfig.provider,
                        baseUrl: audioConfig.baseUrl,
                        model: audioConfig.model,
                        localBinaryPath: audioConfig.localBinaryPath,
                        localModelPath: audioConfig.localModelPath,
                        language: audioConfig.language,
                        prompt: audioConfig.prompt,
                        chunkMs: audioConfig.chunkMs,
                        outputMode: audioConfig.outputMode,
                        captureMode: audioConfig.captureMode,
                        interactionMode: audioConfig.interactionMode,
                        targetWpm: audioConfig.targetWpm,
                      };
                      if (audioKey.trim()) patch.apiKey = audioKey.trim();
                      const res = await (window as any).codeBrainApp?.audio?.saveConfig(patch);
                      if (res?.ok && res.config) {
                        setAudioConfig(res.config);
                        setAudioKey('');
                        setAudioMsg('Voz salva.');
                      } else {
                        setAudioMsg('Erro ao salvar.');
                      }
                    } catch { setAudioMsg('Erro ao salvar.'); }
                    finally { setAudioBusy(false); setTimeout(() => setAudioMsg(null), 3000); }
                  }}
                  disabled={audioBusy || !audioConfig}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50 transition-all font-mono text-[10px]"
                >
                  {audioBusy ? <RefreshCw size={12} strokeWidth={1.5} className="animate-spin" /> : <Save size={12} strokeWidth={1.5} />}
                  {audioBusy ? 'Salvando…' : 'Salvar voz'}
                </button>
                {audioMsg && <p className="font-mono text-[9px] text-slate-500">{audioMsg}</p>}
              </div>
            </div>
          </SectionCard>

          {/* ── Discord ──────────────────────────────────────────────── */}
          <SectionCard id="discord" icon={<Gamepad2 size={13} />} title="Discord Rich Presence" active={open.includes('discord')} onToggle={toggleSection}>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Mostre "Codebrain" no seu perfil do Discord enquanto o app estiver aberto.
              Crie um Application em <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">discord.com/developers</a> e cole o Client ID abaixo.
            </p>

            <div className="flex items-center gap-2 mt-2">
              <div className={`w-2 h-2 rounded-full ${discordConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span className="text-[10px] text-slate-400">{discordConnected ? 'Conectado ao Discord' : 'Desconectado'}</span>
            </div>

            <div className="mt-3 space-y-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Application ID</label>
              <input
                type="text"
                value={discordClientId}
                onChange={e => { setDiscordClientId(e.target.value); setDiscordMsg(null); }}
                placeholder="1510333918245683380"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono placeholder-slate-700 focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <button
              onClick={async () => {
                const id = discordClientId.trim();
                if (!id) { setDiscordMsg('Cole o Application ID'); return; }
                try {
                  await (window as any).codeBrainApp?.discord?.setClientId?.(id);
                  setDiscordMsg('Salvo! Reconectando...');
                  setTimeout(async () => {
                    const s = await (window as any).codeBrainApp?.discord?.status?.();
                    setDiscordConnected(s?.connected ?? false);
                    setDiscordMsg(s?.connected ? 'Conectado!' : 'Não foi possível conectar (Discord aberto?)');
                  }, 2000);
                } catch { setDiscordMsg('Erro ao salvar'); }
              }}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-600/30 transition-all"
            >
              <Save size={11} /> Salvar e Reconectar
            </button>

            {discordMsg && <p className="text-[10px] text-slate-400 mt-1">{discordMsg}</p>}
          </SectionCard>

          {/* ── Review Bot (OAuth) ──────────────────────────────────────── */}
          <SectionCard id="oauth" icon={<Link size={13} />} title="Review Bot" badge="OAuth" active={open.includes('oauth')} onToggle={toggleSection}>
            <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
              Conecte sua conta do GitLab ou GitHub como um <strong className="text-slate-300">bot de review</strong>.
              Os comentários de MR/PR aparecerão no nome do aplicativo (ex: "Codebrain Review Bot"), não no seu usuário pessoal.
            </p>

            {/* Status badges */}
            <div className="flex gap-3 mb-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                <Globe size={12} className="text-orange-400" />
                <span className="text-[10px] text-slate-400">GitLab:</span>
                <div className={`w-2 h-2 rounded-full ${oauthStatus?.gitlab?.connected ? 'bg-emerald-400' : 'bg-red-500/60'}`} />
                <span className={`text-[10px] font-medium ${oauthStatus?.gitlab?.connected ? 'text-emerald-400' : 'text-slate-600'}`}>
                  {oauthStatus?.gitlab?.connected ? `Conectado${oauthStatus.gitlab.account ? ' — ' + oauthStatus.gitlab.account : ''}` : 'Não conectado'}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                <Globe size={12} className="text-slate-300" />
                <span className="text-[10px] text-slate-400">GitHub:</span>
                <div className={`w-2 h-2 rounded-full ${oauthStatus?.github?.connected ? 'bg-emerald-400' : 'bg-red-500/60'}`} />
                <span className={`text-[10px] font-medium ${oauthStatus?.github?.connected ? 'text-emerald-400' : 'text-slate-600'}`}>
                  {oauthStatus?.github?.connected ? `Conectado${oauthStatus.github.account ? ' — ' + oauthStatus.github.account : ''}` : 'Não conectado'}
                </span>
              </div>
            </div>

            {oauthError && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 mb-3">
                <p className="text-[10px] text-red-400 flex items-center gap-1.5"><AlertTriangle size={10} /> {oauthError}</p>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
               GITLAB TUTORIAL
            ═══════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 overflow-hidden mb-4">
              <button
                onClick={() => setTutorialOpen(p => ({ ...p, gitlab: !p.gitlab }))}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-orange-500/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Globe size={13} className="text-orange-400" />
                  <span className="text-[11px] font-bold text-orange-300">Tutorial — GitLab OAuth App</span>
                </div>
                {tutorialOpen.gitlab
                  ? <ChevronDown size={13} className="text-orange-400" />
                  : <ChevronRight size={13} className="text-orange-400" />}
              </button>

              {tutorialOpen.gitlab && (
                <div className="px-3 pb-3 space-y-3 border-t border-orange-500/10">
                  <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                    Siga os passos abaixo para criar um OAuth Application no GitLab. Leva menos de 2 minutos.
                  </p>

                  {/* Step 1 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-orange-300">1</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Abra a página de Applications do GitLab</p>
                      <p className="text-[10px] text-slate-500">
                        Clique no link abaixo ou copie e cole no navegador:
                      </p>
                      <div className="flex items-center gap-2">
                        <a
                          href="https://gitlab.com/-/user_settings/applications"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-orange-500/15 border border-orange-500/25 text-orange-300 text-[10px] font-mono hover:bg-orange-500/25 transition-colors"
                        >
                          <ExternalLink size={10} /> gitlab.com/-/user_settings/applications
                        </a>
                        <button
                          onClick={() => copyToClipboard('https://gitlab.com/-/user_settings/applications', 'gitlab-url')}
                          className="p-1.5 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                          title="Copiar URL"
                        >
                          {copiedField === 'gitlab-url'
                            ? <Check size={10} className="text-emerald-400" />
                            : <Copy size={10} className="text-slate-500" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-orange-300">2</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Clique em <span className="text-orange-300">"Add new application"</span></p>
                      <p className="text-[10px] text-slate-500">
                        Fica no canto superior direito da página.
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-orange-300">3</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Preencha o formulário</p>
                      <div className="p-2.5 rounded-md bg-black/20 border border-white/5 space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-orange-400 w-24 shrink-0 pt-0.5">Name</span>
                          <span className="text-[10px] text-slate-400">Qualquer nome, ex: <code className="text-orange-300 bg-orange-500/10 px-1 rounded">Codebrain Review Bot</code></span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-orange-400 w-24 shrink-0 pt-0.5">Redirect URI</span>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[10px] text-orange-300 bg-orange-500/10 px-1.5 py-0.5 rounded font-mono">http://127.0.0.1:19876/callback</code>
                            <button
                              onClick={() => copyToClipboard('http://127.0.0.1:19876/callback', 'gitlab-redirect')}
                              className="p-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                              title="Copiar Redirect URI"
                            >
                              {copiedField === 'gitlab-redirect'
                                ? <Check size={9} className="text-emerald-400" />
                                : <Copy size={9} className="text-slate-500" />}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-orange-400 w-24 shrink-0 pt-0.5">Confidential</span>
                          <span className="text-[10px] text-slate-400">Marque <code className="text-orange-300 bg-orange-500/10 px-1 rounded">✓ Yes</code> (é uma aplicação server-side)</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-orange-400 w-24 shrink-0 pt-0.5">Scopes</span>
                          <span className="text-[10px] text-slate-400">Marque <code className="text-orange-300 bg-orange-500/10 px-1 rounded">api</code> (acesso completo à API para criar notas em MRs)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-orange-300">4</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Clique em <span className="text-orange-300">"Save application"</span></p>
                      <p className="text-[10px] text-slate-500">
                        O GitLab mostrará o <strong className="text-slate-300">Application ID</strong> e o <strong className="text-slate-300">Secret</strong>.
                        Copie ambos e cole nos campos abaixo.
                      </p>
                      <div className="p-2 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                        <AlertTriangle size={10} className="text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-amber-400">O <strong>Secret</strong> só aparece uma vez! Salve-o agora ou terá que gerar um novo.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* GitLab input fields */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Globe size={12} className="text-orange-400" />
                <span className="text-[10px] font-bold text-orange-300 uppercase tracking-widest">GitLab</span>
                {oauthStatus?.gitlab?.connected && (
                  <span className="text-[9px] text-emerald-400 ml-auto">✓ Conectado</span>
                )}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Application ID</label>
                <input
                  type="text"
                  value={gitlabClientId}
                  onChange={e => { setGitlabClientId(e.target.value); setOauthError(null); }}
                  placeholder="Ex: 1a2b3c4d5e6f..."
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono placeholder-slate-700 focus:outline-none focus:border-orange-500/50"
                  disabled={oauthStatus?.gitlab?.connected}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Secret</label>
                <input
                  type="password"
                  value={gitlabClientSecret}
                  onChange={e => { setGitlabClientSecret(e.target.value); setOauthError(null); }}
                  placeholder="Ex: glpat-xxxxxxxxxxxxxxxxxxxx"
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono placeholder-slate-700 focus:outline-none focus:border-orange-500/50"
                  disabled={oauthStatus?.gitlab?.connected}
                />
              </div>
              <div className="flex gap-2">
                {!oauthStatus?.gitlab?.connected ? (
                  <button
                    onClick={() => handleOAuthConnect('gitlab')}
                    disabled={oauthBusy === 'gitlab'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-orange-300 text-[10px] font-bold uppercase tracking-widest hover:bg-orange-600/30 disabled:opacity-50 transition-all"
                  >
                    <Lock size={10} />
                    {oauthBusy === 'gitlab' ? 'Conectando...' : 'Conectar GitLab'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleOAuthDisconnect('gitlab')}
                    disabled={oauthBusy === 'gitlab'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/15 border border-red-500/25 text-red-400 text-[10px] font-bold uppercase tracking-widest hover:bg-red-600/25 disabled:opacity-50 transition-all"
                  >
                    <X size={10} /> Desconectar
                  </button>
                )}
              </div>
            </div>

            <div className="border-t border-white/5 my-4" />

            {/* ═══════════════════════════════════════════════════════════
               GITHUB TUTORIAL
            ═══════════════════════════════════════════════════════════ */}
            <div className="rounded-lg border border-slate-500/20 bg-slate-500/5 overflow-hidden mb-4">
              <button
                onClick={() => setTutorialOpen(p => ({ ...p, github: !p.github }))}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-500/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Globe size={13} className="text-slate-300" />
                  <span className="text-[11px] font-bold text-slate-300">Tutorial — GitHub OAuth App</span>
                </div>
                {tutorialOpen.github
                  ? <ChevronDown size={13} className="text-slate-400" />
                  : <ChevronRight size={13} className="text-slate-400" />}
              </button>

              {tutorialOpen.github && (
                <div className="px-3 pb-3 space-y-3 border-t border-slate-500/10">
                  <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                    Siga os passos abaixo para criar um OAuth App no GitHub. Leva menos de 2 minutos.
                  </p>

                  {/* Step 1 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-slate-500/20 border border-slate-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-slate-300">1</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Abra a página de criação de OAuth App</p>
                      <div className="flex items-center gap-2">
                        <a
                          href="https://github.com/settings/apps/new"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-500/15 border border-slate-500/25 text-slate-300 text-[10px] font-mono hover:bg-slate-500/25 transition-colors"
                        >
                          <ExternalLink size={10} /> github.com/settings/apps/new
                        </a>
                        <button
                          onClick={() => copyToClipboard('https://github.com/settings/apps/new', 'github-url')}
                          className="p-1.5 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                          title="Copiar URL"
                        >
                          {copiedField === 'github-url'
                            ? <Check size={10} className="text-emerald-400" />
                            : <Copy size={10} className="text-slate-500" />}
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-600">Vá em Settings → Developer settings → OAuth Apps → New OAuth App</p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-slate-500/20 border border-slate-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-slate-300">2</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Preencha o formulário</p>
                      <div className="p-2.5 rounded-md bg-black/20 border border-white/5 space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-slate-400 w-32 shrink-0 pt-0.5">Application name</span>
                          <span className="text-[10px] text-slate-400">Qualquer nome, ex: <code className="text-slate-300 bg-slate-500/10 px-1 rounded">Codebrain Review Bot</code></span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-slate-400 w-32 shrink-0 pt-0.5">Homepage URL</span>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[10px] text-slate-300 bg-slate-500/10 px-1.5 py-0.5 rounded font-mono">https://github.com</code>
                            <button
                              onClick={() => copyToClipboard('https://github.com', 'github-homepage')}
                              className="p-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                              title="Copiar"
                            >
                              {copiedField === 'github-homepage'
                                ? <Check size={9} className="text-emerald-400" />
                                : <Copy size={9} className="text-slate-500" />}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-slate-400 w-32 shrink-0 pt-0.5">Authorization callback URL</span>
                          <div className="flex items-center gap-1.5">
                            <code className="text-[10px] text-slate-300 bg-slate-500/10 px-1.5 py-0.5 rounded font-mono">http://127.0.0.1:19876/callback</code>
                            <button
                              onClick={() => copyToClipboard('http://127.0.0.1:19876/callback', 'github-callback')}
                              className="p-1 rounded bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                              title="Copiar Redirect URI"
                            >
                              {copiedField === 'github-callback'
                                ? <Check size={9} className="text-emerald-400" />
                                : <Copy size={9} className="text-slate-500" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-slate-500/20 border border-slate-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] font-bold text-slate-300">3</span>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-300">Clique em <span className="text-slate-200">"Register application"</span></p>
                      <p className="text-[10px] text-slate-500">
                        Na próxima página, copie o <strong className="text-slate-300">Client ID</strong>.
                        O GitHub usa <strong className="text-slate-300">Device Flow</strong>, então não é necessário gerar um Client Secret.
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-2">
                    <Info size={10} className="text-indigo-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-indigo-300">
                      O GitHub usa <strong>Device Flow</strong>: ao conectar, uma janela do navegador abrirá pedindo autorização.
                      Você verá um código para confirmar no site do GitHub.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* GitHub input fields */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Globe size={12} className="text-slate-300" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">GitHub</span>
                {oauthStatus?.github?.connected && (
                  <span className="text-[9px] text-emerald-400 ml-auto">✓ Conectado</span>
                )}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Client ID</label>
                <input
                  type="text"
                  value={githubClientId}
                  onChange={e => { setGithubClientId(e.target.value); setOauthError(null); }}
                  placeholder="Ex: Iv1.abc123def456..."
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono placeholder-slate-700 focus:outline-none focus:border-slate-400/30"
                  disabled={oauthStatus?.github?.connected}
                />
              </div>
              <div className="flex gap-2">
                {!oauthStatus?.github?.connected ? (
                  <button
                    onClick={() => handleOAuthConnect('github')}
                    disabled={oauthBusy === 'github'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-600/20 border border-slate-500/30 text-slate-300 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-600/30 disabled:opacity-50 transition-all"
                  >
                    <Lock size={10} />
                    {oauthBusy === 'github' ? 'Conectando...' : 'Conectar GitHub'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleOAuthDisconnect('github')}
                    disabled={oauthBusy === 'github'}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/15 border border-red-500/25 text-red-400 text-[10px] font-bold uppercase tracking-widest hover:bg-red-600/25 disabled:opacity-50 transition-all"
                  >
                    <X size={10} /> Desconectar
                  </button>
                )}
              </div>
            </div>

            <div className="border-t border-white/5 my-4" />

            {/* ── Bot Token (PAT) for Review Comments ─────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Lock size={12} className="text-amber-400" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Token do Bot (para comentários)</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Para que os comentários de review apareçam como <strong className="text-slate-300">@codebrain-bot</strong> em vez do seu nome,
                cole um <strong className="text-slate-300">Project Access Token</strong> com role <strong className="text-slate-300">Owner</strong> ou <strong className="text-slate-300">Maintainer</strong> abaixo.
              </p>
              <p className="text-[10px] text-slate-600">
                GitLab: Project → Settings → Access Tokens → Role: <strong className="text-slate-400">Owner</strong> → Scopes: <strong className="text-slate-400">api</strong>
              </p>

              {/* GitLab Bot Token */}
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">GitLab Bot Token</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="password"
                    value={gitlabBotToken}
                    onChange={e => setGitlabBotToken(e.target.value)}
                    placeholder="glpat-xxxxxxxxxxxxxxxxxxxx (Project Access Token)"
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono placeholder-slate-700 focus:outline-none focus:border-amber-500/30"
                  />
                  <button
                    onClick={async () => {
                      setBotTokenSaving('gitlab');
                      setBotTokenSaved(null);
                      try {
                        await (window as any).codeBrainApp?.appConfig?.set?.({ gitlab_bot_token: gitlabBotToken.trim() });
                        setBotTokenSaved('gitlab');
                        setTimeout(() => setBotTokenSaved(null), 2000);
                      } catch {}
                      setBotTokenSaving(null);
                    }}
                    disabled={botTokenSaving === 'gitlab'}
                    className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                      botTokenSaved === 'gitlab'
                        ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                        : botTokenSaving === 'gitlab'
                        ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400 animate-pulse'
                        : 'bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                    }`}
                  >
                    {botTokenSaved === 'gitlab' ? '✓ Salvo' : botTokenSaving === 'gitlab' ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>

              {/* GitHub Bot Token */}
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">GitHub Bot Token</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="password"
                    value={githubBotToken}
                    onChange={e => setGithubBotToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono placeholder-slate-700 focus:outline-none focus:border-amber-500/30"
                  />
                  <button
                    onClick={async () => {
                      setBotTokenSaving('github');
                      setBotTokenSaved(null);
                      try {
                        await (window as any).codeBrainApp?.appConfig?.set?.({ github_bot_token: githubBotToken.trim() });
                        setBotTokenSaved('github');
                        setTimeout(() => setBotTokenSaved(null), 2000);
                      } catch {}
                      setBotTokenSaving(null);
                    }}
                    disabled={botTokenSaving === 'github'}
                    className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                      botTokenSaved === 'github'
                        ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                        : botTokenSaving === 'github'
                        ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400 animate-pulse'
                        : 'bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                    }`}
                  >
                    {botTokenSaved === 'github' ? '✓ Salvo' : botTokenSaving === 'github' ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-white/5 my-4" />

            {/* ── Auto-Review Toggle ─────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="space-y-0.5">
                <p className="text-[11px] font-bold text-slate-300">Review Automático de MRs</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Quando ativado, o Codebrain revisa automaticamente novos MRs e posta comentários.
                  Quando desativado, só revisa quando você pedir explicitamente.
                </p>
              </div>
              <Toggle
                enabled={mrAutoReview}
                onChange={async (v) => {
                  setMrAutoReview(v);
                  try {
                    await (window as any).codeBrainApp?.appConfig?.set?.({ mr_auto_review: v });
                  } catch {}
                }}
              />
            </div>

            {/* ── Review Model / Provider ─────────────────────────────────── */}
            {mrAutoReview && (
              <div className="mt-2 p-3 rounded-lg bg-white/[0.02] border border-white/5 space-y-2">
                <p className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Cpu size={12} className="text-violet-400" />
                  Modelo para Review
                </p>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Escolha qual modelo de IA será usado para analisar os diffs e gerar comentários de review.
                </p>
                <div className="flex gap-2">
                  <select
                    value={mrReviewProvider}
                    onChange={async (e) => {
                      const val = e.target.value;
                      setMrReviewProvider(val);
                      setMrReviewModel(''); // Reset model when provider changes
                      try {
                        await (window as any).codeBrainApp?.appConfig?.set?.({ mr_review_provider: val, mr_review_model: '' });
                      } catch {}
                    }}
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-violet-500/30 appearance-none cursor-pointer"
                  >
                    <option value="">Provider...</option>
                    {providers.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.label || p.id}</option>
                    ))}
                  </select>
                  <select
                    value={mrReviewModel}
                    onChange={async (e) => {
                      const val = e.target.value;
                      setMrReviewModel(val);
                      try {
                        await (window as any).codeBrainApp?.appConfig?.set?.({ mr_review_model: val });
                      } catch {}
                    }}
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-violet-500/30 appearance-none cursor-pointer"
                  >
                    <option value="">Modelo...</option>
                    {(providers.find((p: any) => p.id === mrReviewProvider)?.models ?? []).map((m: string) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                {mrReviewProvider && mrReviewModel && (
                  <p className="text-[10px] text-emerald-400/70 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {providers.find((p: any) => p.id === mrReviewProvider)?.label || mrReviewProvider} → {mrReviewModel}
                  </p>
                )}
                {!mrReviewProvider && (
                  <p className="text-[10px] text-amber-500/60 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Configure um modelo para que o review funcione.
                  </p>
                )}
              </div>
            )}

            {/* ── Per-Workspace Repo Permissions ─────────────────────────── */}
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <FolderGit2 size={12} className="text-emerald-400" />
                  Repositórios Permitidos
                </p>
                <button
                  onClick={() => fetchAllowed()}
                  disabled={mrLoading}
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={10} className={mrLoading ? 'animate-spin' : ''} />
                  Detectar
                </button>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Por padrão, nenhum repositório é permitido. Ative apenas os que deseja que o Codebrain revise automaticamente.
              </p>

              {mrLoading && detectedWorkspaces.length === 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <RefreshCw size={12} className="text-slate-500 animate-spin" />
                  <span className="text-[10px] text-slate-500">Detectando repositórios git...</span>
                </div>
              ) : detectedWorkspaces.length === 0 ? (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-center">
                  <FolderGit2 size={16} className="text-slate-600 mx-auto mb-1" />
                  <p className="text-[10px] text-slate-500">Nenhum repositório git detectado.</p>
                  <p className="text-[10px] text-slate-600">Abra um workspace com repositório git e clique em Detectar.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {detectedWorkspaces.map((ws) => {
                    const isAllowed = allowedWorkspaces.includes(ws.path);
                    return (
                      <div
                        key={ws.path}
                        className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border transition-all ${
                          isAllowed
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isAllowed ? 'bg-emerald-500/15' : 'bg-slate-600/20'
                          }`}>
                            <GitPullRequest size={13} className={isAllowed ? 'text-emerald-400' : 'text-slate-500'} />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-[11px] font-semibold truncate ${isAllowed ? 'text-emerald-300' : 'text-slate-400'}`}>
                              {ws.name}
                            </p>
                            <p className="text-[9px] text-slate-600 truncate">{ws.path}</p>
                          </div>
                        </div>
                        <Toggle
                          enabled={isAllowed}
                          onChange={() => toggleWorkspace(ws.path)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Info footer */}
            <div className="p-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/15 flex items-start gap-2 mt-3">
              <Info size={11} className="text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Os tokens são criptografados com AES-256 e salvos localmente no SQLite.
                Nenhum dado sai da sua máquina. Se desconectar, o Codebrain volta a usar o CLI (gh/glab) como fallback.
              </p>
            </div>
          </SectionCard>

          {/* ── Avançado ─────────────────────────────────────────────── */}
          <SectionCard id="advanced" icon={<Shield size={13} />} title="Avançado" badge="Cuidado" active={open.includes('advanced')} onToggle={toggleSection}>
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/15 flex items-start gap-2.5">
              <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-500 leading-relaxed">Ações irreversíveis. Confirme antes de prosseguir.</p>
            </div>

            <button
              onClick={() => {
                if (!window.confirm('Resetar tamanho de fonte e zoom ao padrão?')) return;
                resetFontSize();
                resetAppZoom();
                setLineHeight(1);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 transition-all"
            >
              <RotateCcw size={11} /> Resetar Terminal ao Padrão
            </button>

            <button
              onClick={() => {
                if (!window.confirm('Resetar zoom da interface e tamanho de fonte ao padrão?')) return;
                resetAppZoom();
                resetFontSize();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 transition-all"
            >
              <Monitor size={11} /> Resetar Zoom da Interface
            </button>
          </SectionCard>
        </div>
      </section>

      {/* Right sidebar — live summary */}
      <aside className="w-64 border-l border-white/5 bg-[#0F0F13] hidden xl:flex flex-col p-6 gap-6 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div>
          <h2 className="text-[13px] font-bold text-white mb-1">Config Atual</h2>
          <p className="text-[9px] text-slate-500 font-mono">Aplicado ao terminal</p>
        </div>

        <div className="space-y-0.5">
          {[
            { label: 'Fonte',      value: FONT_OPTIONS.find(f => f.id === fontFamily)?.label ?? fontFamily },
            { label: 'Tamanho',   value: `${fontSize}px` },
            { label: 'Linha',     value: lineHeight.toFixed(1) },
            { label: 'Zoom',      value: `${(appZoom * 100).toFixed(0)}%` },
            { label: 'Tema',      value: theme === 'light' ? 'Claro' : 'Escuro' },
            { label: 'Shell',     value: defaultShellPath ? defaultShellPath.split('/').pop() ?? defaultShellPath : 'Sistema padrão' },
            { label: 'Providers', value: `${providers.length} configurado${providers.length !== 1 ? 's' : ''}` },
            { label: 'Env Vars',  value: `${Object.keys(globalEnv).length} variáve${Object.keys(globalEnv).length !== 1 ? 'is' : 'l'}` },
            { label: 'Skill',     value: skillStatus === null ? '—' : skillStatus.installed ? 'Instalada' : 'Não instalada' },
            { label: 'CLI',       value: cliStatus === null ? '—' : cliStatus.found ? 'Encontrada' : 'Não encontrada' },
            { label: 'Notificações', value: `${[notifOnTaskComplete && 'tarefa', notifOnMessage && 'msg', notifOnBuildResult && 'build'].filter(Boolean).length} ativa(s)` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-[10px] py-2 border-b border-white/[0.04]">
              <span className="text-slate-600">{label}</span>
              <span className="font-mono text-slate-300 truncate ml-2 max-w-[120px] text-right">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <div className="p-3 rounded-lg bg-[#4F46E5]/5 border border-[#4F46E5]/10 flex items-start gap-2">
            <Info size={11} className="text-[#4F46E5] shrink-0 mt-0.5" />
            <p className="text-[9px] text-slate-600 leading-relaxed">Todas as configurações são salvas automaticamente via Zustand + localStorage.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
