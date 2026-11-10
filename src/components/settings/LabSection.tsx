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
import { Toggle } from "../ui/primitives/Toggle";

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
    <div
      className={`flex items-start gap-3 py-1 ${locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <Toggle
        enabled={value}
        disabled={locked}
        onChange={(enabled) => setFlag(flagKey, enabled)}
        aria-labelledby={`flag-${flagKey}-label`}
        aria-describedby={`flag-${flagKey}-description`}
        className="mt-0.5"
      />
      <span className="flex-1 min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span id={`flag-${flagKey}-label`} className="text-base text-cb-fg-0">{definition.label}</span>
          <span className="cb-badge shrink-0">
            {STAGE_LABEL[definition.stage] ?? definition.stage}
          </span>
        </span>
        <span id={`flag-${flagKey}-description`} className="block text-sm text-cb-fg-2 leading-relaxed mt-0.5">
          {definition.description}
        </span>
        {locked && (
          <span className="block text-sm text-cb-warn mt-1">
            Travada — {OVERRIDE_REASON[override]}.
          </span>
        )}
      </span>
    </div>
  );
}

export function LabSection() {
  const resetFlags = useFlagsStore((state) => state.resetFlags);

  return (
    <div className="flex flex-col gap-2">
      <div className="cb-note">
        <FlaskConical size={13} className="text-cb-accent shrink-0 mt-0.5" />
        <p>
          Recursos opcionais e fallback de compatibilidade. O shell
          terminal-first já é a experiência padrão.
        </p>
      </div>

      {FLAG_KEYS.map((key) => (
        <FlagToggle key={key} flagKey={key} />
      ))}

      <button
        onClick={resetFlags}
        className="cb-btn mt-1 w-full"
      >
        restaurar padrões
      </button>
    </div>
  );
}
