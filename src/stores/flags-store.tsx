import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import {
  defaultFlags,
  type FlagKey,
  FLAG_KEYS,
  resolveFlag,
} from "../lib/flags";

/* ═══════════════════════════════════════════════════════════════════════════
   STORE DE FEATURE FLAGS
   ═══════════════════════════════════════════════════════════════════════════

   Guarda só a *preferência* do usuário. O valor efetivo sai de
   `resolveFlag()`, que aplica os overrides de query string e ambiente por
   cima — por isso ler `state.flags[key]` direto costuma ser errado; use
   `useFlag(key)` ou `isFlagEnabled(key)`.
   ═══════════════════════════════════════════════════════════════════════════ */

interface FlagsState {
  /** Preferências salvas. Ausência = usar o default da flag. */
  flags: Partial<Record<FlagKey, boolean>>;
  setFlag: (key: FlagKey, value: boolean) => void;
  toggleFlag: (key: FlagKey) => void;
  /** Volta todas as flags ao default. */
  resetFlags: () => void;
}

export const useFlagsStore = create<FlagsState>()(
  persist(
    (set, get) => ({
      flags: {},
      setFlag: (key, value) => set({ flags: { ...get().flags, [key]: value } }),
      toggleFlag: (key) =>
        set({
          flags: { ...get().flags, [key]: !resolveFlag(key, get().flags) },
        }),
      resetFlags: () => set({ flags: {} }),
    }),
    {
      name: "codebrain.flags",
      version: 1,
      // A versão 0 foi distribuída enquanto shellV2 tinha default false. Uma
      // preferência `false` daquela fase era só o valor semeado pelo produto,
      // não uma escolha consciente. Removê-la na migração faz o shell novo
      // realmente virar padrão para instalações existentes.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<FlagsState>;
        if (version < 1 && state.flags) {
          const { shellV2: _legacyShellPreference, ...flags } = state.flags;
          return { ...state, flags } as FlagsState;
        }
        return state as FlagsState;
      },
      // Descarta chaves de flags removidas do código, para que preferências
      // antigas não fiquem penduradas no localStorage para sempre.
      merge: (persisted, currentState) => {
        const incoming = (persisted as FlagsState | undefined)?.flags ?? {};
        const flags = Object.fromEntries(
          Object.entries(incoming).filter(([key]) =>
            FLAG_KEYS.includes(key as FlagKey),
          ),
        );
        return { ...currentState, flags };
      },
    },
  ),
);

/** Valor efetivo de uma flag, reagindo a mudanças. Para uso em componente. */
export function useFlag(key: FlagKey): boolean {
  return useFlagsStore((state) => resolveFlag(key, state.flags));
}

/** Valor efetivo fora do React — decisões de boot, handlers, atalhos. */
export function isFlagEnabled(key: FlagKey): boolean {
  return resolveFlag(key, useFlagsStore.getState().flags);
}

/**
 * Todas as flags com o valor efetivo. Usado pela tela de configurações.
 *
 * `useShallow` é obrigatório aqui: o seletor monta um objeto novo a cada
 * chamada e o zustand v5 compara por identidade — sem a comparação rasa isto
 * re-renderiza em loop.
 */
export function useAllFlags(): Record<FlagKey, boolean> {
  return useFlagsStore(
    useShallow((state) => {
      const resolved = defaultFlags();
      for (const key of FLAG_KEYS) resolved[key] = resolveFlag(key, state.flags);
      return resolved;
    }),
  );
}
