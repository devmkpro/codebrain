// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  deciderCredentials,
  listDeciderProviders,
  mediaCredentials,
  type HarnessProvider,
} from "./harness-providers";
import { getEnhancedProviders } from "./providers";

const openai: HarnessProvider = {
  id: "openai",
  label: "OpenAI",
  type: "openai-compat",
  baseUrl: "https://api.openai.com/v1/",
  tokenEnvVar: "OPENAI_API_KEY",
  env: { OPENAI_API_KEY: "k1" },
  models: ["m"],
};
const gemini: HarnessProvider = {
  id: "gemini",
  type: "gemini-compat",
  baseUrl: "https://g/v1beta",
  env: { GEMINI_API_KEY: "k2" },
};
const mimo: HarnessProvider = {
  id: "mimo",
  type: "mimo-compat",
  baseUrl: "https://m/anthropic",
  env: { MIMO_API_KEY: "k3" },
};
const openrouter: HarnessProvider = {
  id: "openrouter",
  type: "openai-compat",
  baseUrl: "https://openrouter.ai/api/v1",
  env: { OPENROUTER_API_KEY: "k4" },
};
const oauth: HarnessProvider = { id: "claude-oauth", type: "oauth", env: {} };
const masked: HarnessProvider = {
  id: "x",
  type: "openai-compat",
  baseUrl: "https://x",
  env: { OPENAI_API_KEY: "****" },
};

describe("deciderCredentials", () => {
  it("lê o formato persistido com URL no env", () => {
    const provider = {
      id: "custom",
      type: "openai-compat",
      env: { OPENAI_BASE_URL: "https://proxy/v1/", OPENAI_API_KEY: " key " },
    };
    expect(deciderCredentials([provider], "custom")).toEqual({
      baseUrl: "https://proxy/v1",
      apiKey: "key",
    });
    expect(deciderCredentials([{ ...provider, tokenEnvVar: "OTHER_KEY" }], "custom")).toBeNull();
  });

  it.each(["   ", " **** ", "bad\nkey"])("recusa chave inválida %j", (apiKey) => {
    expect(
      deciderCredentials([{ ...openai, env: { OPENAI_API_KEY: apiKey } }], "openai")
    ).toBeNull();
  });

  it("não usa segredo de outro serviço nem URL inválida", () => {
    expect(
      deciderCredentials(
        [
          {
            id: "custom",
            type: "openai-compat",
            baseUrl: "https://proxy",
            env: { UNRELATED_API_KEY: "secret" },
          },
        ],
        "custom"
      )
    ).toBeNull();
    expect(deciderCredentials([{ ...openai, baseUrl: "file:///tmp/x" }], "openai")).toBeNull();
  });
  it("usa o endpoint compatível de cada tipo", () => {
    const all = [openai, gemini, mimo];
    expect(deciderCredentials(all, "openai")).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "k1",
    });
    expect(deciderCredentials(all, "gemini")?.baseUrl).toBe("https://g/v1beta/openai");
    expect(deciderCredentials(all, "mimo")?.baseUrl).toBe("https://m/v1");
  });

  it("recusa provedor desconhecido, sem chave ou com chave mascarada", () => {
    expect(deciderCredentials([openai], "nada")).toBeNull();
    expect(deciderCredentials([oauth], "claude-oauth")).toBeNull();
    expect(deciderCredentials([masked], "x")).toBeNull();
  });
});

describe("listDeciderProviders", () => {
  it("three detected native CLI providers do not imply three API credentials", () => {
    const ctx = {
      providerStore: { listFull: () => [] },
      cliDetector: { getAll: () => ({ claude: { found: true }, codex: { found: true }, gemini: { found: true } }) },
    } as any;
    const providers = getEnhancedProviders(ctx);
    expect(providers.map(provider => provider.id).sort()).toEqual(["claude-oauth", "codex-oauth", "gemini-cli"]);
    expect(providers.every(provider => Object.keys(provider.env).length === 0)).toBe(true);
    expect(listDeciderProviders(providers)).toEqual([]);
  });

  it("uses unmasked main-process API credentials alongside the native CLI registry", () => {
    const ctx = {
      providerStore: { listFull: () => [openai, gemini, mimo, openrouter] },
      cliDetector: { getAll: () => ({ claude: { found: true }, codex: { found: true }, gemini: { found: true } }) },
    } as any;
    const providers = getEnhancedProviders(ctx);
    const listed = listDeciderProviders(providers);
    expect(listed.map(provider => provider.id).sort()).toEqual(["gemini", "mimo", "openai", "openrouter"]);
    expect(listed.every(provider => Object.keys(provider).sort().join() === "id,label,models")).toBe(true);
    expect(deciderCredentials(providers, "openai")).toEqual({ baseUrl: "https://api.openai.com/v1", apiKey: "k1" });
  });

  it("does not describe an incompatible keyed provider as eligible for the Decider", () => {
    const anthropic = { id: "anthropic", type: "anthropic-compat", env: { ANTHROPIC_API_KEY: "fixture-only" } };
    expect(listDeciderProviders([anthropic])).toEqual([]);
    expect(listDeciderProviders([masked])).toEqual([]);
  });

  it("não expõe chave e omite quem não serve", () => {
    const listed = listDeciderProviders([openai, oauth]);
    expect(listed).toEqual([{ id: "openai", label: "OpenAI", models: ["m"] }]);
    expect(JSON.stringify(listed)).not.toContain("k1");
  });
});

describe("mediaCredentials", () => {
  it("não classifica URL por substring e lê os endpoints no env", () => {
    expect(
      mediaCredentials([
        { ...openai, id: "custom", baseUrl: "https://api.openai.com.evil.invalid/v1" },
      ])
    ).toEqual({});
    expect(
      mediaCredentials([
        {
          id: "openai-1",
          type: "openai-compat",
          env: { OPENAI_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "key" },
        },
      ]).openai
    ).toEqual({ baseUrl: "https://api.openai.com/v1", apiKey: "key" });
  });
  it("separa por serviço e não confunde OpenRouter com OpenAI", () => {
    const credentials = mediaCredentials([openrouter, gemini, openai, oauth]);
    expect(credentials.openrouter?.apiKey).toBe("k4");
    expect(credentials.gemini?.apiKey).toBe("k2");
    expect(credentials.openai?.apiKey).toBe("k1");
  });
});
