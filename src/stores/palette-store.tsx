import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ═══════════════════════════════════════════════════════════════════════════
   STORE DO COMMAND PALETTE
   ═══════════════════════════════════════════════════════════════════════════

   Estado de abertura mais a lista de usados recentemente.

   O MRU importa mais do que parece: sem ele, a lista sem query é uma ordem
   fixa e o palette obriga a digitar sempre. Com ele, as três ou quatro ações
   que a pessoa realmente usa ficam a um Ctrl+K e um Enter de distância.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Quantos ids de ação lembrar. Além disso vira ruído. */
const MAX_RECENT = 8;

interface PaletteState {
  open: boolean;
  /** Ids de ação, mais recente primeiro. */
  recent: string[];

  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  /** Marca uma ação como usada agora. */
  markUsed: (actionId: string) => void;
  clearRecent: () => void;
}

export const usePaletteStore = create<PaletteState>()(
  persist(
    (set, get) => ({
      open: false,
      recent: [],

      openPalette: () => set({ open: true }),
      closePalette: () => set({ open: false }),
      togglePalette: () => set((state) => ({ open: !state.open })),

      markUsed: (actionId) =>
        set({
          recent: [actionId, ...get().recent.filter((id) => id !== actionId)].slice(
            0,
            MAX_RECENT,
          ),
        }),

      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: "codebrain.palette",
      // `open` é estado de sessão — restaurar o palette aberto no boot seria
      // no mínimo estranho.
      partialize: (state) => ({ recent: state.recent }),
    },
  ),
);
