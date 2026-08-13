import { create } from "zustand";

/* ═══════════════════════════════════════════════════════════════════════════
   STORE DE MODAIS GLOBAIS
   ═══════════════════════════════════════════════════════════════════════════

   Antes, este estado vivia em `useState` dentro de `useModals()`, no
   AppHeader. Dois problemas:

   1. **Inalcançável de fora.** Providers, Squad, Libre e Diagnóstico só
      podiam ser abertos por um clique no header. O command palette, um
      atalho de teclado ou uma ação vinda do MCP não tinham como chegar lá —
      o estado estava preso no componente.

   2. **Três cópias.** `useModals()` é chamado por três componentes
      diferentes (header de home, header de workspace e a árvore de modais).
      Cada chamada criava seu próprio estado *e* registrava o listener de
      Ctrl+Shift+M de novo — então o atalho alternava três estados
      independentes de Perf HUD, e qual deles aparecia dependia de qual
      componente estava montado.

   Com o estado num store, existe um só; o atalho é registrado uma vez
   (em `useModalShortcuts`); e qualquer lugar do app pode abrir qualquer
   modal, que é o que o palette precisa.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Passo inicial do modal de Providers. */
export type ProvidersStep = "list" | "pickTemplate" | string;

interface ModalsState {
  showProviders: boolean;
  providersStep: ProvidersStep;
  showSquad: boolean;
  showSquadWizard: boolean;
  showDiag: boolean;
  showPerfHUD: boolean;
  showLibreWizard: boolean;

  openProviders: (step?: ProvidersStep) => void;
  closeProviders: () => void;
  setShowSquad: (value: boolean) => void;
  setShowSquadWizard: (value: boolean) => void;
  setShowDiag: (value: boolean) => void;
  setShowPerfHUD: (value: boolean) => void;
  togglePerfHUD: () => void;
  setShowLibreWizard: (value: boolean) => void;
  /** Fecha tudo — usado pelo Esc global e ao trocar de workspace. */
  closeAll: () => void;
}

export const useModalsStore = create<ModalsState>((set) => ({
  showProviders: false,
  providersStep: "list",
  showSquad: false,
  showSquadWizard: false,
  showDiag: false,
  showPerfHUD: false,
  showLibreWizard: false,

  openProviders: (step = "list") => set({ showProviders: true, providersStep: step }),
  closeProviders: () => set({ showProviders: false, providersStep: "list" }),
  setShowSquad: (value) => set({ showSquad: value }),
  setShowSquadWizard: (value) => set({ showSquadWizard: value }),
  setShowDiag: (value) => set({ showDiag: value }),
  setShowPerfHUD: (value) => set({ showPerfHUD: value }),
  togglePerfHUD: () => set((state) => ({ showPerfHUD: !state.showPerfHUD })),
  setShowLibreWizard: (value) => set({ showLibreWizard: value }),

  closeAll: () =>
    set({
      showProviders: false,
      providersStep: "list",
      showSquad: false,
      showSquadWizard: false,
      showDiag: false,
      showLibreWizard: false,
      // O Perf HUD é um overlay de diagnóstico, não um modal — sobrevive.
    }),
}));

/** Algum modal aberto? Usado para suprimir atalhos globais. */
export function isAnyModalOpen(): boolean {
  const state = useModalsStore.getState();
  return (
    state.showProviders ||
    state.showSquad ||
    state.showSquadWizard ||
    state.showDiag ||
    state.showLibreWizard
  );
}
