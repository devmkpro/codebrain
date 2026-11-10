import React, { useState, useEffect } from 'react';
import {
  Terminal, Zap, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Info, Save,
  RotateCcw, Download, Trash2, RefreshCw, Shield,
  Type, Monitor, Plus, X, Variable, Gamepad2, Bell,
  Mic, Cloud, Cpu, Link, Copy, Check, ExternalLink,
  Globe, Lock, GitPullRequest, FolderGit2,
  Store, FlaskConical,
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
import { LabSection } from '../../components/settings/LabSection';
import { MarketplaceSection, type MarketplaceSummary } from '../../components/settings/MarketplaceSection';
import { normalizedVoiceMode, outputModeForInteractionMode } from '../../stores/tasks-store';
import { HOST_LABELS } from '../../lib/resolve-spawn-target';
import { Badge, Prompt, Section as SectionBlock, SectionRule, SettingRow, Toggle } from '../../components/ui/primitives';
import { useSectionNavigation } from '../../components/shell/section-navigation';

type Section = 'terminal' | 'shell' | 'providers' | 'preferredAgent' | 'spawn' | 'envvars' | 'skill' | 'marketplace' | 'voice' | 'notifications' | 'discord' | 'lab' | 'advanced';

// ─── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ value, onIncrease, onDecrease, onReset, unit = '' }: {
  value: number | string; onIncrease?: () => void; onDecrease?: () => void; onReset?: () => void; unit?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      {onDecrease && <button type="button" onClick={onDecrease} aria-label="Diminuir" className="cb-btn cb-btn--sm cb-btn--icon">−</button>}
      <span className="text-sm text-cb-fg-0 w-12 text-center tabular-nums">{value}{unit}</span>
      {onIncrease && <button type="button" onClick={onIncrease} aria-label="Aumentar" className="cb-btn cb-btn--sm cb-btn--icon">+</button>}
      {onReset && <button type="button" onClick={onReset} className="cb-btn cb-btn--ghost cb-btn--sm">padrão</button>}
    </div>
  );
}

// ─── Seção ────────────────────────────────────────────────────────────────────
function SectionCard({ id, icon, title, badge, children, active, onToggle }: {
  id: Section; icon: React.ReactNode; title: string; badge?: string;
  children: React.ReactNode; active: boolean; onToggle: (s: Section) => void;
}) {
  return (
    <SectionBlock
      id={`settings-${id}`}
      icon={icon}
      title={title}
      badge={badge ? <Badge>{badge}</Badge> : undefined}
      open={active}
      onToggle={() => onToggle(id)}
    >
      {children}
    </SectionBlock>
  );
}

/** Rotula o interruptor com o próprio texto da linha, para leitores de tela. */
function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  const control = React.isValidElement(children) && children.type === Toggle
    ? React.cloneElement(children as React.ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
    : children;
  return <SettingRow label={label} description={description}>{control}</SettingRow>;
}

function Divider() {
  return <div className="border-t border-cb-line-0" />;
}

function RangeLimits({ min, max }: { min: string; max: string }) {
  return <div className="flex justify-between text-xs text-cb-fg-2 -mt-3"><span>{min}</span><span>{max}</span></div>;
}

function StatusValue({ state, children }: { state: 'ok' | 'off' | 'unknown'; children: React.ReactNode }) {
  return <span className={state === 'ok' ? 'text-cb-success' : 'text-cb-fg-2'}>{children}</span>;
}

const NAV_GROUPS: { label: string; items: { id: Section; icon: React.ReactNode; label: string }[] }[] = [
  { label: 'ambiente', items: [
    { id: 'terminal', icon: <Type size={13} />, label: 'Terminal' },
    { id: 'shell', icon: <Terminal size={13} />, label: 'Shell' },
  ] },
  { label: 'agentes', items: [
    { id: 'providers', icon: <Zap size={13} />, label: 'Providers' },
    { id: 'preferredAgent', icon: <Cpu size={13} />, label: 'CLI preferido' },
    { id: 'spawn', icon: <Monitor size={13} />, label: 'Spawn padrão' },
    { id: 'envvars', icon: <Variable size={13} />, label: 'Env vars' },
  ] },
  { label: 'extensões', items: [
    { id: 'skill', icon: <Download size={13} />, label: 'Skill & CLI' },
    { id: 'marketplace', icon: <Store size={13} />, label: 'Marketplace' },
  ] },
  { label: 'integrações', items: [
    { id: 'notifications', icon: <Bell size={13} />, label: 'Notificações' },
    { id: 'voice', icon: <Mic size={13} />, label: 'Voz' },
    { id: 'discord', icon: <Gamepad2 size={13} />, label: 'Discord' },
  ] },
  { label: 'sistema', items: [
    { id: 'lab', icon: <FlaskConical size={13} />, label: 'Laboratório' },
    { id: 'advanced', icon: <Shield size={13} />, label: 'Avançado' },
  ] },
];

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
        className="cb-field flex-1"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="value"
        className="cb-field flex-1"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <button
        onClick={handleAdd}
        disabled={!key.trim()}
        className="cb-btn cb-btn--accent justify-center"
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
          <p className="cb-setting__label">{label}</p>
          {status && (
            <span className={`cb-badge ${status.found ? 'cb-badge--success' : 'cb-badge--warn'}`}>
              {status.found ? '✓ instalado' : '✗ não encontrado'}
            </span>
          )}
        </div>
        <p className="cb-setting__help">{description}</p>
        {status?.path && status.found && (
          <p className="text-xs font-mono text-cb-fg-2 mt-0.5 truncate">{status.path}</p>
        )}
        {status?.version && (
          <p className="text-xs font-mono text-cb-fg-2 mt-0.5">{status.version}</p>
        )}
        {installErr && (
          <p className="text-xs font-mono text-cb-danger mt-1 leading-relaxed">{installErr}</p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {installKey && !status?.found && (
          <button
            onClick={handleInstall}
            disabled={isInstalling || cliBusy}
            className="cb-btn cb-btn--accent"
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
          className="cb-btn"
        >
          <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const [open,      setOpen]   = useState<Section[]>(() => {
    try {
      const saved = localStorage.getItem('codebrain.settings.openSection');
      if (saved && saved !== 'terminal') {
        localStorage.removeItem('codebrain.settings.openSection');
        return [saved as Section];
      }
    } catch {}
    return ['terminal'];
  });
  const { scrollRef, selectSection } = useSectionNavigation(setOpen);
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
  const [nineRouterCliStatus, setNineRouterCliStatus] = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [nineRouterServer, setNineRouterServer] = useState<{ checked: boolean; running: boolean; modelCount?: number; error?: string } | null>(null);
  const [nineRouterChecking, setNineRouterChecking] = useState(false);
  const [nineRouterInstalling, setNineRouterInstalling] = useState(false);
  const [nineRouterInstallErr, setNineRouterInstallErr] = useState<string | null>(null);
  const [skillBusy,   setSkillBusy]   = useState(false);
  // Marketplace
  const [marketplaceSummary, setMarketplaceSummary] = useState<MarketplaceSummary | null>(null);
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
  const [preferredAgent, setPreferredAgent] = useState<string | null>(null);

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
        setNineRouterCliStatus(s?.["9router"] ?? null);
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
        if (cfg?.preferredAgent) setPreferredAgent(cfg.preferredAgent);
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
        const ki = res.find((r: any) => r.name === 'kimi');
        const cu = res.find((r: any) => r.name === 'cursor');
        const co = res.find((r: any) => r.name === 'copilot');
        const nr = res.find((r: any) => r.name === '9router');
        if (oc) setCliStatus(oc);
        if (cl) setClaudeCliStatus(cl);
        if (cx) setCodexCliStatus(cx);
        if (gc) setGeminiCliStatus(gc);
        if (ki) setKimiCliStatus(ki);
        if (cu) setCursorCliStatus(cu);
        if (co) setCopilotCliStatus(co);
        if (nr) setNineRouterCliStatus(nr);
      } else {
        setCliStatus(res?.openclaude ?? res);
        setClaudeCliStatus(res?.claude ?? null);
        setCodexCliStatus(res?.codex ?? null);
        setGeminiCliStatus(res?.gemini ?? null);
        setKimiCliStatus(res?.kimi ?? null);
        setCursorCliStatus(res?.cursor ?? null);
        setCopilotCliStatus(res?.copilot ?? null);
        setNineRouterCliStatus(res?.["9router"] ?? null);
      }
    } catch {} finally { setCliBusy(false); }
  };

  const handleInstall9Router = async () => {
    setNineRouterInstalling(true);
    setNineRouterInstallErr(null);
    try {
      const r = await (window as any).codeBrainApp?.cli?.installCli?.('9router');
      if (r?.ok) {
        setNineRouterCliStatus({ found: true });
        handleRedetectCli();
      } else {
        setNineRouterInstallErr(r?.error || 'Erro ao instalar.');
      }
    } catch (e) {
      setNineRouterInstallErr(String(e));
    } finally {
      setNineRouterInstalling(false);
    }
  };

  const handleCheck9RouterServer = async () => {
    if (nineRouterChecking) return;
    setNineRouterChecking(true);
    try {
      const r = await (window as any).codeBrainApp?.cli?.ping9Router?.();
      setNineRouterServer({ checked: true, running: !!r?.ok, modelCount: r?.modelCount, error: r?.ok ? undefined : (r?.error || 'não respondeu') });
    } catch (e) {
      setNineRouterServer({ checked: true, running: false, error: String(e) });
    } finally {
      setNineRouterChecking(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Navegação das seções */}
      <aside className="w-48 shrink-0 border-r border-cb-line-0 bg-cb-bg-1 hidden lg:flex flex-col cb-scroll p-3 gap-4">
        {NAV_GROUPS.map((group) => (
          <nav key={group.label} aria-label={group.label}>
            <h2 className="cb-label px-2 mb-1">{group.label}</h2>
            {group.items.map(({ id, icon, label }) => (
              <button key={id} type="button" onClick={() => selectSection(id)} data-active={open.includes(id)} className="cb-row w-full text-left text-sm min-h-cell-lg">
                <span className={open.includes(id) ? 'text-cb-accent' : 'text-cb-fg-2'} aria-hidden>{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        ))}

        <dl className="mt-auto pt-3 border-t border-cb-line-0 text-xs space-y-1 px-2">
          <div className="flex justify-between gap-2"><dt className="text-cb-fg-2">marketplace</dt><dd className="text-cb-fg-1 tabular-nums">{marketplaceSummary?.loading ? '…' : marketplaceSummary ? `${marketplaceSummary.online} online` : 'online'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-cb-fg-2">skill</dt><dd><StatusValue state={skillStatus?.installed ? 'ok' : 'off'}>{skillStatus === null ? '—' : skillStatus.installed ? 'instalada' : 'ausente'}</StatusValue></dd></div>
          <div className="flex justify-between gap-2"><dt className="text-cb-fg-2">cli</dt><dd><StatusValue state={cliStatus?.found ? 'ok' : 'off'}>{cliStatus === null ? '—' : cliStatus.found ? 'encontrada' : 'ausente'}</StatusValue></dd></div>
        </dl>
      </aside>

      {/* Center */}
      <section ref={scrollRef} className="flex-1 min-w-0 cb-scroll bg-cb-bg-0">
        <div className="max-w-[760px] mx-auto px-5 py-5">

          <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-cb-fg-0 leading-snug"><Prompt>configurações</Prompt></h1>
              <p className="mt-1 text-sm text-cb-fg-2">Aplicadas em tempo real.</p>
            </div>
            <button type="button" onClick={handleSave} className={`cb-btn cb-btn--lg ${saved ? 'cb-btn--success' : 'cb-btn--primary'}`}>
              {saved ? <><CheckCircle2 size={14} />salvo</> : <><Save size={14} />salvar</>}
            </button>
          </header>

          <SectionRule label="ambiente" className="mt-2" />
          {/* ── Terminal ─────────────────────────────────────────────── */}
          <SectionCard id="terminal" icon={<Type size={13} />} title="Terminal" badge="Ativo" active={open.includes('terminal')} onToggle={toggleSection}>
            <Row label="Tamanho da Fonte" description={`Tamanho atual: ${fontSize}px`}>
              <Stepper value={fontSize} unit="px" onIncrease={increaseFontSize} onDecrease={decreaseFontSize} onReset={resetFontSize} />
            </Row>
            <div>
              <input type="range" min={MIN_SIZE} max={MAX_SIZE} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="cb-range w-full" />
              <div className="mt-3"><RangeLimits min={`${MIN_SIZE}px`} max={`${MAX_SIZE}px`} /></div>
            </div>
            <Divider />

            <Row label="Família de Fonte">
              <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}
                className="cb-select"
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
              <input type="range" min={50} max={200} step={10} value={Math.round(appZoom * 100)} onChange={e => useTerminalSettings.setState({ appZoom: Math.max(0.5, Math.min(3, Number(e.target.value) / 100)) })} className="cb-range w-full" />
              <div className="mt-3"><RangeLimits min="50%" max="200%" /></div>
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
                className="cb-select"
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
                  className="cb-select max-w-[200px] truncate"
                >
                  <option value="">Sistema padrão</option>
                  {shells.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Row>
            ) : (
              <p className="text-xs text-cb-fg-2 font-mono">Nenhum shell detectado além do padrão do sistema.</p>
            )}
            {defaultShellPath && (
              <p className="text-xs font-mono text-cb-fg-2 truncate">Atual: {defaultShellPath}</p>
            )}
          </SectionCard>

          <SectionRule label="agentes" className="mt-5" />
          {/* ── Providers ────────────────────────────────────────────── */}
          <SectionCard id="providers" icon={<Zap size={13} />} title="Providers" active={open.includes('providers')} onToggle={toggleSection}>
            <Row label="Modelos e APIs" description="Cada pane pode usar um endpoint ou modelo LLM próprio. Configure aqui — depois escolhe no + PANE">
              <button
                onClick={() => { document.dispatchEvent(new CustomEvent('open-providers-modal')); }}
                className="cb-btn cb-btn--accent"
              >
                Configurar Providers
              </button>
            </Row>
            {providers.length > 0 && <Divider />}
            {providers.length === 0 ? (
              <div className="py-2 text-center">
                <p className="text-sm text-cb-fg-2">Nenhum provider configurado</p>
                <p className="text-xs text-cb-fg-2 mt-1">Clique acima para adicionar</p>
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((p: any) => (
                  <div key={p.id} className="cb-rail" style={{ '--cb-rail-color': 'var(--cb-line-2)' } as React.CSSProperties}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-bold text-cb-fg-0">{p.label}</p>
                        <p className="text-xs font-mono text-cb-fg-2 mt-0.5">{p.id}</p>
                      </div>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-cb-accent-wash text-cb-accent border border-cb-accent-dim uppercase">{p.type ?? 'custom'}</span>
                    </div>
                    {(p.models ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(p.models as string[]).map((m: string) => (
                          <span key={m} className="text-xs font-mono px-1.5 py-0.5 rounded-cb-1 bg-cb-bg-2 text-cb-fg-2 border border-cb-line-0 truncate max-w-[160px]">{m}</span>
                        ))}
                      </div>
                    )}
                    {p.host && <p className="text-xs font-mono text-cb-fg-2 mt-1.5">host: {p.host}</p>}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => loadProviders()}
              className="cb-btn w-full justify-center"
            ><RefreshCw size={11} /> Recarregar Providers</button>
          </SectionCard>

          {/* ── Agent/CLI Preferido ──────────────────────────────────── */}
          <SectionCard id="preferredAgent" icon={<Cpu size={13} />} title="Agent/CLI Preferido" active={open.includes('preferredAgent')} onToggle={toggleSection}>
            <p className="cb-help">
              Desempata qual CLI usar quando um modelo existe em múltiplos providers.
              Ex: <span className="font-mono text-cb-fg-1">mimo-v2.5-pro</span> está no OpenClaude e no Claude Code CLI — a preferência decide.
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="cb-label block mb-1.5">CLI Preferido</label>
                <select
                  value={preferredAgent ?? ''}
                  onChange={e => {
                    const val = e.target.value || null;
                    setPreferredAgent(val);
                    if (val) localStorage.setItem('codebrain.preferredAgent', val);
                    else localStorage.removeItem('codebrain.preferredAgent');
                    window.dispatchEvent(new CustomEvent('preferred-agent-changed', { detail: { preferredAgent: val } }));
                    // Persist to appConfig
                    (window as any).codeBrainApp?.appConfig?.get?.().then((cfg: any) => {
                      (window as any).codeBrainApp?.appConfig?.set?.({ ...cfg, preferredAgent: val ?? undefined });
                    }).catch(() => {});
                  }}
                  className="cb-select w-full"
                >
                  <option value="">Automático (nenhum)</option>
                  <option value="claude">Claude Code CLI</option>
                  <option value="openclaude">OpenClaude</option>
                  <option value="gemini">Gemini CLI</option>
                  <option value="codex">Codex</option>
                </select>
              </div>
              <p className="text-xs text-cb-fg-2 font-mono">
                {preferredAgent
                  ? `Ativo: ${HOST_LABELS[preferredAgent] ?? preferredAgent}`
                  : 'Nenhum — usa o primeiro provider que casar com o modelo.'}
              </p>
            </div>
          </SectionCard>

          {/* ── Spawn Padrão ─────────────────────────────────────────── */}
          <SectionCard id="spawn" icon={<Monitor size={13} />} title="Spawn Padrão" badge="Por Workspace" active={open.includes('spawn')} onToggle={toggleSection}>
            <p className="cb-help">
              Modelo aberto ao clicar em <span className="text-cb-fg-1 font-mono">+Pane</span> ou ao abrir um workspace.
              {activeWorkspace && <span className="ml-1 font-mono text-cb-accent text-xs">{activeWorkspace.split(/[\\/]/).pop()}</span>}
            </p>
            <div className="space-y-3 mt-2">
              <div>
                <label className="cb-label block mb-1.5">Provider padrão</label>
                <select
                  value={defaultProviderId}
                  onChange={e => {
                    setDefaultProviderId(e.target.value);
                    const p = providers.find((p: any) => p.id === e.target.value);
                    setDefaultModel(providerDefaultModels[e.target.value] ?? p?.models?.[0] ?? '');
                  }}
                  className="cb-select w-full"
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
                    <label className="cb-label block mb-1.5">Modelo padrão</label>
                    <select
                      value={defaultModel}
                      onChange={e => setDefaultModel(e.target.value)}
                      className="cb-select w-full"
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
                  className="cb-btn cb-btn--primary"
                >Salvar Padrão</button>
                {spawnMsg && <span className={`text-xs ${spawnMsg.startsWith('Erro') ? 'text-cb-danger' : 'text-cb-success'}`}>{spawnMsg}</span>}
              </div>
            </div>
            {providers.length > 0 && (
              <>
                <Divider />
                <p className="cb-label block mb-2">Padrão por provider</p>
                <div className="space-y-2">
                  {providers.map((p: any) => {
                    const models: string[] = p.models ?? [];
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <span className="text-xs text-cb-fg-1 w-28 truncate shrink-0">{p.label ?? p.id}</span>
                        {models.length > 0 ? (
                          <select
                            value={providerDefaultModels[p.id] ?? models[0]}
                            onChange={e => {
                              const next = { ...providerDefaultModels, [p.id]: e.target.value };
                              setProviderDefaultModels(next);
                              localStorage.setItem('codebrain.providerDefaultModels', JSON.stringify(next));
                            }}
                            className="cb-select flex-1"
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
                            className="cb-field flex-1"
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
            <p className="cb-help mb-3">
              Variáveis de ambiente aplicadas a <span className="text-cb-fg-1 font-medium">todos</span> os agentes spawnados.
              Útil para API keys, base URLs, e flags que precisam estar disponíveis em qualquer terminal.
            </p>
            <div className="space-y-2">
              {Object.entries(globalEnv).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={key}
                    readOnly
                    className="cb-field flex-1"
                  />
                  <input
                    type="password"
                    value={value}
                    onChange={e => {
                      const next = { ...globalEnv, [key]: e.target.value };
                      setGlobalEnv(next);
                    }}
                    className="cb-field flex-1"
                  />
                  <button
                    onClick={() => {
                      const next = { ...globalEnv };
                      delete next[key];
                      setGlobalEnv(next);
                    }}
                    className="cb-btn justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {Object.keys(globalEnv).length === 0 && (
                <p className="text-xs text-cb-fg-2 font-mono py-2 text-center">Nenhuma variável configurada</p>
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
                className="cb-btn cb-btn--primary"
              >
                Salvar Env Vars
              </button>
              {envMsg && (
                <span className={`text-xs ${envMsg.startsWith('Erro') ? 'text-cb-danger' : 'text-cb-success'}`}>
                  {envMsg}
                </span>
              )}
            </div>
            <p className="text-xs text-cb-fg-2 font-mono mt-2">Aplicado em todos os spawns. Para session-only, use export no terminal.</p>
          </SectionCard>

          <SectionRule label="extensões" className="mt-5" />
          {/* ── Skill & CLI ──────────────────────────────────────────── */}
          <SectionCard id="skill" icon={<Download size={13} />} title="Skill & CLI" active={open.includes('skill')} onToggle={toggleSection}>
            {/* Outras skills */}
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="cb-setting__label">Skills do OpenClaude</p>
                  <p className="cb-setting__help">Skills instaladas em <span className="cb-code">~/.claude/skills</span></p>
                </div>
                <button
                  onClick={() => (window as any).codeBrainApp?.skill?.openFolder?.()}
                  className="cb-btn"
                >
                  Abrir Pasta
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {installedSkills.length === 0 ? (
                  <span className="text-xs text-cb-fg-2">Nenhuma skill encontrada (abra a pasta e coloque a sua lá).</span>
                ) : (
                  installedSkills.map(skill => (
                    <span key={skill} className="px-2 py-1 rounded-cb-1 bg-cb-accent-wash border border-cb-accent-dim text-xs font-mono text-cb-accent flex items-center gap-1.5">
                      <Zap size={10} className={skill === 'codebrain-skill' ? 'text-cb-success' : 'text-cb-accent'} />
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
                <p className="cb-setting__label">Codebrain Skill</p>
                <p className="cb-setting__help">Instala o skill do Codebrain no ambiente Claude.</p>
                {skillStatus && (
                  <p className={`text-xs font-mono mt-1 ${skillStatus.installed ? 'text-cb-success' : 'text-cb-fg-2'}`}>
                    {skillStatus.installed ? '✓ Instalada' : '✗ Não instalada'}
                  </p>
                )}
              </div>
              <button
                onClick={handleSkillToggle}
                disabled={skillBusy || skillStatus === null}
                className={skillStatus?.installed ? 'cb-btn cb-btn--danger' : 'cb-btn cb-btn--primary'}
              >
                {skillBusy ? '…' : skillStatus?.installed ? 'Desinstalar' : 'Instalar'}
              </button>
            </div>

            <Divider />

            {/* OpenClaude CLI */}
            <CliRow
              label="OpenClaude CLI"
              description={<>Motor principal dos agentes Codebrain. A instalação automática usa <span className="font-mono">npm</span>, portanto requer Node.js.</>}
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
              description={<>CLI da OpenAI — provider <span className="font-mono">Codex (ChatGPT)</span>. A instalação automática usa <span className="font-mono">npm</span>, portanto requer Node.js.</>}
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
              description={<>CLI nativo da Google — provider <span className="font-mono">Gemini CLI</span>. A instalação automática usa <span className="font-mono">npm</span>, portanto requer Node.js.</>}
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
              description={<>Kimi Code CLI da Moonshot AI. Usa o instalador oficial (PowerShell no Windows); não requer Node.js nem npm.</>}
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
                <p className="cb-setting__label">Cursor CLI</p>
                <p className="cb-setting__help">
                  Cursor Agent — binário <span className="font-mono">cursor-agent</span>.
                  {!cursorCliStatus?.found && (
                    <> Instale via <span className="font-mono">cursor.com</span>.</>
                  )}
                </p>
                {cursorCliStatus && (
                  <>
                    <p className={`text-xs font-mono mt-1 ${cursorCliStatus.found ? 'text-cb-success' : 'text-cb-warn'}`}>
                      {cursorCliStatus.found ? `✓ ${cursorCliStatus.path ?? 'encontrado'}` : '✗ Não encontrado no PATH'}
                    </p>
                    {cursorCliStatus.version && <p className="text-xs font-mono text-cb-fg-2 mt-0.5">{cursorCliStatus.version}</p>}
                  </>
                )}
              </div>
              <button
                onClick={handleRedetectCli}
                disabled={cliBusy}
                className="cb-btn"
              >
                <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
              </button>
            </div>

            <Divider />

            {/* Copilot CLI (GitHub) */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="cb-setting__label">GitHub Copilot CLI</p>
                <p className="cb-setting__help">
                  GitHub Copilot — binário <span className="font-mono">copilot</span>.
                  {!copilotCliStatus?.found && (
                    <> Instale com <span className="font-mono">npm install -g @github/copilot</span>.</>
                  )}
                </p>
                {copilotCliStatus && (
                  <>
                    <p className={`text-xs font-mono mt-1 ${copilotCliStatus.found ? 'text-cb-success' : 'text-cb-warn'}`}>
                      {copilotCliStatus.found ? `✓ ${copilotCliStatus.path ?? 'encontrado'}` : '✗ Não encontrado no PATH'}
                    </p>
                    {copilotCliStatus.version && <p className="text-xs font-mono text-cb-fg-2 mt-0.5">{copilotCliStatus.version}</p>}
                  </>
                )}
              </div>
              <button
                onClick={handleRedetectCli}
                disabled={cliBusy}
                className="cb-btn"
              >
                <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
              </button>
            </div>

            <Divider />

            {/* 9Router (proxy/roteador de LLMs — self-host ou instância remota) */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="cb-setting__label">9Router</p>
                  {nineRouterCliStatus && (
                    <span className={`cb-badge ${nineRouterCliStatus.found ? 'cb-badge--success' : 'cb-badge--warn'}`}>
                      {nineRouterCliStatus.found ? '✓ instalado' : '✗ não encontrado'}
                    </span>
                  )}
                </div>
                <p className="cb-setting__help">
                  Proxy/roteador de LLMs — provider <span className="font-mono">9Router</span> (self-host em <span className="font-mono">localhost:20128</span> ou instância remota/VPS). Instale via <span className="font-mono">npm install -g 9router</span>, depois rode <span className="font-mono">9router</span> num terminal para subir o servidor.
                </p>
                {nineRouterCliStatus?.path && nineRouterCliStatus.found && (
                  <p className="text-xs font-mono text-cb-fg-2 mt-0.5 truncate">{nineRouterCliStatus.path}</p>
                )}
                {nineRouterCliStatus?.version && (
                  <p className="text-xs font-mono text-cb-fg-2 mt-0.5">{nineRouterCliStatus.version}</p>
                )}
                {nineRouterInstallErr && (
                  <p className="text-xs font-mono text-cb-danger mt-1 leading-relaxed">{nineRouterInstallErr}</p>
                )}
                {nineRouterServer?.checked && (
                  <p className={`text-xs font-mono mt-1 ${nineRouterServer.running ? 'text-cb-success' : 'text-cb-warn'}`}>
                    {nineRouterServer.running
                      ? `✓ servidor respondendo em localhost:20128 (${nineRouterServer.modelCount ?? 0} modelos)`
                      : `✗ servidor não respondeu em localhost:20128 — ${nineRouterServer.error} (instâncias remotas: verifique a conexão em Providers → 9Router)`}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {!nineRouterCliStatus?.found && (
                  <button
                    onClick={handleInstall9Router}
                    disabled={nineRouterInstalling || cliBusy}
                    className="cb-btn cb-btn--accent"
                  >
                    {nineRouterInstalling ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
                    {nineRouterInstalling ? 'Instalando…' : 'Instalar'}
                  </button>
                )}
                <button
                  onClick={handleCheck9RouterServer}
                  disabled={nineRouterChecking}
                  className="cb-btn"
                >
                  <Link size={11} className={nineRouterChecking ? 'animate-spin' : ''} /> Verificar servidor
                </button>
                <button
                  onClick={handleRedetectCli}
                  disabled={cliBusy}
                  className="cb-btn"
                >
                  <RefreshCw size={11} className={cliBusy ? 'animate-spin' : ''} /> Detectar
                </button>
              </div>
            </div>
          </SectionCard>

          {/* ── Marketplace ─────────────────────────────────────────────── */}
          <SectionCard id="marketplace" icon={<Store size={13} />} title="Marketplace" badge={marketplaceSummary ? `${marketplaceSummary.online} online · ${marketplaceSummary.installed} instaladas` : "Online"} active={open.includes("marketplace")} onToggle={toggleSection}>
            <MarketplaceSection onSummaryChange={setMarketplaceSummary} />
          </SectionCard>

          <SectionRule label="integrações" className="mt-5" />
          {/* ── Notificações ──────────────────────────────────────────── */}
          <SectionCard id="notifications" icon={<Bell size={13} />} title="Notificações" badge="Desktop" active={open.includes('notifications')} onToggle={toggleSection}>
            <p className="cb-help mb-3">
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
            <p className="text-xs text-cb-fg-2 font-mono mt-3">
              As notificações são salvas automaticamente ao alternar.
            </p>
          </SectionCard>

          {/* ── Voice / BrainVoice ───────────────────────────────────── */}
          <SectionCard id="voice" icon={<Mic size={13} />} title="Voz / BrainVoice" badge={audioConfig?.apiKeySet || audioConfig?.localReady ? '✓ Pronto' : 'Config'} active={open.includes('voice')} onToggle={toggleSection}>
            <div className="space-y-3">
              {/* Provider selector */}
              <div>
                <p className="cb-label block mb-1.5">Provider de transcrição</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAudioConfig((c: any) => c ? { ...c, provider: 'local' } : { provider: 'local' })}
                    aria-pressed={audioConfig?.provider === 'local'}
                    className="cb-choice"
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-xs font-medium">
                      <Cpu size={12} strokeWidth={1.5} /> Local
                    </div>
                    <p className="text-xs leading-relaxed text-cb-fg-2">Zero custo. Usa CPU/GPU e modelo no disco.</p>
                  </button>
                  <button
                    onClick={() => setAudioConfig((c: any) => c ? { ...c, provider: 'groq' } : { provider: 'groq' })}
                    aria-pressed={audioConfig?.provider === 'groq' || !audioConfig?.provider}
                    className="cb-choice"
                  >
                    <div className="flex items-center gap-1.5 mb-1 text-xs font-medium">
                      <Cloud size={12} strokeWidth={1.5} /> Groq
                    </div>
                    <p className="text-xs leading-relaxed text-cb-fg-2">Cloud rápido. Usa API key Groq (whisper-large-v3).</p>
                  </button>
                </div>
              </div>

              {/* Local config */}
              {audioConfig?.provider === 'local' ? (
                <div className="space-y-2">
                  <div>
                    <p className="cb-label block mb-1">Binário whisper.cpp</p>
                    <input
                      value={audioConfig?.localBinaryPath ?? ''}
                      onChange={e => setAudioConfig((c: any) => ({ ...c, localBinaryPath: e.target.value }))}
                      className="cb-field w-full"
                      placeholder="Auto: whisper-cli no PATH"
                    />
                  </div>
                  <div>
                    <p className="cb-label block mb-1">Modelo local .bin</p>
                    <input
                      value={audioConfig?.localModelPath ?? ''}
                      onChange={e => setAudioConfig((c: any) => ({ ...c, localModelPath: e.target.value }))}
                      className="cb-field w-full"
                      placeholder="ex: ~/.codebrain-app/models/ggml-small.bin"
                    />
                    <p className="text-xs text-cb-fg-2 mt-1">whisper.cpp + modelo ggml. O Codebrain converte chunks com ffmpeg.</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="cb-label block mb-1">Groq API Key</p>
                  <input
                    type="password"
                    value={audioKey}
                    onChange={e => setAudioKey(e.target.value)}
                    className="cb-field w-full"
                    placeholder={audioConfig?.apiKeySet ? '••••••••' : 'gsk_...'}
                  />
                </div>
              )}

              <Divider />

              {/* Model + Language */}
              <div className="grid grid-cols-2 gap-2">
                {audioConfig?.provider !== 'local' && (
                  <div>
                    <p className="cb-label block mb-1">Modelo</p>
                    <select
                      value={audioConfig?.model ?? 'whisper-large-v3'}
                      onChange={e => setAudioConfig((c: any) => ({ ...c, model: e.target.value }))}
                      className="cb-select w-full"
                    >
                      <option value="whisper-large-v3">whisper-large-v3</option>
                      <option value="whisper-large-v3-turbo">whisper-large-v3-turbo</option>
                    </select>
                  </div>
                )}
                <div>
                  <p className="cb-label block mb-1">Idioma</p>
                  <select
                    value={audioConfig?.language ?? ''}
                    onChange={e => setAudioConfig((c: any) => ({ ...c, language: e.target.value }))}
                    className="cb-select w-full"
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
                <p className="cb-label block mb-1">Captura</p>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setAudioConfig((c: any) => ({ ...c, captureMode: 'hold' }))}
                    aria-pressed={(audioConfig?.captureMode ?? 'hold') === 'hold'}
                    className="cb-choice text-center text-sm"
                  >Hold</button>
                  <button
                    onClick={() => setAudioConfig((c: any) => ({ ...c, captureMode: 'toggle' }))}
                    aria-pressed={audioConfig?.captureMode === 'toggle'}
                    className="cb-choice text-center text-sm"
                  >Toggle</button>
                </div>
              </div>

              {/* Interaction mode */}
              <div>
                <p className="cb-label block mb-1">Modo</p>
                <button
                  onClick={() => {
                    const cur = normalizedVoiceMode(audioConfig?.interactionMode);
                    const next = cur === 'coding' ? 'conversation' : 'coding';
                    setAudioConfig((c: any) => ({ ...c, interactionMode: next, outputMode: outputModeForInteractionMode(next) }));
                  }}
                  className="cb-btn w-full"
                >
                  {normalizedVoiceMode(audioConfig?.interactionMode) === 'coding' ? 'Code (traduz para EN)' : 'Chat (mantém idioma original)'}
                </button>
              </div>

              {/* Chunk ms + Target WPM */}
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="cb-label block">Chunk</p>
                    <span className="text-xs text-cb-fg-2">{((audioConfig?.chunkMs ?? 2800) / 1000).toFixed(1)}s</span>
                  </div>
                  <input type="range" min={1800} max={6000} step={100}
                    value={audioConfig?.chunkMs ?? 2800}
                    onChange={e => setAudioConfig((c: any) => ({ ...c, chunkMs: Number(e.target.value) }))}
                    className="cb-range w-full" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="cb-label block">Ritmo alvo</p>
                    <span className="text-xs text-cb-fg-2">{audioConfig?.targetWpm ?? 150} PPM</span>
                  </div>
                  <input type="range" min={80} max={240} step={5}
                    value={audioConfig?.targetWpm ?? 150}
                    onChange={e => setAudioConfig((c: any) => ({ ...c, targetWpm: Number(e.target.value) }))}
                    className="cb-range w-full" />
                </div>
              </div>

              {/* STT Prompt */}
              <div>
                <p className="cb-label block mb-1">Prompt STT (contexto técnico)</p>
                <input
                  value={audioConfig?.prompt ?? ''}
                  onChange={e => setAudioConfig((c: any) => ({ ...c, prompt: e.target.value }))}
                  className="cb-field w-full"
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
                  className="cb-btn cb-btn--accent"
                >
                  {audioBusy ? <RefreshCw size={12} strokeWidth={1.5} className="animate-spin" /> : <Save size={12} strokeWidth={1.5} />}
                  {audioBusy ? 'Salvando…' : 'Salvar voz'}
                </button>
                {audioMsg && <p className="text-xs text-cb-fg-2">{audioMsg}</p>}
              </div>
            </div>
          </SectionCard>

          {/* ── Discord ──────────────────────────────────────────────── */}
          <SectionCard id="discord" icon={<Gamepad2 size={13} />} title="Discord Rich Presence" active={open.includes('discord')} onToggle={toggleSection}>
            <p className="cb-help">
              Mostre "Codebrain" no seu perfil do Discord enquanto o app estiver aberto.
              Crie um Application em <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-cb-accent hover:underline">discord.com/developers</a> e cole o Client ID abaixo.
            </p>

            <div className="flex items-center gap-2 mt-2">
              <div className="cb-dot" style={{ '--cb-dot-color': discordConnected ? 'var(--cb-success)' : 'var(--cb-fg-3)' } as React.CSSProperties} />
              <span className="text-xs text-cb-fg-1">{discordConnected ? 'Conectado ao Discord' : 'Desconectado'}</span>
            </div>

            <div className="mt-3 space-y-2">
              <label className="text-xs text-cb-fg-2 font-medium">Application ID</label>
              <input
                type="text"
                value={discordClientId}
                onChange={e => { setDiscordClientId(e.target.value); setDiscordMsg(null); }}
                placeholder="1510333918245683380"
                className="cb-field w-full"
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
              className="cb-btn cb-btn--accent mt-3"
            >
              <Save size={11} /> Salvar e Reconectar
            </button>

            {discordMsg && <p className="text-xs text-cb-fg-1 mt-1">{discordMsg}</p>}
          </SectionCard>

          <SectionRule label="sistema" className="mt-5" />
          {/* ── Laboratório ──────────────────────────────────────────── */}
          <SectionCard id="lab" icon={<FlaskConical size={13} />} title="Laboratório" badge="Beta" active={open.includes('lab')} onToggle={toggleSection}>
            <LabSection />
          </SectionCard>

          {/* ── Avançado ─────────────────────────────────────────────── */}
          <SectionCard id="advanced" icon={<Shield size={13} />} title="Avançado" badge="Cuidado" active={open.includes('advanced')} onToggle={toggleSection}>
            <div className="cb-note" style={{ '--cb-rail-color': 'var(--cb-danger)' } as React.CSSProperties}>
              <AlertTriangle size={13} className="text-cb-danger shrink-0 mt-0.5" />
              <p className="cb-help">Ações irreversíveis. Confirme antes de prosseguir.</p>
            </div>

            <button
              onClick={() => {
                if (!window.confirm('Resetar tamanho de fonte e zoom ao padrão?')) return;
                resetFontSize();
                resetAppZoom();
                setLineHeight(1);
              }}
              className="cb-btn w-full justify-center"
            >
              <RotateCcw size={11} /> Resetar Terminal ao Padrão
            </button>

            <button
              onClick={() => {
                if (!window.confirm('Resetar zoom da interface e tamanho de fonte ao padrão?')) return;
                resetAppZoom();
                resetFontSize();
              }}
              className="cb-btn w-full justify-center"
            >
              <Monitor size={11} /> Resetar Zoom da Interface
            </button>
          </SectionCard>
        </div>
      </section>

      {/* Resumo vivo */}
      <aside className="w-60 shrink-0 border-l border-cb-line-0 bg-cb-bg-1 hidden xl:flex flex-col cb-scroll p-4 gap-3">
        <SectionRule label="config atual" />
        <dl className="text-xs">
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
            <div key={label} className="flex justify-between gap-3 min-h-cell items-center">
              <dt className="text-cb-fg-2">{label}</dt>
              <dd className="text-cb-fg-0 truncate text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-auto cb-help text-xs">Terminal e aparência são salvos sozinhos, ao alterar.</p>
      </aside>
    </div>
  );
}
