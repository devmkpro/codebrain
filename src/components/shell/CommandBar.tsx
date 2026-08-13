import React from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useNavStore } from "../../stores/nav-store";
import { usePaletteStore } from "../../stores/palette-store";
import { useRouter } from "../../lib/router";

/* ═══════════════════════════════════════════════════════════════════════════
   BARRA DE COMANDO
   ═══════════════════════════════════════════════════════════════════════════

   O topo do shell v2. Uma linha.

   O header antigo tinha ~15 ícones sem rótulo numa barra só: Providers,
   Squad, Libre, Cron, Recipes, Remote, Export, Map, Files, conta, tema… Cada
   feature nova disputava espaço, e nenhuma cabia com nome.

   Aqui sobra: caminho do workspace (como prompt de shell), navegação de
   histórico e o gatilho do palette. Todo o resto passou a ser alcançável por
   Ctrl+K — que, ao contrário de um ícone de 15px, tem nome, sinônimo e
   ensina o atalho.
   ═══════════════════════════════════════════════════════════════════════════ */

function basename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

/** Caminho encurtado no meio, preservando início e fim. */
function shortenPath(path: string, max = 44): string {
  if (path.length <= max) return path;
  const head = path.slice(0, Math.floor(max / 2) - 2);
  const tail = path.slice(-Math.ceil(max / 2) + 1);
  return `${head}…${tail}`;
}

export function CommandBar() {
  const { back, forward, canGoBack, canGoForward } = useRouter();
  const openPalette = usePaletteStore((state) => state.openPalette);

  const onHome = useNavStore((state) => state.onHome);
  const tabs = useNavStore((state) => state.tabs) as { workspacePath: string }[];
  const activeIndex = useNavStore((state) => state.activeTabIndex);

  const workspacePath = !onHome ? tabs[activeIndex]?.workspacePath : undefined;

  return (
    <header
      className="flex items-center gap-2 h-cell-lg shrink-0 px-2 bg-cb-bg-1 border-b border-cb-line-0 app-region-drag"
      style={{ zIndex: "var(--cb-z-header)" }}
    >
      {/* Navegação de histórico — o shell antigo não tinha "voltar" nenhum. */}
      <div className="flex items-center gap-0.5 app-region-no-drag">
        <button
          type="button"
          onClick={back}
          disabled={!canGoBack}
          aria-label="Voltar"
          title="Voltar"
          className="p-1 rounded-cb-1 text-cb-fg-3 enabled:hover:text-cb-fg-1 enabled:hover:bg-cb-bg-2 disabled:opacity-40"
        >
          <ArrowLeft size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={forward}
          disabled={!canGoForward}
          aria-label="Avançar"
          title="Avançar"
          className="p-1 rounded-cb-1 text-cb-fg-3 enabled:hover:text-cb-fg-1 enabled:hover:bg-cb-bg-2 disabled:opacity-40"
        >
          <ArrowRight size={13} strokeWidth={1.5} />
        </button>
      </div>

      <div className="cb-divider-v h-4" aria-hidden />

      {/* Caminho como prompt. É a assinatura visual do shell v2: o app se
          apresenta como um terminal, não como um site com breadcrumb. */}
      <div className="flex items-baseline gap-2 min-w-0 flex-1">
        <span className="text-cb-accent text-sm select-none shrink-0" aria-hidden>
          ❯
        </span>
        {workspacePath ? (
          <>
            <span className="text-sm text-cb-fg-0 truncate">
              {basename(workspacePath)}
            </span>
            <span
              className="text-2xs text-cb-fg-3 truncate hidden md:inline"
              title={workspacePath}
            >
              {shortenPath(workspacePath)}
            </span>
          </>
        ) : (
          <span className="text-sm text-cb-fg-2">codebrain</span>
        )}
      </div>

      {/* Gatilho do palette. Mostra o atalho no próprio botão — quem clicar
          uma vez aprende a nunca mais precisar clicar. */}
      <button
        type="button"
        onClick={openPalette}
        aria-label="Buscar ações"
        className="app-region-no-drag flex items-center gap-2 h-cell px-2 rounded-cb-1 border border-cb-line-1 text-cb-fg-2 hover:text-cb-fg-0 hover:border-cb-line-2 shrink-0"
      >
        <Search size={12} strokeWidth={1.5} />
        <span className="text-2xs hidden sm:inline">buscar</span>
        <kbd className="cb-kbd">Ctrl</kbd>
        <kbd className="cb-kbd">K</kbd>
      </button>
    </header>
  );
}
