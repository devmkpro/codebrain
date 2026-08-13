import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlightSegments, rankItems } from "./fuzzy";

/** Texto reconstruído a partir dos índices casados. */
function matchedChars(text: string, indices: number[]): string {
  return indices.map((i) => text[i]).join("");
}

describe("fuzzyMatch", () => {
  it("casa subsequência e devolve os índices certos", () => {
    const match = fuzzyMatch("npt", "Novo Pane no Terminal");
    expect(match).not.toBeNull();
    expect(matchedChars("Novo Pane no Terminal", match!.indices)).toBe("NPT");
  });

  it("não casa quando falta caractere", () => {
    expect(fuzzyMatch("xyz", "Novo Pane")).toBeNull();
  });

  it("respeita a ordem — subsequência, não conjunto", () => {
    // "Pane Novo" tem n e p, mas nenhum p depois de um n.
    expect(fuzzyMatch("np", "Pane Novo")).toBeNull();
    expect(fuzzyMatch("pn", "Pane Novo")).not.toBeNull();
  });

  it("acha o alinhamento certo quando a escolha gulosa falharia", () => {
    // Guloso levaria o "e" para o "entre" (início de palavra) e não sobraria
    // "m" depois — devolvendo null para um casamento que existe.
    const text = "Memória compartilhada entre agentes";
    const match = fuzzyMatch("mem", text);
    expect(match).not.toBeNull();
    expect(matchedChars(text, match!.indices)).toBe("Mem");
  });

  it("query vazia casa com tudo, sem destaque", () => {
    expect(fuzzyMatch("", "qualquer")).toEqual({ score: 0, indices: [] });
  });

  it("é insensível a caixa", () => {
    expect(fuzzyMatch("PANE", "novo pane")).not.toBeNull();
    expect(fuzzyMatch("pane", "Novo PANE")).not.toBeNull();
  });

  it("descarta query maior que o texto", () => {
    expect(fuzzyMatch("abcdefgh", "abc")).toBeNull();
  });

  it("prefere início de palavra a letra no meio", () => {
    // "s" deve casar o S de "Squad", não o s de "console".
    const match = fuzzyMatch("s", "console Squad");
    expect(match!.indices[0]).toBe("console ".length);
  });

  it("pontua início de string acima de início de palavra", () => {
    const atStart = fuzzyMatch("m", "Memória")!.score;
    const midWord = fuzzyMatch("m", "Abrir Memória")!.score;
    expect(atStart).toBeGreaterThan(midWord);
  });

  it("pontua consecutivo acima de espalhado", () => {
    const consecutive = fuzzyMatch("spa", "spawn")!.score;
    const scattered = fuzzyMatch("spa", "s p a")!.score;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("reconhece fronteira camelCase", () => {
    const match = fuzzyMatch("ps", "paneSpawn");
    expect(matchedChars("paneSpawn", match!.indices)).toBe("pS");
  });

  it("desempata pelo texto mais curto", () => {
    const short = fuzzyMatch("mem", "Memória")!.score;
    const long = fuzzyMatch("mem", "Memória compartilhada entre agentes")!.score;
    expect(short).toBeGreaterThan(long);
  });
});

describe("rankItems", () => {
  const actions = [
    { title: "Abrir Configurações" },
    { title: "Novo Pane", keywords: ["terminal", "spawn"] },
    { title: "Novo Squad" },
    { title: "Painel de Memória" },
  ];

  const options = {
    primary: (a: (typeof actions)[number]) => a.title,
    secondary: (a: (typeof actions)[number]) => a.keywords ?? [],
  };

  it("sem query devolve tudo na ordem original", () => {
    const ranked = rankItems("", actions, options);
    expect(ranked.map((r) => r.item.title)).toEqual(actions.map((a) => a.title));
  });

  it("filtra e ordena por relevância", () => {
    const ranked = rankItems("nova", actions, options);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].item.title).toMatch(/^Novo/);
  });

  it("casa por palavra-chave, com peso menor que o título", () => {
    const ranked = rankItems("spawn", actions, options);
    expect(ranked.map((r) => r.item.title)).toContain("Novo Pane");
    // Casou por metadado, então não há destaque no título.
    const pane = ranked.find((r) => r.item.title === "Novo Pane")!;
    expect(pane.indices).toEqual([]);
  });

  it("título vence palavra-chave com a mesma query", () => {
    const items = [
      { title: "Registro de sessão", keywords: ["memória"] },
      { title: "Memória", keywords: [] },
    ];
    const ranked = rankItems("memória", items, {
      primary: (i) => i.title,
      secondary: (i) => i.keywords,
    });
    expect(ranked[0].item.title).toBe("Memória");
  });

  it("é estável entre scores iguais", () => {
    const items = [{ title: "Igual A" }, { title: "Igual B" }];
    const ranked = rankItems("", items, { primary: (i) => i.title });
    expect(ranked.map((r) => r.item.title)).toEqual(["Igual A", "Igual B"]);
  });

  it("respeita o threshold", () => {
    const ranked = rankItems("a", actions, { ...options, threshold: 10_000 });
    expect(ranked).toHaveLength(0);
  });
});

describe("highlightSegments", () => {
  it("fatia em trechos casados e não casados", () => {
    expect(highlightSegments("Novo Pane", [0, 5])).toEqual([
      { text: "N", matched: true },
      { text: "ovo ", matched: false },
      { text: "P", matched: true },
      { text: "ane", matched: false },
    ]);
  });

  it("agrupa índices consecutivos num trecho só", () => {
    expect(highlightSegments("spawn", [0, 1, 2])).toEqual([
      { text: "spa", matched: true },
      { text: "wn", matched: false },
    ]);
  });

  it("sem índices devolve o texto inteiro sem destaque", () => {
    expect(highlightSegments("Novo Pane", [])).toEqual([
      { text: "Novo Pane", matched: false },
    ]);
  });

  it("preserva o texto original ao concatenar", () => {
    const text = "Painel de Memória";
    const rebuilt = highlightSegments(text, [0, 10, 11])
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(text);
  });
});
