import React from "react";
import { FlaskConical } from "lucide-react";
import {
  FLAG_DEFINITIONS,
  FLAG_KEYS,
  flagOverrideSource,
  type FlagKey,
} from "../../lib/flags";
import { useFlagsStore } from "../../stores/flags-store";
import { resolveFlag } from "../../lib/flags";

/* ═══════════════════════════════════════════════════════════════════════════
   LABORATÓRIO — TOGGLES DE FEATURE FLAG
   ═══════════════════════════════════════════════════════════════════════════

   Sem isto, ligar o shell v2 exigiria variável de ambiente ou query string —
   ou seja, o recurso existiria mas ninguém o encontraria. Que é exatamente o
   problema que esta refatoração está resolvendo em outros lugares.

   Flag travada por override (env ou query) aparece desabilitada com o motivo,
   em vez de um toggle que não faz efeito.
   ═══════════════════════════════════════════════════════════════════════════ */

const STAGE_LABEL: Record<string, string> = {
  experimental: "experimental",
  beta: "beta",
  stable: "estável",
};

const OVERRIDE_REASON: Record<string, string> = {
  env: "definida por variável de ambiente",
  query: "definida pela URL desta janela",
};

function FlagToggle({ flagKey }: { flagKey: FlagKey }) {
  const definition = FLAG_DEFINITIONS[flagKey];
  const stored = useFlagsStore((state) => state.flags);
  const setFlag = useFlagsStore((state) => state.setFlag);

  const value = resolveFlag(flagKey, stored);
  const override = flagOverrideSource(flagKey);
  const locked = override !== null;

  return (
    <label
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
        locked
          ? "border-white/5 opacity-60 cursor-not-allowed"
          : "border-white/10 hover:border-white/20 cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={locked}
        onChange={(event) => setFlag(flagKey, event.target.checked)}
        className="mt-0.5 accent-violet-500"
      />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-200 font-bold">{definition.label}</span>
          <span className="px-1.5 py-px rounded text-[9px] uppercase tracking-wider border border-violet-500/25 text-violet-300">
            {STAGE_LABEL[definition.stage] ?? definition.stage}
          </span>
        </span>
        <span className="block text-[10px] text-slate-500 leading-relaxed mt-1">
          {definition.description}
        </span>
        {locked && (
          <span className="block text-[10px] text-amber-400/80 mt-1">
            Travada — {OVERRIDE_REASON[override]}.
          </span>
        )}
      </span>
    </label>
  );
}

export function LabSection() {
  const resetFlags = useFlagsStore((state) => state.resetFlags);

  return (
    <div className="flex flex-col gap-2">
      <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/15 flex items-start gap-2.5">
        <FlaskConical size={13} className="text-violet-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Recursos em construção. Podem mudar ou sair sem aviso — e o shell
          antigo continua disponível desligando a opção.
        </p>
      </div>

      {FLAG_KEYS.map((key) => (
        <FlagToggle key={key} flagKey={key} />
      ))}

      <button
        onClick={resetFlags}
        className="mt-1 w-full py-2 rounded-lg border border-white/10 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:border-white/20 hover:text-slate-300 transition-all"
      >
        Restaurar padrões
      </button>
    </div>
  );
}
