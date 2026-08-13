import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Action,
  actionSearchFields,
  availableActions,
  getAction,
  getActions,
  registerActions,
  runAction,
  unregisterAction,
  __resetActions,
} from "./actions";

function makeAction(overrides: Partial<Action> & { id: string }): Action {
  return {
    title: overrides.id,
    group: "sistema",
    run: () => {},
    ...overrides,
  };
}

afterEach(() => __resetActions());

describe("registro", () => {
  it("registra e recupera", () => {
    registerActions(makeAction({ id: "a" }), makeAction({ id: "b" }));
    expect(getActions()).toHaveLength(2);
    expect(getAction("a")?.id).toBe("a");
  });

  it("a função de remoção tira só o que registrou", () => {
    registerActions(makeAction({ id: "permanente" }));
    const dispose = registerActions(makeAction({ id: "temporária" }));

    expect(getActions()).toHaveLength(2);
    dispose();
    expect(getActions().map((a) => a.id)).toEqual(["permanente"]);
  });

  it("registrar o mesmo id substitui", () => {
    registerActions(makeAction({ id: "x", title: "Antigo" }));
    registerActions(makeAction({ id: "x", title: "Novo" }));

    expect(getActions()).toHaveLength(1);
    expect(getAction("x")?.title).toBe("Novo");
  });

  it("a limpeza não apaga um registro posterior com o mesmo id", () => {
    // Cenário real: um componente remonta e registra a mesma ação antes de o
    // cleanup do anterior rodar. Sem a checagem de identidade, a ação
    // desapareceria.
    const dispose = registerActions(makeAction({ id: "x", title: "Primeiro" }));
    registerActions(makeAction({ id: "x", title: "Segundo" }));
    dispose();

    expect(getAction("x")?.title).toBe("Segundo");
  });

  it("unregisterAction remove por id", () => {
    registerActions(makeAction({ id: "a" }));
    unregisterAction("a");
    expect(getActions()).toHaveLength(0);
  });
});

describe("runAction", () => {
  it("executa e informa sucesso", async () => {
    const run = vi.fn();
    registerActions(makeAction({ id: "a", run }));

    expect(await runAction("a")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("id desconhecido devolve false em vez de estourar", async () => {
    expect(await runAction("inexistente")).toBe(false);
  });

  it("não executa ação indisponível", async () => {
    const run = vi.fn();
    registerActions(makeAction({ id: "a", run, enabled: () => false }));

    expect(await runAction("a")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("aguarda ação assíncrona", async () => {
    let done = false;
    registerActions(
      makeAction({
        id: "a",
        run: async () => {
          await Promise.resolve();
          done = true;
        },
      }),
    );

    await runAction("a");
    expect(done).toBe(true);
  });
});

describe("availableActions", () => {
  it("esconde as indisponíveis", () => {
    registerActions(
      makeAction({ id: "visível" }),
      makeAction({ id: "escondida", enabled: () => false }),
    );
    expect(availableActions().map((a) => a.id)).toEqual(["visível"]);
  });

  it("ordena por grupo, depois prioridade, depois título", () => {
    registerActions(
      makeAction({ id: "s1", group: "sistema", title: "Zebra" }),
      makeAction({ id: "a1", group: "agentes", title: "Beta", priority: 1 }),
      makeAction({ id: "a2", group: "agentes", title: "Alfa", priority: 10 }),
      makeAction({ id: "a3", group: "agentes", title: "Alfa" }),
    );

    // agentes vem antes de sistema; dentro do grupo, prioridade maior
    // primeiro; sem prioridade, ordem alfabética.
    expect(availableActions().map((a) => a.id)).toEqual(["a2", "a1", "a3", "s1"]);
  });

  it("ordena títulos acentuados como o português espera", () => {
    registerActions(
      makeAction({ id: "z", group: "sistema", title: "Zoom" }),
      makeAction({ id: "m", group: "sistema", title: "Área" }),
    );
    expect(availableActions().map((a) => a.id)).toEqual(["m", "z"]);
  });
});

describe("actionSearchFields", () => {
  it("inclui grupo, palavras-chave e subtítulo", () => {
    const action = makeAction({
      id: "a",
      group: "painéis",
      keywords: ["memory", "sqlite"],
      subtitle: "Memória compartilhada",
    });
    expect(actionSearchFields(action)).toEqual([
      "painéis",
      "memory",
      "sqlite",
      "Memória compartilhada",
    ]);
  });

  it("funciona sem palavras-chave nem subtítulo", () => {
    expect(actionSearchFields(makeAction({ id: "a", group: "sistema" }))).toEqual([
      "sistema",
    ]);
  });
});
