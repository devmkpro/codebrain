import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  createHistory,
  current,
  go,
  isSameLocation,
  match,
  matchFirst,
  MAX_HISTORY,
  normalizePath,
  parseHash,
  push,
  serializeHash,
  toLocation,
} from "./router-core";

describe("normalizePath", () => {
  it("normaliza para forma canônica", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("settings")).toBe("/settings");
    expect(normalizePath("/settings/")).toBe("/settings");
    expect(normalizePath("//a//b/")).toBe("/a/b");
  });
});

describe("parseHash / serializeHash", () => {
  it("faz parse de caminho puro", () => {
    expect(parseHash("#/settings")).toEqual({ path: "/settings", query: {} });
  });

  it("faz parse de query", () => {
    expect(parseHash("#/settings?section=providers&tab=2")).toEqual({
      path: "/settings",
      query: { section: "providers", tab: "2" },
    });
  });

  it("aceita hash sem # e cai para raiz quando vazio", () => {
    expect(parseHash("/workspaces")).toEqual({ path: "/workspaces", query: {} });
    expect(parseHash("")).toEqual({ path: "/", query: {} });
    expect(parseHash("#")).toEqual({ path: "/", query: {} });
  });

  it("faz round-trip preservando caminho e query", () => {
    const location = toLocation("/spec/003", { query: { view: "plan" } });
    expect(parseHash(serializeHash(location))).toEqual(location);
  });

  it("descarta valores vazios e nulos da query", () => {
    const location = toLocation("/x", {
      query: { keep: "1", drop: undefined, alsoDrop: null, empty: "" },
    });
    expect(location.query).toEqual({ keep: "1" });
  });

  it("sobrevive a caractere especial no caminho", () => {
    const location = toLocation("/workspace/C:/Users/Maike");
    expect(parseHash(serializeHash(location)).path).toBe(location.path);
  });
});

describe("push", () => {
  it("empilha uma nova entrada e move o cursor", () => {
    let history = createHistory();
    history = push(history, toLocation("/settings"));
    expect(current(history).path).toBe("/settings");
    expect(history.entries).toHaveLength(2);
    expect(canGoBack(history)).toBe(true);
  });

  it("ignora navegação para o mesmo lugar", () => {
    let history = createHistory();
    history = push(history, toLocation("/settings"));
    const before = history;
    history = push(history, toLocation("/settings"));
    // Mesma referência: nada mudou, nenhuma duplicata empilhada.
    expect(history).toBe(before);
    expect(history.entries).toHaveLength(2);
  });

  it("distingue caminhos iguais com query diferente", () => {
    let history = createHistory();
    history = push(history, toLocation("/settings", { query: { section: "a" } }));
    history = push(history, toLocation("/settings", { query: { section: "b" } }));
    expect(history.entries).toHaveLength(3);
    expect(current(history).query).toEqual({ section: "b" });
  });

  it("replace troca no lugar sem crescer a pilha", () => {
    let history = createHistory();
    history = push(history, toLocation("/a"));
    history = push(history, toLocation("/b"), { replace: true });
    expect(history.entries).toHaveLength(2);
    expect(current(history).path).toBe("/b");
  });

  it("trunca o futuro ao navegar a partir do meio do histórico", () => {
    let history = createHistory();
    history = push(history, toLocation("/a"));
    history = push(history, toLocation("/b"));
    history = go(history, -1); // volta para /a
    expect(canGoForward(history)).toBe(true);

    history = push(history, toLocation("/c"));
    // /b foi descartado — seguir outro rumo apaga o "avançar", como num browser.
    expect(canGoForward(history)).toBe(false);
    expect(history.entries.map((e) => e.path)).toEqual(["/", "/a", "/c"]);
  });

  it("poda pela frente ao passar do limite, mantendo o cursor no fim", () => {
    let history = createHistory();
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      history = push(history, toLocation(`/p${i}`));
    }
    expect(history.entries).toHaveLength(MAX_HISTORY);
    expect(history.index).toBe(MAX_HISTORY - 1);
    expect(current(history).path).toBe(`/p${MAX_HISTORY + 19}`);
  });
});

describe("go", () => {
  it("navega para trás e para frente", () => {
    let history = createHistory();
    history = push(history, toLocation("/a"));
    history = push(history, toLocation("/b"));

    history = go(history, -1);
    expect(current(history).path).toBe("/a");

    history = go(history, 1);
    expect(current(history).path).toBe("/b");
  });

  it("não faz nada fora dos limites", () => {
    let history = createHistory();
    expect(go(history, -1)).toBe(history);
    expect(go(history, 5)).toBe(history);
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(false);
  });
});

describe("match", () => {
  it("extrai segmentos dinâmicos", () => {
    expect(match("/spec/003", "/spec/:id")).toEqual({
      pattern: "/spec/:id",
      params: { id: "003" },
    });
  });

  it("não casa quando a aridade difere", () => {
    expect(match("/spec", "/spec/:id")).toBeNull();
    expect(match("/spec/003/plan", "/spec/:id")).toBeNull();
  });

  it("não casa quando um segmento estático difere", () => {
    expect(match("/task/003", "/spec/:id")).toBeNull();
  });

  it("casa rota estática", () => {
    expect(match("/settings", "/settings")?.params).toEqual({});
  });

  it("decodifica valores de parâmetro", () => {
    expect(match("/w/a%20b", "/w/:name")?.params).toEqual({ name: "a b" });
  });

  it("matchFirst devolve o primeiro padrão que casa", () => {
    const patterns = ["/spec", "/spec/:id", "/spec/:id/:section"];
    expect(matchFirst("/spec/003", patterns)?.pattern).toBe("/spec/:id");
    expect(matchFirst("/nope", patterns)).toBeNull();
  });
});

describe("isSameLocation", () => {
  it("compara caminho e query", () => {
    expect(isSameLocation(toLocation("/a"), toLocation("/a"))).toBe(true);
    expect(isSameLocation(toLocation("/a"), toLocation("/b"))).toBe(false);
    expect(
      isSameLocation(
        toLocation("/a", { query: { x: "1" } }),
        toLocation("/a", { query: { x: "1" } }),
      ),
    ).toBe(true);
    expect(
      isSameLocation(
        toLocation("/a", { query: { x: "1" } }),
        toLocation("/a", { query: { x: "2" } }),
      ),
    ).toBe(false);
    // Query com contagem de chaves diferente.
    expect(
      isSameLocation(toLocation("/a", { query: { x: "1" } }), toLocation("/a")),
    ).toBe(false);
  });
});
