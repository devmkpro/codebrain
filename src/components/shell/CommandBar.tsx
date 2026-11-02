import React from "react";
import { ArrowLeft, ArrowRight, Search, Cpu } from "lucide-react";
import { usePaletteStore } from "../../stores/palette-store";
import { useRouter } from "../../lib/router";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/* ═══════════════════════════════════════════════════════════════════════════
   BARRA DE COMANDO
   ═══════════════════════════════════════════════════════════════════════════

   Topo do shell. Logotipo à esquerda, caminho do workspace no centro,
   busca e navegação à direita.
   ═══════════════════════════════════════════════════════════════════════════ */

export function CommandBar() {
  const { back, forward, canGoBack, canGoForward } = useRouter();
  const openPalette = usePaletteStore((state) => state.openPalette);

  return (
    <header
      className="flex items-center gap-2 h-cell-lg shrink-0 px-2 border-b border-cb-line-0 app-region-drag"
      style={{
        zIndex: "var(--cb-z-header)",
        background: "linear-gradient(180deg, var(--cb-bg-2) 0%, var(--cb-bg-1) 100%)",
      }}
    >
      {/* Logotipo / marca */}
      <div
        className="app-region-no-drag flex items-center gap-1.5 shrink-0 px-1"
        style={{ width: "calc(var(--cb-nav-strip-width) - 8px)" }}
      >
        <span
          className="flex items-center justify-center w-5 h-5 rounded-cb-1"
          style={{ background: "var(--cb-accent-wash)", color: "var(--cb-accent)" }}
          aria-hidden
        >
          <Cpu size={12} strokeWidth={2} />
        </span>
        <span
          className="text-xs font-bold tracking-widest uppercase"
          style={{ color: "var(--cb-accent)", letterSpacing: "0.12em" }}
        >
          CB
        </span>
      </div>

      <div className="cb-divider-v h-4" aria-hidden />

      {/* Navegação de histórico */}
      <div className="flex items-center gap-0.5 app-region-no-drag">
        <button
          type="button"
          onClick={back}
          disabled={!canGoBack}
          aria-label="Voltar"
          title="Voltar"
          className="p-1 rounded-cb-1 text-cb-fg-3 enabled:hover:text-cb-fg-1 enabled:hover:bg-cb-bg-2 disabled:opacity-30"
        >
          <ArrowLeft size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={forward}
          disabled={!canGoForward}
          aria-label="Avançar"
          title="Avançar"
          className="p-1 rounded-cb-1 text-cb-fg-3 enabled:hover:text-cb-fg-1 enabled:hover:bg-cb-bg-2 disabled:opacity-30"
        >
          <ArrowRight size={13} strokeWidth={1.5} />
        </button>
      </div>

      {/* Caminho do workspace */}
      <div className="flex-1 min-w-0">
        <WorkspaceSwitcher />
      </div>

      {/* Gatilho do palette */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Buscar ações"
        className="app-region-no-drag flex items-center gap-2 h-cell px-2 rounded-cb-1 border border-cb-line-1 text-cb-fg-2 hover:text-cb-fg-0 hover:border-cb-line-2 hover:bg-cb-bg-2 shrink-0 transition-colors duration-[var(--cb-duration-fast)]"
      >
        <Search size={12} strokeWidth={1.5} />
        <span className="text-2xs hidden sm:inline">buscar</span>
        <kbd className="cb-kbd">Ctrl</kbd>
        <kbd className="cb-kbd">K</kbd>
      </button>
    </header>
  );
}
