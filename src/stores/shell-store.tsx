import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ═══════════════════════════════════════════════════════════════════════════
   STORE DO SHELL V2
   ═══════════════════════════════════════════════════════════════════════════

   Estado de layout do shell terminal-first: o que está recolhido, qual a
   densidade. Persistido, porque é preferência de espaço de trabalho — o
   usuário não deve reconfigurar a cada abertura.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Density = "compact" | "normal" | "comfortable";

interface ShellState {
  railCollapsed: boolean;
  density: Density;

  toggleRail: () => void;
  setRailCollapsed: (value: boolean) => void;
  setDensity: (value: Density) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      density: "normal",

      toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
      setRailCollapsed: (value) => set({ railCollapsed: value }),
      setDensity: (value) => set({ density: value }),
    }),
    { name: "codebrain.shell" },
  ),
);

/**
 * Aplica a densidade no elemento raiz.
 *
 * `data-density` reescala a grade de células inteira em `base.css` — uma
 * variável, e cada linha, menu e campo acompanha. É o tipo de coisa que só é
 * barata porque o layout se apoia em token em vez de altura fixa.
 */
export function applyDensity(density: Density): void {
  const root = document.documentElement;
  if (density === "normal") root.removeAttribute("data-density");
  else root.setAttribute("data-density", density);
}
