import React from "react";

// CodeRain: textura estática de código, recortada para sumir ao centro.
import { useNavStore } from "../../stores/nav-store";

const GLYPHS = "<>/{}()=;:01[]*";

/** Sequência determinística: a tela de entrada é a mesma a cada abertura. */
function field(lines: number, columns: number): string {
  let seed = 42;
  const rows: string[] = [];
  for (let y = 0; y < lines; y++) {
    let row = "";
    for (let x = 0; x < columns; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      row += seed % 5 === 0 ? GLYPHS[seed % GLYPHS.length] : " ";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

const FIELD = field(70, 220);

export function CodeRain() {
  return (
    <pre
      className="absolute inset-0 m-0 overflow-hidden pointer-events-none select-none text-sm text-cb-fg-3 opacity-50"
      style={{
        lineHeight: "var(--cb-cell)",
        maskImage: "radial-gradient(ellipse 46% 56% at center, transparent 45%, black 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 46% 56% at center, transparent 45%, black 100%)",
      }}
      aria-hidden
    >
      {FIELD}
    </pre>
  );
}
function switchUserState(email) {
  const prev = localStorage.getItem("codebrain-app-active-user");
  if (prev === email) return;
  localStorage.setItem("codebrain-app-active-user", email);
  useNavStore.persist.setOptions({
    name: `codebrain-app-nav-${email}`
  });
  useNavStore.persist.rehydrate();
}
