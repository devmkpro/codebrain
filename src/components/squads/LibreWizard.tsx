import React, { useState } from "react";
import { useProvidersStore } from "../../stores/providers-store";

interface LibreSlot {
  providerId: string;
  model: string;
  label: string;
  count: number;
}

interface LibreSpawnPayload {
  orchestrator: {
    providerId: string;
    model: string;
    cli?: string;
    effort?: string;
    instructions?: string;
  };
  workers: LibreSlot[];
}

interface LibreWizardProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (payload: LibreSpawnPayload) => void;
  activeWorkspace?: string;
}

const STEPS = [
  { id: "workspace", label: "Pasta" },
  { id: "mode", label: "Modo" },
  { id: "count", label: "Panes" },
  { id: "providers", label: "Providers" },
  { id: "squad", label: "Squad" },
  { id: "review", label: "Revisar" },
];

const CLI_OPTIONS = [
  { value: "claude", label: "Claude Code CLI" },
  { value: "openclaude", label: "OpenClaude" },
  { value: "gemini", label: "Gemini CLI" },
];

const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

export function LibreWizard({ open, onClose, onSpawn, activeWorkspace }: LibreWizardProps) {
  const providers = useProvidersStore((s) => s.providers);
  const [step, setStep] = useState(0);
  const [orchestrator, setOrchestrator] = useState<{ providerId: string; model: string } | null>(null);
  const [slots, setSlots] = useState<LibreSlot[]>([]);

  // Orchestrator extra config (step 4 / review)
  const [orchCli, setOrchCli] = useState("claude");
  const [orchEffort, setOrchEffort] = useState("normal");
  const [orchInstructions, setOrchInstructions] = useState("");

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setOrchestrator(null);
      setSlots([]);
      setOrchCli("claude");
      setOrchEffort("normal");
      setOrchInstructions("");
    }
  }, [open]);

  if (!open) return null;

  // ── Providers list (non-oauth, with models) ──
  const eligibleProviders = providers.filter((p: any) => p.type !== "oauth" && (p.models?.length ?? 0) > 0);

  const workerAllocated = slots.reduce((s, sl) => s + sl.count, 0);

  const addSlot = (providerId: string, model: string) => {
    const provider = providers.find((p: any) => p.id === providerId);
    setSlots((prev) => {
      const existing = prev.find((s) => s.providerId === providerId && s.model === model);
      if (existing) {
        return prev.map((s) =>
          s.providerId === providerId && s.model === model
            ? { ...s, count: s.count + 1 }
            : s
        );
      }
      return [...prev, { providerId, model, label: provider?.label ?? providerId, count: 1 }];
    });
  };

  const removeSlot = (providerId: string, model: string) => {
    setSlots((prev) =>
      prev
        .map((s) =>
          s.providerId === providerId && s.model === model
            ? { ...s, count: s.count - 1 }
            : s
        )
        .filter((s) => s.count > 0)
    );
  };

  const handleSpawn = () => {
    const finalWorkers = slots.filter((s) => s.count > 0);
    if (!orchestrator || finalWorkers.length === 0) return;
    onSpawn({
      orchestrator: {
        ...orchestrator,
        cli: orchCli,
        effort: orchEffort,
        instructions: orchInstructions.trim() || undefined,
      },
      workers: finalWorkers,
    });
    onClose();
  };

  // ── Step bar ──
  const StepsBar = () => (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className={`flex items-center gap-1 text-[9px] shrink-0 ${step === i ? "text-violet-400" : step > i ? "text-emerald-500" : "text-zinc-600"}`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${step === i ? "bg-violet-700 text-white" : step > i ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-500"}`}>
              {step > i ? "✓" : i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px min-w-2 ${step > i ? "bg-emerald-600" : "bg-zinc-800"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-violet-500/30 bg-zinc-950 p-6 shadow-2xl font-mono max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-sm font-bold text-violet-300">⚡ Libre Mode</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {activeWorkspace
                ? <span className="text-zinc-600 truncate max-w-[240px] inline-block align-bottom">{activeWorkspace}</span>
                : <span className="text-amber-500">nenhum workspace aberto</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 text-lg leading-none">✕</button>
        </div>

        {/* Step indicators */}
        {activeWorkspace && <StepsBar />}

        {/* No workspace — block spawn */}
        {!activeWorkspace && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-4 text-[11px] text-amber-400">
              <div className="font-bold mb-1">Sem workspace aberto</div>
              <div className="text-amber-500/80">Abra um workspace antes de usar o Libre Mode. Os panes precisam de um diretório de trabalho para serem iniciados.</div>
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-lg border border-zinc-700 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors"
            >
              Fechar
            </button>
          </div>
        )}

        {/* ── STEP 0: Workspace confirmation ── */}
        {activeWorkspace && step === 0 && (
          <div className="space-y-4">
            <div className="text-[11px] text-zinc-400">Workspace ativo:</div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3">
              <div className="text-[10px] text-violet-300 font-bold mb-1">📁 Pasta</div>
              <div className="text-[10px] text-zinc-300 break-all">{activeWorkspace}</div>
            </div>
            <div className="text-[10px] text-zinc-600">Os panes serão iniciados neste diretório. Você pode mudar o workspace antes de spawnar.</div>
            <button
              onClick={() => setStep(1)}
              className="w-full mt-2 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold transition-colors"
            >
              Próximo →
            </button>
          </div>
        )}

        {/* ── STEP 1: Mode (orchestrator model) ── */}
        {activeWorkspace && step === 1 && (
          <div className="space-y-4">
            <div className="text-[11px] text-zinc-400">Escolha o modelo do <span className="text-violet-400 font-bold">Orquestrador</span>:</div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {eligibleProviders.map((p: any) =>
                (p.models ?? []).map((model: string) => {
                  const isSelected = orchestrator?.providerId === p.id && orchestrator?.model === model;
                  return (
                    <button
                      key={`${p.id}:${model}`}
                      onClick={() => setOrchestrator({ providerId: p.id, model })}
                      className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-violet-500/60 bg-violet-900/30"
                          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-zinc-300 truncate">{model}</div>
                        <div className="text-[9px] text-zinc-600 truncate">{p.label}</div>
                      </div>
                      {isSelected && <span className="text-violet-400 text-[11px] font-bold ml-2">✓</span>}
                    </button>
                  );
                })
              )}
            </div>

            {eligibleProviders.length === 0 && (
              <div className="text-[10px] text-zinc-600 text-center py-4">
                Nenhum provider com modelos configurado.
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={() => setStep(0)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!orchestrator}
                className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold disabled:opacity-40 transition-colors"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Count (worker slots) ── */}
        {activeWorkspace && step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-zinc-400">
                Distribua os <span className="text-emerald-400 font-bold">Workers</span>:
              </div>
              <div className="text-[10px] text-violet-400">
                {workerAllocated} alocados
              </div>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {eligibleProviders.map((p: any) =>
                (p.models ?? []).map((model: string) => {
                  const slot = slots.find((s) => s.providerId === p.id && s.model === model);
                  const count = slot?.count ?? 0;
                  return (
                    <div
                      key={`${p.id}:${model}`}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 mr-3">
                        <div className="text-[10px] text-zinc-300 truncate">{model}</div>
                        <div className="text-[9px] text-zinc-600 truncate">{p.label}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => removeSlot(p.id, model)}
                          disabled={count === 0}
                          className="w-6 h-6 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-30 text-sm flex items-center justify-center"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-[11px] text-emerald-300 font-bold">{count}</span>
                        <button
                          onClick={() => addSlot(p.id, model)}
                          disabled={workerAllocated >= 15}
                          className="w-6 h-6 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-30 text-sm flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="text-[9px] text-zinc-600">máx 15 workers</div>

            <div className="flex gap-2 mt-3">
              <button onClick={() => setStep(1)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={workerAllocated === 0}
                className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold disabled:opacity-40 transition-colors"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Providers (orchestrator config) ── */}
        {activeWorkspace && step === 3 && (
          <div className="space-y-4">
            <div className="text-[11px] text-zinc-400">Configure o <span className="text-violet-400 font-bold">Orquestrador</span>:</div>

            {/* CLI */}
            <div>
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1.5">CLI do Orquestrador</div>
              <div className="flex gap-2">
                {CLI_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setOrchCli(opt.value)}
                    className={`flex-1 py-2 rounded-lg border text-[10px] font-bold transition-colors ${
                      orchCli === opt.value
                        ? "border-violet-500/60 bg-violet-900/30 text-violet-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Effort */}
            <div>
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1.5">Effort</div>
              <div className="flex gap-2">
                {EFFORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setOrchEffort(opt.value)}
                    className={`flex-1 py-2 rounded-lg border text-[10px] font-bold transition-colors ${
                      orchEffort === opt.value
                        ? "border-emerald-500/60 bg-emerald-900/20 text-emerald-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Instructions */}
            <div>
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1.5">Instruções customizadas (opcional)</div>
              <textarea
                value={orchInstructions}
                onChange={(e) => setOrchInstructions(e.target.value)}
                placeholder="Ex: Foque em TypeScript. Não use Redux. Escreva testes para tudo..."
                rows={4}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[10px] text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-violet-500/50 resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={() => setStep(4)}
                className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold transition-colors"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Squad (saved squads placeholder) ── */}
        {activeWorkspace && step === 4 && (
          <div className="space-y-4">
            <div className="text-[11px] text-zinc-400">Squads salvos:</div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center">
              <div className="text-[10px] text-zinc-600 mb-1">Nenhum squad salvo ainda.</div>
              <div className="text-[9px] text-zinc-700">Após spawnar, você pode salvar a configuração como squad.</div>
            </div>
            <div className="text-[10px] text-zinc-500">Continue para revisar e spawnar com a configuração atual.</div>
            <div className="flex gap-2">
              <button onClick={() => setStep(3)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={() => setStep(5)}
                className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold transition-colors"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5: Review + spawn ── */}
        {activeWorkspace && step === 5 && orchestrator && (
          <div className="space-y-3">
            {/* Workspace */}
            <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/30 px-3 py-2">
              <div className="text-[9px] text-zinc-500 font-bold mb-0.5">📁 WORKSPACE</div>
              <div className="text-[9px] text-zinc-400 break-all">{activeWorkspace}</div>
            </div>

            {/* Orchestrator summary */}
            <div className="rounded-lg border border-violet-500/40 bg-violet-900/20 px-3 py-2">
              <div className="text-[9px] text-violet-400 font-bold mb-1">🎯 ORQUESTRADOR</div>
              <div className="text-[10px] text-zinc-300">{orchestrator.model}</div>
              <div className="text-[9px] text-zinc-600">
                {providers.find((p: any) => p.id === orchestrator.providerId)?.label ?? orchestrator.providerId}
              </div>
              <div className="flex gap-2 mt-1.5">
                <span className="text-[8px] text-violet-300/70 bg-violet-900/30 rounded px-1.5 py-0.5">CLI: {orchCli}</span>
                <span className="text-[8px] text-emerald-300/70 bg-emerald-900/20 rounded px-1.5 py-0.5">effort: {orchEffort}</span>
              </div>
              {orchInstructions.trim() && (
                <div className="mt-1.5 text-[9px] text-zinc-500 italic line-clamp-2">"{orchInstructions.trim()}"</div>
              )}
            </div>

            {/* Workers summary */}
            <div className="text-[10px] text-zinc-400 mt-2">⚙️ WORKERS — {workerAllocated} total</div>
            <div className="space-y-1.5">
              {slots.map((s) => (
                <div key={`${s.providerId}:${s.model}`} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                  <div>
                    <div className="text-[10px] text-zinc-300">{s.model}</div>
                    <div className="text-[9px] text-zinc-600">{s.label}</div>
                  </div>
                  <div className="text-emerald-300 font-bold text-[11px]">×{s.count}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-3">
              <button onClick={() => setStep(4)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={handleSpawn}
                className="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-bold transition-colors"
              >
                ⚡ Spawnar squad
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
