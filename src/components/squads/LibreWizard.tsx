import React, { useState } from "react";
import { useProvidersStore } from "../../stores/providers-store";

interface LibreSlot {
  providerId: string;
  model: string;
  label: string;
  count: number;
}

interface LibreWizardProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (slots: LibreSlot[]) => void;
  activeWorkspace?: string;
}

export function LibreWizard({ open, onClose, onSpawn, activeWorkspace }: LibreWizardProps) {
  const providers = useProvidersStore((s) => s.providers);
  const [step, setStep] = useState(0);
  const [totalPanes, setTotalPanes] = useState(4);
  const [slots, setSlots] = useState<LibreSlot[]>([]);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setSlots([]);
      setTotalPanes(4);
    }
  }, [open]);

  if (!open) return null;

  const allocated = slots.reduce((s, sl) => s + sl.count, 0);
  const remaining = totalPanes - allocated;

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
    const finalSlots = slots.filter((s) => s.count > 0);
    onSpawn(finalSlots);
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

        {/* Step 0: choose total pane count */}
        {activeWorkspace && step === 0 && (
          <div className="space-y-4">
            <div className="text-[11px] text-zinc-400">Quantos panes você quer spawnar?</div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setTotalPanes((n) => Math.max(2, n - 1))}
                className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-lg flex items-center justify-center"
              >
                −
              </button>
              <span className="text-3xl font-bold text-violet-300 w-12 text-center">{totalPanes}</span>
              <button
                onClick={() => setTotalPanes((n) => Math.min(16, n + 1))}
                className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-lg flex items-center justify-center"
              >
                +
              </button>
            </div>
            <div className="text-[10px] text-zinc-600">máx 16 panes</div>
            <button
              onClick={() => setStep(1)}
              className="w-full mt-2 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold transition-colors"
            >
              Próximo →
            </button>
          </div>
        )}

        {/* Step 1: allocate slots per provider/model */}
        {activeWorkspace && step === 1 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-zinc-400">Distribua os {totalPanes} panes:</div>
              <div className="text-[10px] text-violet-400">
                {allocated}/{totalPanes} alocados
              </div>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {providers.filter((p: any) => p.type !== "oauth" && (p.models?.length ?? 0) > 0).map((p: any) =>
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
                        <span className="w-5 text-center text-[11px] text-violet-300 font-bold">{count}</span>
                        <button
                          onClick={() => addSlot(p.id, model)}
                          disabled={remaining === 0}
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

            {providers.filter((p: any) => p.type !== "oauth" && (p.models?.length ?? 0) > 0).length === 0 && (
              <div className="text-[10px] text-zinc-600 text-center py-4">
                Nenhum provider com modelos configurado.
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <button onClick={() => setStep(0)} className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[11px] hover:bg-zinc-900 transition-colors">
                ← Voltar
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={allocated === 0}
                className="flex-1 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-bold disabled:opacity-40 transition-colors"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Summary + spawn */}
        {activeWorkspace && step === 2 && (
          <div className="space-y-3">
            <div className="text-[11px] text-zinc-400 mb-2">Resumo — {allocated} panes</div>
            <div className="space-y-1.5">
              {slots.map((s) => (
                <div key={`${s.providerId}:${s.model}`} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                  <div>
                    <div className="text-[10px] text-zinc-300">{s.model}</div>
                    <div className="text-[9px] text-zinc-600">{s.label}</div>
                  </div>
                  <div className="text-violet-300 font-bold text-[11px]">×{s.count}</div>
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
                ⚡ Spawnar {allocated} panes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
