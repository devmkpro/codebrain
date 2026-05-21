import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Terminal, Zap, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, Info, Save,
  RotateCcw, Download, Trash2, RefreshCw, Shield,
  Type, Monitor,
} from 'lucide-react';
import {
  useTerminalSettings,
  FONT_OPTIONS,
  DEFAULT_SIZE,
  MIN_SIZE,
  MAX_SIZE,
} from '../../stores/terminal-settings-store';
import { useProvidersStore } from '../../stores/providers-store';

type Section = 'terminal' | 'shell' | 'providers' | 'skill' | 'advanced';

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

// ─── Page ─────────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const [open,      setOpen]   = useState<Section[]>(['terminal']);
  const [saved,     setSaved]  = useState(false);
  const [shells,    setShells] = useState<string[]>([]);
  const [skillStatus, setSkillStatus] = useState<{ installed: boolean } | null>(null);
  const [installedSkills, setInstalledSkills] = useState<string[]>([]);
  const [cliStatus,        setCliStatus]        = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [claudeCliStatus,  setClaudeCliStatus]  = useState<{ found: boolean; path?: string; version?: string } | null>(null);
  const [skillBusy,   setSkillBusy]   = useState(false);
  const [cliBusy,     setCliBusy]     = useState(false);

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

  // Providers
  const providers    = useProvidersStore(s => s.providers) as any[];
  const loadProviders = useProvidersStore(s => s.load);

  useEffect(() => {
    // Load shells
    (window as any).codeBrainApp?.shells?.list?.()
      .then((s: string[]) => setShells(s ?? []))
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
      })
      .catch(() => {});
    loadProviders().catch(() => {});
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
        if (oc) setCliStatus(oc);
        if (cl) setClaudeCliStatus(cl);
      } else {
        setCliStatus(res?.openclaude ?? res);
        setClaudeCliStatus(res?.claude ?? null);
      }
    } catch {} finally { setCliBusy(false); }
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
          { id: 'skill'     as Section, icon: <Download size={12} />, label: 'Skill & CLI' },
          { id: 'advanced'  as Section, icon: <Shield size={12} />,   label: 'Avançado'  },
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-300">OpenClaude CLI</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Detecta o binário <span className="font-mono">openclaude</span> no PATH.</p>
                {cliStatus && (
                  <>
                    <p className={`text-[9px] font-mono mt-1 ${cliStatus.found ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {cliStatus.found ? `✓ ${cliStatus.path ?? 'encontrado'}` : '✗ Não encontrado no PATH'}
                    </p>
                    {cliStatus.version && <p className="text-[9px] font-mono text-slate-700 mt-0.5">{cliStatus.version}</p>}
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

            {/* Claude CLI (official) */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium text-slate-300">Claude Code CLI</p>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  Claude original da Anthropic — usado pelo provider <span className="font-mono">Claude (Plano)</span>.
                  {!claudeCliStatus?.found && (
                    <> Instale com <span className="font-mono">npm install -g @anthropic-ai/claude-code</span>.</>
                  )}
                </p>
                {claudeCliStatus && (
                  <>
                    <p className={`text-[9px] font-mono mt-1 ${claudeCliStatus.found ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {claudeCliStatus.found ? `✓ ${claudeCliStatus.path ?? 'encontrado'}` : '✗ Não encontrado no PATH'}
                    </p>
                    {claudeCliStatus.version && <p className="text-[9px] font-mono text-slate-700 mt-0.5">{claudeCliStatus.version}</p>}
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
                if (!window.confirm('Resetar zoom da interface?')) return;
                resetAppZoom();
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
            { label: 'Skill',     value: skillStatus === null ? '—' : skillStatus.installed ? 'Instalada' : 'Não instalada' },
            { label: 'CLI',       value: cliStatus === null ? '—' : cliStatus.found ? 'Encontrada' : 'Não encontrada' },
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
