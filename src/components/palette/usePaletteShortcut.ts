import React from "react";
import { getActions } from "../../lib/actions";
import { usePaletteStore } from "../../stores/palette-store";

/* ═══════════════════════════════════════════════════════════════════════════
   ATALHOS GLOBAIS DO PALETTE
   ═══════════════════════════════════════════════════════════════════════════

   Ctrl+K (e Cmd+K no mac) abre e fecha o palette.

   Também executa os atalhos declarados pelas próprias ações: em vez de cada
   feature registrar seu `keydown`, a ação declara `shortcut: ["Ctrl","T"]` e
   este handler resolve. É o que mantém o atalho exibido no palette e o
   atalho que realmente funciona sempre iguais — antes eles eram declarados em
   lugares diferentes e podiam divergir sem que ninguém percebesse.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Um evento de teclado casa com a combinação declarada? */
function matchesShortcut(event: KeyboardEvent, shortcut: string[]): boolean {
  const keys = shortcut.map((key) => key.toLowerCase());

  const wantsCtrl = keys.includes("ctrl") || keys.includes("cmd");
  const wantsShift = keys.includes("shift");
  const wantsAlt = keys.includes("alt");

  // Cmd no mac, Ctrl no resto.
  const hasCtrl = event.ctrlKey || event.metaKey;
  if (wantsCtrl !== hasCtrl) return false;
  if (wantsAlt !== event.altKey) return false;

  const main = keys.find(
    (key) => key !== "ctrl" && key !== "cmd" && key !== "shift" && key !== "alt",
  );
  if (!main) return false;

  // Teclas com alias dependem do layout para exigir Shift ou não (em ABNT2 o
  // "+" só sai com Shift), então para elas o estado do Shift não é checado.
  const layoutDependent = main in SHORTCUT_ALIASES;
  if (!layoutDependent && wantsShift !== event.shiftKey) return false;

  return (SHORTCUT_ALIASES[main] ?? [main]).includes(event.key.toLowerCase());
}

/**
 * Teclas que produzem `event.key` diferente conforme o layout.
 *
 * Em ABNT2 o "+" exige Shift; em layout US, Ctrl+= é o gesto natural de dar
 * zoom. Declarar a ação como `["Ctrl","+"]` e aceitar os dois evita ter que
 * espalhar variantes de layout por vários handlers — que era como estava,
 * com o App.tsx tratando "=", "+", "-" e "_" na mão.
 */
const SHORTCUT_ALIASES: Record<string, string[]> = {
  "+": ["+", "="],
  "-": ["-", "_"],
};

/** O foco está num campo de texto? Aí atalhos de uma tecla não valem. */
function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Atalhos globais.
 *
 * @param paletteEnabled  Ctrl+K só abre o palette quando a flag está ligada.
 *                        Os atalhos declarados pelas ações valem sempre — eles
 *                        substituem os handlers que viviam soltos no App.tsx,
 *                        e desligá-los junto com a flag tiraria Ctrl+T do
 *                        usuário sem motivo.
 */
export function useGlobalShortcuts(paletteEnabled: boolean): void {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ctrl+K / Cmd+K — funciona mesmo com foco em campo de texto, senão o
      // palette ficaria inacessível justamente enquanto se digita.
      if (
        paletteEnabled &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        usePaletteStore.getState().togglePalette();
        return;
      }

      // Com o palette aberto, ele cuida do próprio teclado.
      if (usePaletteStore.getState().open) return;

      // Atalhos declarados pelas ações. Um atalho sem modificador não dispara
      // enquanto se digita — inclusive dentro do terminal.
      for (const action of getActions()) {
        if (!action.shortcut) continue;
        const hasModifier = action.shortcut.some((key) =>
          ["ctrl", "cmd", "alt"].includes(key.toLowerCase()),
        );
        if (!hasModifier && isEditingText(event.target)) continue;
        if (!matchesShortcut(event, action.shortcut)) continue;
        if (action.enabled && !action.enabled()) continue;

        event.preventDefault();
        void action.run();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteEnabled]);
}
