import { createJSONStorage } from "zustand/middleware";

/* ═══════════════════════════════════════════════════════════════════════════
   STORAGE DE PERSISTÊNCIA DOS STORES
   ═══════════════════════════════════════════════════════════════════════════

   O `persist` do zustand, sem a opção `storage`, usa o global `localStorage`
   cru. Isso deixou de ser inequívoco: o Node 26 passou a expor um
   `localStorage` GLOBAL PRÓPRIO que só funciona com `--localstorage-file` e
   que tem precedência sobre o do jsdom. Sob `vitest`, o resultado é o zustand
   capturar `undefined` e qualquer `setState` estourar em
   `Cannot read properties of undefined (reading 'setItem')` — cinco testes de
   renderer quebraram exatamente assim ao subir o Node, sem uma linha do app
   ter mudado.

   Resolver dentro do teste seria tratar sintoma. `window.localStorage` é
   explícito: no renderer do Electron é o que sempre se quis, e sob jsdom
   resolve o do jsdom em vez do global do Node.

   O fallback em memória existe para o caso de o storage não estar acessível
   de verdade — janela sem origem, modo restrito do navegador, cota estourada.
   Nesse caso o store funciona e apenas não sobrevive ao recarregamento, que é
   melhor que a aplicação não subir.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Último recurso: mantém a sessão viva sem persistir entre recargas. */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

let memory: Storage | null = null;

/** Resolve o storage real, com fallback, sem nunca devolver `undefined`. */
function resolveStorage(): Storage {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      // Uma leitura de prova: em algumas configurações o objeto existe e o
      // acesso é que lança.
      window.localStorage.getItem("__codebrain_probe__");
      return window.localStorage;
    }
  } catch {
    /* cai no fallback */
  }
  if (!memory) memory = createMemoryStorage();
  return memory;
}

/**
 * Storage compartilhado por todos os stores persistidos.
 * Passe como `storage` nas opções do `persist`.
 */
export const appStorage = createJSONStorage(() => resolveStorage());
