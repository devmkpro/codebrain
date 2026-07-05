import React, { useState } from "react";
import { useProvidersStore } from "../../stores/providers-store";

interface LibreSlot {
  providerId: string;
  model: string;
  label: string;
  count: number;
}

interface LibreSpawnPayload {
  orchestrator: { providerId: string; model: string };
  workers: LibreSlot[];
}

interface LibreWizardProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (payload: LibreSpawnPayload) => void;
  activeWorkspace?: string;
}

export function LibreWizard({ open, onClose, onSpawn, activeWorkspace }: LibreWizardProps) {
  const providers = useProvidersStore((s) => s.providers);
  const [step, setStep] = useState(0);
  const [orchestrator, setOrchestrator] = useState<{ providerId: string; model: string } | null>(null);
  const [slots, setSlots] = useState<LibreSlot[]>([]);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setOrchestrator(null);
      setSlots([]);
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
    onSpawn({ orchestrator, workers: finalWorkers });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-violet-500/30 bg-zinc-950 p-6 shadow-2xl font-mono">
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
        {activeWorkspace && (
          <div className="flex items-center gap-1 mb-4">
            {["Orquestrador", "Workers", "Resumo"].map((label, i) => (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1 text-[9px] ${step === i ? "text-violet-400" : step > i ? "text-emerald-500" : "text-zinc-600"}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${step === i ? "bg-violet-700 text-white" : step > i ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-500"}`}>
                    {step > i ? "✓" : i + 1}
                  </span>
                  {label}
                </div>
                {i < 2 && <div className={`flex-1 h-px ${step > i ? "bg-emerald-600" : "bg-zinc-800"}`} />}
              </React.Fragment>
            ))}
          </div>
        )}

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

        {/* Step 0: choose orchestrator model */}
        {activeWorkspace && step === 0 && (
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

            <button
              onClick={() => setStep(1)}
              disabled={!orchestrator}
              className="w-full mt-2 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold disabled:opacity-40 transition-colors"
            >
              Próximo →
            </button>
          </div>
        )}

        {/* Step 1: allocate worker slots per provider/model */}
        {activeWorkspace && step === 1 && (
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
              <button onClick={() => setStep(0)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={workerAllocated === 0}
                className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold disabled:opacity-40 transition-colors"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Summary + spawn */}
        {activeWorkspace && step === 2 && orchestrator && (
          <div className="space-y-3">
            {/* Orchestrator summary */}
            <div className="rounded-lg border border-violet-500/40 bg-violet-900/20 px-3 py-2">
              <div className="text-[9px] text-violet-400 font-bold mb-0.5">🎯 ORQUESTRADOR</div>
              <div className="text-[10px] text-zinc-300">{orchestrator.model}</div>
              <div className="text-[9px] text-zinc-600">
                {providers.find((p: any) => p.id === orchestrator.providerId)?.label ?? orchestrator.providerId}
              </div>
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
              <button onClick={() => setStep(1)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
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
