import { afterEach, describe, expect, it } from "vitest";
import {
  defaultFlags,
  FLAG_DEFINITIONS,
  FLAG_KEYS,
  flagOverrideSource,
  resolveFlag,
} from "./flags";

/** Injeta overrides de ambiente como o preload faz. */
function setEnvOverrides(overrides: Record<string, boolean> | undefined) {
  (window as unknown as { __CODEBRAIN_FLAGS__?: unknown }).__CODEBRAIN_FLAGS__ = overrides;
}

/** Reescreve a query string sem recarregar (jsdom permite). */
function setQuery(search: string) {
  window.history.replaceState(null, "", search || "/");
}

afterEach(() => {
  setEnvOverrides(undefined);
  setQuery("");
});

describe("resolveFlag", () => {
  it("cai para o default quando não há preferência nem override", () => {
    expect(resolveFlag("shellV2")).toBe(FLAG_DEFINITIONS.shellV2.default);
  });

  it("preferência salva vence o default", () => {
    expect(resolveFlag("shellV2", { shellV2: true })).toBe(true);
  });

  it("ambiente vence a preferência salva", () => {
    setEnvOverrides({ SHELLV2: true });
    expect(resolveFlag("shellV2", { shellV2: false })).toBe(true);
  });

  it("casa a variável de ambiente sem diferenciar caixa", () => {
    // CODEBRAIN_FF_SHELLV2 chega como "SHELLV2"; a flag é "shellV2".
    setEnvOverrides({ SHELLV2: true });
    expect(resolveFlag("shellV2")).toBe(true);
  });

  it("query string vence tudo", () => {
    setEnvOverrides({ SHELLV2: false });
    setQuery("?ff_shellV2=1");
    expect(resolveFlag("shellV2", { shellV2: false })).toBe(true);
  });

  it("query string desliga com 0", () => {
    setQuery("?ff_shellV2=0");
    expect(resolveFlag("shellV2", { shellV2: true })).toBe(false);
  });

  it("ignora override de outra flag", () => {
    setQuery("?ff_specKit=1");
    expect(resolveFlag("shellV2", { shellV2: false })).toBe(false);
    expect(resolveFlag("specKit")).toBe(true);
  });
});

describe("flagOverrideSource", () => {
  it("identifica a origem do travamento", () => {
    expect(flagOverrideSource("shellV2")).toBeNull();

    setEnvOverrides({ SHELLV2: true });
    expect(flagOverrideSource("shellV2")).toBe("env");

    setQuery("?ff_shellV2=1");
    expect(flagOverrideSource("shellV2")).toBe("query");
  });
});

describe("registro de flags", () => {
  it("todas as flags têm rótulo, descrição e estágio", () => {
    for (const key of FLAG_KEYS) {
      const definition = FLAG_DEFINITIONS[key];
      expect(definition.label, `${key} sem label`).toBeTruthy();
      expect(definition.description, `${key} sem descrição`).toBeTruthy();
      expect(["experimental", "beta", "stable"]).toContain(definition.stage);
    }
  });

  it("defaultFlags cobre todas as chaves", () => {
    expect(Object.keys(defaultFlags()).sort()).toEqual([...FLAG_KEYS].sort());
  });
});
