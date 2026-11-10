import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePaletteStore } from "../../stores/palette-store";
import { useRouter } from "../../lib/router";
import { CodebrainMark, CodebrainWordmark } from "../ui/AppLogo";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { navigateHome } from "./shell-navigation";

/* ═══════════════════════════════════════════════════════════════════════════
   BARRA DE COMANDO
   ═══════════════════════════════════════════════════════════════════════════

   Topo do shell. Lê como uma linha de terminal: `codebrain ❯ workspace`, com
   o `❯` vindo do WorkspaceSwitcher. Busca à direita.
   ═══════════════════════════════════════════════════════════════════════════ */

const HISTORY_BUTTON =
  "cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon";

export function CommandBar() {
  const { back, forward, canGoBack, canGoForward } = useRouter();
  const openPalette = usePaletteStore((state) => state.openPalette);

  return (
    <header
      className="flex items-center gap-3 h-bar shrink-0 pl-3 pr-2 border-b border-cb-line-0 bg-cb-bg-1 app-region-drag"
      style={{ zIndex: "var(--cb-z-header)" }}
    >
      <button type="button" onClick={navigateHome} aria-label="Codebrain — Início" title="Ir para o início" className="flex items-center gap-2 shrink-0 select-none app-region-no-drag rounded-cb-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cb-accent">
        <CodebrainMark size={18} title="Codebrain" />
        <CodebrainWordmark className="text-base hidden sm:inline" />
      </button>

      <div className="flex items-center app-region-no-drag">
        <button type="button" onClick={back} disabled={!canGoBack} aria-label="Voltar" title="Voltar" className={HISTORY_BUTTON}>
          <ArrowLeft size={13} strokeWidth={1.75} />
        </button>
        <button type="button" onClick={forward} disabled={!canGoForward} aria-label="Avançar" title="Avançar" className={HISTORY_BUTTON}>
          <ArrowRight size={13} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 min-w-0">
        <WorkspaceSwitcher />
      </div>

      <button
        type="button"
        onClick={openPalette}
        aria-label="Buscar ações"
        className="app-region-no-drag cb-btn cb-btn--sm shrink-0 text-cb-fg-2"
      >
        <span className="hidden md:inline">buscar ações</span>
        <span className="flex items-center gap-1">
          <kbd className="cb-kbd">Ctrl</kbd>
          <kbd className="cb-kbd">K</kbd>
        </span>
      </button>
    </header>
  );
}
