/**
 * MissionWizard — Wizard de criação de missão.
 * 3 steps: Escolha modo → Configura providers/squad → Review e criar.
 */
import React from 'react';
import { Terminal, Users, Plus, Minus, X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { useMissionsStore, type MissionMode, type ProviderPaneConfig } from '../../stores/missions-store';
import { useProvidersStore } from '../../stores/providers-store';

interface MissionWizardProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  onCreated?: (missionId: string, mode: MissionMode, configs?: ProviderPaneConfig[], squadId?: string) => void;
}

type WizardStep = 'mode' | 'config' | 'review';

const PROVIDER_LABELS: Record<string, string> = {
  'claude': 'Claude Code CLI',
  'openclaude': 'OpenClaude',
  'gemini': 'Gemini CLI',
  'codex': 'Codex CLI',
};

export function MissionWizard({ open, onClose, workspacePath, onCreated }: MissionWizardProps) {
  const [step, setStep] = React.useState<WizardStep>('mode');
  const [mode, setMode] = React.useState<MissionMode>('livre');
  const [missionTitle, setMissionTitle] = React.useState('');
  const [paneConfigs, setPaneConfigs] = React.useState<ProviderPaneConfig[]>([
    { providerId: '', model: '', count: 1, label: '' },
  ]);
  const [selectedSquadId, setSelectedSquadId] = React.useState<string | null>(null);

  const createMission = useMissionsStore(s => s.createMission);
  const providers = useProvidersStore(s => s.providers);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep('mode');
      setMode('livre');
      setMissionTitle('');
      setPaneConfigs([{ providerId: '', model: '', count: 1, label: '' }]);
      setSelectedSquadId(null);
    }
  }, [open]);

  // Auto-generate title
  const missions = useMissionsStore(s => s.missionsByWorkspace[workspacePath] ?? []);
  const autoTitle = React.useMemo(() => {
    if (missionTitle.trim()) return missionTitle.trim();
    const nums = missions
      .map(m => { const match = /^Miss[aã]o\s*(\d+)$/i.exec(m.title); return match ? parseInt(match[1], 10) : null; })
      .filter((n): n is number => n !== null);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `Missão ${max + 1}`;
  }, [missionTitle, missions]);

  if (!open) return null;

  function addPaneConfig() {
    setPaneConfigs(prev => [...prev, { providerId: '', model: '', count: 1, label: '' }]);
  }

  function removePaneConfig(idx: number) {
    setPaneConfigs(prev => prev.filter((_, i) => i !== idx));
  }

  function updatePaneConfig(idx: number, patch: Partial<ProviderPaneConfig>) {
    setPaneConfigs(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  function handleCreate() {
    const missionId = createMission(workspacePath, {
      title: autoTitle,
      status: 'active',
      mode,
      squadId: mode === 'squad' ? selectedSquadId ?? undefined : undefined,
      providerConfig: mode === 'livre' ? paneConfigs.filter(c => c.providerId) : undefined,
    });
    onCreated?.(missionId, mode, mode === 'livre' ? paneConfigs.filter(c => c.providerId) : undefined, mode === 'squad' ? selectedSquadId ?? undefined : undefined);
    onClose();
  }

  const canProceed = step === 'mode'
    ? true
    : step === 'config'
      ? (mode === 'livre' ? paneConfigs.some(c => c.providerId) : !!selectedSquadId)
      : true;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0c0c14] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-amber-400" />
            <span className="font-mono text-[12px] font-bold text-slate-300">
              {step === 'mode' ? 'Nova Missão' : step === 'config' ? (mode === 'livre' ? 'Modo Livre' : 'Modo Squad') : 'Confirmar'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-700 hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 border-b border-white/5 px-4 py-2">
          {(['mode', 'config', 'review'] as WizardStep[]).map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 ${step === s ? 'text-slate-300' : 'text-slate-700'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border ${
                  step === s ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' :
                  (['mode', 'config', 'review'].indexOf(step) > i ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-white/10 text-slate-700')
                }`}>{i + 1}</div>
                <span className="font-mono text-[9px] uppercase tracking-wider">{s === 'mode' ? 'Modo' : s === 'config' ? 'Config' : 'Revisão'}</span>
              </div>
              {i < 2 && <ChevronRight size={10} className="text-gray-700 mx-1" />}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="px-4 py-4 min-h-[260px]">
          {/* STEP 1: Mode Selection */}
          {step === 'mode' && (
            <div className="flex flex-col gap-3">
              <label className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Escolha o modo</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setMode('livre')}
                  className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                    mode === 'livre'
                      ? 'border-indigo-500/30 bg-indigo-500/8'
                      : 'border-white/8 bg-white/3 hover:border-white/15'
                  }`}
                >
                  <Terminal size={16} strokeWidth={1.5} className={mode === 'livre' ? 'text-indigo-400' : 'text-slate-600'} />
                  <div>
                    <div className="font-mono text-[12px] font-bold text-slate-300">Modo Livre</div>
                    <div className="font-mono text-[10px] text-slate-600 mt-1">
                      Escolha providers e quantidade de panes
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('squad')}
                  className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                    mode === 'squad'
                      ? 'border-indigo-500/30 bg-indigo-500/8'
                      : 'border-white/8 bg-white/3 hover:border-white/15'
                  }`}
                >
                  <Users size={16} strokeWidth={1.5} className={mode === 'squad' ? 'text-indigo-400' : 'text-slate-600'} />
                  <div>
                    <div className="font-mono text-[12px] font-bold text-slate-300">Modo Squad</div>
                    <div className="font-mono text-[10px] text-slate-600 mt-1">
                      Use um preset de squad salvo
                    </div>
                  </div>
                </button>
              </div>

              {/* Mission title */}
              <div className="mt-3">
                <label className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Título (opcional)</label>
                <input
                  type="text"
                  value={missionTitle}
                  onChange={e => setMissionTitle(e.target.value)}
                  placeholder={autoTitle}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/3 px-3 py-2 font-mono text-[11px] text-slate-300 placeholder:text-slate-700 outline-none focus:border-indigo-500/30"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Config */}
          {step === 'config' && mode === 'livre' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Agentes</label>
                <button
                  onClick={addPaneConfig}
                  className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 font-mono text-[9px] text-slate-500 hover:text-slate-300 hover:border-white/20 transition-colors"
                >
                  <Plus size={10} /> Adicionar
                </button>
              </div>
              <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto">
                {paneConfigs.map((config, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 p-2">
                    <select
                      value={config.providerId}
                      onChange={e => updatePaneConfig(idx, { providerId: e.target.value })}
                      className="flex-1 rounded border border-white/10 bg-transparent px-2 py-1 font-mono text-[10px] text-slate-300 outline-none"
                    >
                      <option value="">Selecione o provider...</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.id}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updatePaneConfig(idx, { count: Math.max(1, config.count - 1) })}
                        className="rounded border border-white/10 p-0.5 text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        <Minus size={10} />
                      </button>
                      <span className="w-6 text-center font-mono text-[11px] text-slate-300">{config.count}</span>
                      <button
                        onClick={() => updatePaneConfig(idx, { count: Math.min(8, config.count + 1) })}
                        className="rounded border border-white/10 p-0.5 text-slate-600 hover:text-slate-300 transition-colors"
                      >
                        <Plus size={10} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={config.label ?? ''}
                      onChange={e => updatePaneConfig(idx, { label: e.target.value })}
                      placeholder="label"
                      className="w-20 rounded border border-white/10 bg-transparent px-2 py-1 font-mono text-[10px] text-slate-500 placeholder:text-gray-700 outline-none"
                    />
                    {paneConfigs.length > 1 && (
                      <button onClick={() => removePaneConfig(idx)} className="text-slate-700 hover:text-indigo-400 transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'config' && mode === 'squad' && (
            <div className="flex flex-col gap-3">
              <label className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Squads salvos</label>
              <div className="rounded-lg border border-white/8 bg-white/3 p-6 text-center">
                <Users size={24} className="text-slate-700 mx-auto mb-2" />
                <p className="font-mono text-[11px] text-slate-600">
                  Selecione um squad preset no modal de Squads (SQUAD no header).
                </p>
                <p className="font-mono text-[9px] text-slate-700 mt-1">
                  O squad será associado a esta missão.
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: Review */}
          {step === 'review' && (
            <div className="flex flex-col gap-3">
              <label className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Resumo da missão</label>
              <div className="rounded-lg border border-white/8 bg-white/3 p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-slate-600">Título</span>
                  <span className="font-mono text-[11px] text-slate-300">{autoTitle}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-slate-600">Modo</span>
                  <span className="font-mono text-[11px] text-slate-300">{mode === 'livre' ? 'Livre' : 'Squad'}</span>
                </div>
                {mode === 'livre' && paneConfigs.filter(c => c.providerId).length > 0 && (
                  <div>
                    <span className="font-mono text-[10px] text-slate-600">Agentes</span>
                    <div className="mt-1 space-y-1">
                      {paneConfigs.filter(c => c.providerId).map((c, i) => (
                        <div key={i} className="flex justify-between font-mono text-[10px]">
                          <span className="text-slate-500">{PROVIDER_LABELS[c.providerId] || c.providerId}</span>
                          <span className="text-slate-300">×{c.count}{c.label ? ` (${c.label})` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-slate-600">Total de panes</span>
                  <span className="font-mono text-[11px] text-amber-400 font-bold">
                    {mode === 'livre' ? paneConfigs.reduce((sum, c) => sum + c.count, 0) : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
          <button
            onClick={step === 'mode' ? onClose : () => setStep(step === 'review' ? 'config' : 'mode')}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-4 py-1.5 font-mono text-[11px] text-slate-500 hover:text-slate-300 hover:border-white/20 transition-colors"
          >
            {step === 'mode' ? 'Cancelar' : <><ChevronLeft size={12} /> Voltar</>}
          </button>
          <button
            onClick={step === 'review' ? handleCreate : () => setStep(step === 'mode' ? 'config' : 'review')}
            disabled={!canProceed}
            className="flex items-center gap-1 rounded-lg bg-[#4F46E5] border border-indigo-500/30 px-4 py-1.5 font-mono text-[11px] font-bold text-white hover:bg-[#4338CA] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {step === 'review' ? 'Criar Missão' : <>Próximo <ChevronRight size={12} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
