/**
 * MissionWizard — criação de missão em três passos: modo, configuração, confirmação.
 * Livre abre panes escolhidos; Squad usa um preset; Agêntico abre um piloto que
 * quebra o objetivo e delega.
 */
import React from 'react';
import { Plus, Minus, X } from 'lucide-react';
import { useMissionsStore, MISSION_MODE_LABEL, type MissionMode, type ProviderPaneConfig } from '../../stores/missions-store';
import { useProvidersStore } from '../../stores/providers-store';
import { useModalsStore } from '../../stores/modals-store';
import '../central/central.css';
import { canUse, CliPicker, useCliRegistry } from '../central/cli-registry';
import { canonicalPilotCli, modelsForCli, resolvePilotTarget, spawnPilot, validateAgenticDraft } from './pilot';

interface MissionWizardProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  /** Modo já marcado ao abrir. */
  initialMode?: MissionMode;
  onCreated?: (missionId: string, mode: MissionMode, configs?: ProviderPaneConfig[], squadId?: string) => void;
}

type WizardStep = 'mode' | 'config' | 'confirm';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'mode', label: 'modo' },
  { id: 'config', label: 'configurar' },
  { id: 'confirm', label: 'confirmar' },
];

const MODES: { id: MissionMode; hint: string }[] = [
  { id: 'livre', hint: 'Você escolhe as CLIs e quantos terminais abrir.' },
  { id: 'squad', hint: 'Usa um time salvo, com orquestrador e workers.' },
  { id: 'agentico', hint: 'Você descreve o objetivo. Um piloto quebra e delega, e você só fala com ele.' },
];

interface ProviderOption {
  id: string;
  name?: string;
  host?: string;
  type?: string;
  models?: string[];
  env?: Record<string, string>;
}

const blankConfig = (): ProviderPaneConfig => ({ providerId: '', model: '', count: 1, label: '' });

const preferredAgent = () => {
  try {
    return localStorage.getItem('codebrain.preferredAgent') || '';
  } catch {
    return '';
  }
};

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label className="cb-label" htmlFor={htmlFor}>{children}</label>;
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 min-h-cell">
      <span className="text-xs text-cb-fg-2 shrink-0">{label}</span>
      <span className="text-xs text-cb-fg-0 text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

export function MissionWizard({ open, onClose, workspacePath, initialMode = 'livre', onCreated }: MissionWizardProps) {
  const [step, setStep] = React.useState<WizardStep>('mode');
  const [mode, setMode] = React.useState<MissionMode>(initialMode);
  const [missionTitle, setMissionTitle] = React.useState('');
  const [paneConfigs, setPaneConfigs] = React.useState<ProviderPaneConfig[]>([blankConfig()]);
  const [objective, setObjective] = React.useState('');
  const [pilotCli, setPilotCli] = React.useState('');
  const [pilotModel, setPilotModel] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);

  const createMission = useMissionsStore(s => s.createMission);
  const providers = useProvidersStore((s: any) => s.providers) as ProviderOption[];
  const registry = useCliRegistry();
  const missions = useMissionsStore(s => s.missionsByWorkspace[workspacePath]);

  React.useEffect(() => {
    if (!open) return;
    setStep('mode');
    setMode(initialMode);
    setMissionTitle('');
    setPaneConfigs([blankConfig()]);
    setObjective('');
    setPilotCli(canonicalPilotCli(preferredAgent() || 'claude'));
    setPilotModel('');
    setCreating(false);
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }, [open, initialMode]);

  const autoTitle = React.useMemo(() => {
    if (missionTitle.trim()) return missionTitle.trim();
    const nums = (missions ?? [])
      .map(m => { const match = /^Miss[aã]o\s*(\d+)$/i.exec(m.title); return match ? parseInt(match[1], 10) : null; })
      .filter((n): n is number => n !== null);
    return `Missão ${(nums.length > 0 ? Math.max(...nums) : 0) + 1}`;
  }, [missionTitle, missions]);

  if (!open) return null;

  const effectivePilotCli = canonicalPilotCli(pilotCli || preferredAgent() || 'claude');
  const pilotEntry = registry.find(effectivePilotCli);
  const pilotModels = modelsForCli(effectivePilotCli, providers);
  const livreConfigs = paneConfigs.filter(c => c.providerId);
  const objectiveError = validateAgenticDraft({ objective });
  const canProceed = step !== 'config' || (mode === 'livre' ? livreConfigs.length > 0 : mode === 'agentico' ? !objectiveError : false);

  function updatePaneConfig(idx: number, patch: Partial<ProviderPaneConfig>) {
    setPaneConfigs(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    const agentic = mode === 'agentico';
    if (agentic && objectiveError) { setCreating(false); return; }
    const target = agentic ? resolvePilotTarget({ agent: effectivePilotCli, model: canUse(pilotEntry, 'model') ? pilotModel : '' }, providers) : undefined;
    const missionId = createMission(workspacePath, {
      title: autoTitle,
      status: 'active',
      mode,
      objective: agentic ? objective : undefined,
      providerConfig: mode === 'livre' ? livreConfigs : undefined,
      pilot: target ? { agent: target.agent, providerId: target.providerId, model: target.model } : undefined,
    });
    if (agentic) {
      await spawnPilot({ workspacePath, missionId, objective, target: target! });
    }
    onCreated?.(missionId, mode, mode === 'livre' ? livreConfigs : undefined);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const title = step === 'mode' ? 'Nova missão' : step === 'config' ? `Modo ${MISSION_MODE_LABEL[mode]}` : 'Confirmar';

  return (
    <div className="cbm-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="cbm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center justify-between h-cell-lg px-4 border-b border-cb-line-0 shrink-0">
          <span className="text-sm font-bold text-cb-fg-0">
            <span className="cbc-prompt" aria-hidden>❯</span> {title}
          </span>
          <button type="button" onClick={onClose} className="text-cb-fg-2 hover:text-cb-fg-0" aria-label="Fechar">
            <X size={14} />
          </button>
        </div>

        <ol className="flex items-center gap-4 h-cell px-4 border-b border-cb-line-0 list-none m-0 shrink-0">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={step === s.id ? 'step' : undefined}
              className={`text-2xs ${step === s.id ? 'text-cb-accent' : i < stepIndex ? 'text-cb-success' : 'text-cb-fg-3'}`}
            >
              {i + 1} {s.label}
            </li>
          ))}
        </ol>

        <div className="cb-scroll px-4 py-4 flex-1 min-h-[260px]">
          {step === 'mode' && (
            <div className="flex flex-col gap-3">
              <div role="radiogroup" aria-label="Modo da missão" className="flex flex-col gap-2">
                {MODES.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === item.id}
                    tabIndex={mode === item.id ? 0 : -1}
                    className="cbm-mode"
                    onClick={() => setMode(item.id)}
                    onKeyDown={event => {
                      const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
                      if (!delta) return;
                      event.preventDefault();
                      const next = MODES[(index + delta + MODES.length) % MODES.length];
                      setMode(next.id);
                      (event.currentTarget.parentElement?.children[MODES.indexOf(next)] as HTMLElement | undefined)?.focus();
                    }}
                  >
                    <span className="text-sm font-bold text-cb-fg-0">{MISSION_MODE_LABEL[item.id]}</span>
                    <span className="text-xs text-cb-fg-2">{item.hint}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1 mt-1">
                <Label htmlFor="mission-title">Título, opcional</Label>
                <input id="mission-title" className="cbc-control" value={missionTitle} onChange={e => setMissionTitle(e.target.value)} placeholder={autoTitle} />
              </div>
            </div>
          )}

          {step === 'config' && mode === 'agentico' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="mission-objective">Objetivo</Label>
                <textarea
                  id="mission-objective"
                  autoFocus
                  required
                  rows={5}
                  className="cbc-control"
                  value={objective}
                  onChange={e => setObjective(e.target.value)}
                  placeholder="Trocar o login por senha por entrada com Google, sem derrubar quem já está logado."
                />
                <p className="cbc-tradeoff">Quanto mais claro o resultado esperado, menos o piloto precisa perguntar.</p>
              </div>
              <div className="cbc-grid">
                <div className="cbc-field">
                  <Label htmlFor="pilot-cli">CLI do piloto</Label>
                  <CliPicker id="pilot-cli" value={pilotCli} registry={registry} emptyLabel="a preferida do app" onChange={value => { setPilotCli(value); setPilotModel(''); }} />
                </div>
                {canUse(pilotEntry, 'model') && (
                  <div className="cbc-field">
                    <Label htmlFor="pilot-model">Modelo do piloto</Label>
                    {pilotModels.length ? (
                      <select id="pilot-model" className="cbc-control" value={pilotModel} onChange={e => setPilotModel(e.target.value)}>
                        <option value="">o da conta</option>
                        {pilotModels.map(model => <option key={model} value={model}>{model}</option>)}
                      </select>
                    ) : (
                      <input id="pilot-model" className="cbc-control" value={pilotModel} onChange={e => setPilotModel(e.target.value.trim())} placeholder="o da conta" />
                    )}
                  </div>
                )}
              </div>
              <p className="cbc-tradeoff">
                <span className="cbc-gain">ganha</span> um modelo forte só para planejar <span aria-hidden>·</span> <span className="cbc-risk">arrisca</span> gastar o limite se ele fizer conta de ajudante
              </p>
            </div>
          )}

          {step === 'config' && mode === 'livre' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Agentes</Label>
                <button type="button" className="cbc-btn" onClick={() => setPaneConfigs(prev => [...prev, blankConfig()])}>
                  <Plus size={11} /> adicionar
                </button>
              </div>
              {paneConfigs.map((config, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 py-1 border-b border-cb-line-0">
                  <select
                    aria-label={`Provider do agente ${idx + 1}`}
                    className="cbc-control flex-1 min-w-[140px]"
                    style={{ width: 'auto' }}
                    value={config.providerId}
                    onChange={e => updatePaneConfig(idx, { providerId: e.target.value })}
                  >
                    <option value="">escolha o provider</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <button type="button" className="cbc-btn" aria-label="Menos um" onClick={() => updatePaneConfig(idx, { count: Math.max(1, config.count - 1) })}><Minus size={10} /></button>
                    <span className="w-5 text-center text-xs text-cb-fg-0" aria-live="polite">{config.count}</span>
                    <button type="button" className="cbc-btn" aria-label="Mais um" onClick={() => updatePaneConfig(idx, { count: Math.min(8, config.count + 1) })}><Plus size={10} /></button>
                  </div>
                  <input aria-label={`Nome do agente ${idx + 1}`} className="cbc-control" style={{ width: 96 }} value={config.label ?? ''} onChange={e => updatePaneConfig(idx, { label: e.target.value })} placeholder="nome" />
                  {paneConfigs.length > 1 && (
                    <button type="button" className="text-cb-fg-2 hover:text-cb-danger" aria-label={`Tirar agente ${idx + 1}`} onClick={() => setPaneConfigs(prev => prev.filter((_, i) => i !== idx))}>
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {step === 'config' && mode === 'squad' && (
            <div className="cbc-state" style={{ padding: 0 }}>
              <p className="cbc-state-line"><span className="cbc-prompt" aria-hidden>❯</span> <span>Times saem do montador de squads</span></p>
              <p className="cbc-state-text">Escolha ou crie o time por lá. Ele abre os terminais e associa o trabalho a esta área.</p>
              <button
                type="button"
                className="cbc-btn"
                data-tone="accent"
                onClick={() => { onClose(); useModalsStore.getState().setShowSquadWizard(true); }}
              >
                abrir o montador de squads
              </button>
            </div>
          )}

          {step === 'confirm' && (
            <div className="flex flex-col">
              <SummaryRow label="Título">{autoTitle}</SummaryRow>
              <SummaryRow label="Modo">{MISSION_MODE_LABEL[mode]}</SummaryRow>
              {mode === 'agentico' && (
                <>
                  <SummaryRow label="Piloto">
                    {pilotEntry?.label ?? (pilotCli || 'a CLI preferida')}
                    {canUse(pilotEntry, 'model') && pilotModel ? ` · ${pilotModel}` : ''}
                  </SummaryRow>
                  <div className="cb-rail mt-2 text-xs text-cb-fg-1 whitespace-pre-wrap break-words" style={{ '--cb-rail-color': 'var(--cb-accent)' } as React.CSSProperties}>
                    {objective.trim()}
                  </div>
                </>
              )}
              {mode === 'livre' && (
                <>
                  {livreConfigs.map((c, i) => (
                    <SummaryRow key={i} label={providers.find(p => p.id === c.providerId)?.name ?? c.providerId}>
                      ×{c.count}{c.label ? ` (${c.label})` : ''}
                    </SummaryRow>
                  ))}
                  <SummaryRow label="Total de terminais">{livreConfigs.reduce((sum, c) => sum + c.count, 0)}</SummaryRow>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-cb-line-0 shrink-0">
          <button type="button" className="cbc-btn" onClick={step === 'mode' ? onClose : () => setStep(step === 'confirm' ? 'config' : 'mode')}>
            {step === 'mode' ? 'cancelar' : 'voltar'}
          </button>
          <button
            type="button"
            className="cbc-btn"
            data-tone="accent"
            disabled={!canProceed || creating}
            onClick={step === 'confirm' ? () => void handleCreate() : () => setStep(step === 'mode' ? 'config' : 'confirm')}
          >
            {step === 'confirm' ? (creating ? 'abrindo o piloto…' : mode === 'agentico' ? 'criar e abrir o piloto' : 'criar missão') : 'próximo'}
          </button>
        </div>
      </div>
    </div>
  );
}
