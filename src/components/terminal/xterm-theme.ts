import React from "react";

/**
 * Tema do xterm lido dos tokens em runtime.
 *
 * É o que cumpre a promessa do ADR 0001: a paleta da UI *é* a paleta ANSI. O
 * vermelho de um stderr aqui é, literalmente, o valor de `--cb-ansi-red`.
 */
export function terminalThemeFromTokens(fallback?: Record<string, string>, root: HTMLElement = document.documentElement) {
  const styles = getComputedStyle(root);
  const token = (name: string) => styles.getPropertyValue(`--cb-${name}`).trim();
  if (!token("bg-inset")) return fallback;

  return {
    background: token("bg-inset"),
    foreground: token("fg-0"),
    cursor: token("accent"),
    cursorAccent: token("bg-inset"),
    selectionBackground: token("accent-dim"),
    selectionForeground: token("fg-0"),
    selectionInactiveBackground: token("bg-3"),
    black: token("ansi-black"),
    red: token("ansi-red"),
    green: token("ansi-green"),
    yellow: token("ansi-yellow"),
    blue: token("ansi-blue"),
    magenta: token("ansi-magenta"),
    cyan: token("ansi-cyan"),
    white: token("ansi-white"),
    // O ansi-bright-black dos tokens é uma cor de superfície; como texto, o
    // "cinza de comentário" das CLIs ficaria abaixo de 2:1 no poço escuro.
    brightBlack: token("fg-2"),
    brightRed: token("ansi-bright-red"),
    brightGreen: token("ansi-bright-green"),
    brightYellow: token("ansi-bright-yellow"),
    brightBlue: token("ansi-bright-blue"),
    brightMagenta: token("ansi-bright-magenta"),
    brightCyan: token("ansi-bright-cyan"),
    brightWhite: token("ansi-bright-white"),
  };
}

/**
 * Avisa quando o tema muda. Observa a classe do <html> em vez de assinar o
 * store porque o App troca a classe num efeito do pai, que roda depois dos
 * efeitos dos filhos: lendo tokens pelo store, viriam os valores antigos.
 */
export function observeTokenTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const BRAND_FONT = '"JetBrains Mono"';

/** A fonte da marca vem da web: só entra no stack depois de carregada. */
export function useBrandTerminalFont(fontFamilyId: string, stack: string): string {
  const [ready, setReady] = React.useState(() => isBrandFontLoaded());
  React.useEffect(() => {
    if (ready || !document.fonts?.load) return;
    let cancelled = false;
    document.fonts.load(`400 12px ${BRAND_FONT}`).then((faces) => {
      if (!cancelled && faces.length > 0) setReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ready]);
  return fontFamilyId === "system" && ready ? `${BRAND_FONT}, ${stack}` : stack;
}

function isBrandFontLoaded(): boolean {
  try {
    return [...document.fonts].some((face) => face.family.includes("JetBrains Mono") && face.status === "loaded");
  } catch {
    return false;
  }
}
