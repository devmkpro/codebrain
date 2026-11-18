// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CliDecider } from "../cli-decider";
import type { HarnessProvider } from "../harness-providers";
import { listSummarizerOptions, summarize } from "./summarizer";

const cli = (claude = true): CliDecider => ({
  listProviders: vi.fn().mockResolvedValue(claude ? [{ id: "cli:claude", label: "Claude · login existente", models: ["opus"], transport: "cli", cli: "claude", authentication: "existing-login" }] : []),
  run: vi.fn(),
  complete: vi.fn().mockResolvedValue("{}"),
});

const providers: HarnessProvider[] = [
  { id: "claude-oauth", type: "oauth", env: {} },
  { id: "codex-oauth", type: "codex", env: {}, models: ["gpt-5.5"] },
  { id: "openai", label: "OpenAI", type: "openai-compat", baseUrl: "https://api.openai.com/v1", env: { OPENAI_API_KEY: "k1" }, models: ["gpt-x"] },
  { id: "anthropic", label: "Anthropic", type: "anthropic-compat", baseUrl: "https://api.anthropic.com", env: { ANTHROPIC_API_KEY: "k2" }, models: ["claude-y"] },
  { id: "mimo-claude", label: "MiMo", type: "anthropic-compat", baseUrl: "https://m/anthropic", env: { ANTHROPIC_AUTH_TOKEN: "k3" }, models: ["mimo"] },
  { id: "deepseek", label: "DeepSeek", type: "openai-compat", baseUrl: "https://api.deepseek.com/v1", env: {}, models: ["ds"] },
];

describe("listSummarizerOptions", () => {
  it("lista CLIs detectadas e todos os providers, marcando os indisponíveis", async () => {
    const options = await listSummarizerOptions({
      providers: [...providers, { id: "antigravity-cli", type: "cli", env: {} }],
      cli: cli(),
      clis: { claude: { found: true }, codex: { found: true, path: process.platform === "win32" ? "C:\\x\\codex.exe" : "/usr/bin/codex" }, antigravity: { found: true }, gemini: { found: true } },
    });
    const byId = Object.fromEntries(options.map((option) => [option.id, option]));
    expect(byId["cli:claude"].available).toBe(true);
    expect(byId["cli:codex"]).toMatchObject({ available: true, models: ["gpt-5.5"] });
    expect(byId["cli:antigravity"]).toMatchObject({ label: "Antigravity CLI", available: false });
    expect(byId["antigravity-cli"]).toBeUndefined();
    expect(byId["cli:gemini"]).toMatchObject({ available: false });
    expect(byId.openai.available).toBe(true);
    expect(byId.anthropic.available).toBe(true);
    expect(byId["mimo-claude"].available).toBe(true);
    expect(byId.deepseek).toMatchObject({ available: false, reason: "sem chave ou URL configurada" });
    expect(byId["claude-oauth"]).toBeUndefined();
  });

  it("mostra o Claude como indisponível quando instalado sem isolamento", async () => {
    const options = await listSummarizerOptions({ providers: [], cli: cli(false), clis: { claude: { found: true } } });
    expect(options).toEqual([expect.objectContaining({ id: "cli:claude", available: false })]);
  });
});

describe("summarize via Anthropic Messages", () => {
  it("usa x-api-key para ANTHROPIC_API_KEY e Bearer para token de gateway", async () => {
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"headline\":\"ok\"}" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const base = { providers, cli: cli(), clis: {}, systemPrompt: "sys", input: "dados", fetchFn };
    expect(await summarize({ ...base, providerId: "anthropic", model: "claude-y" })).toBe("{\"headline\":\"ok\"}");
    await summarize({ ...base, providerId: "mimo-claude", model: "mimo" });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("k2");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body.system).toBe("sys");
    expect(calls[1].url).toBe("https://m/anthropic/v1/messages");
    expect(calls[1].headers.Authorization).toBe("Bearer k3");
  });

  it("recusa CLI sem modo isolado", async () => {
    await expect(summarize({ providers, cli: cli(), clis: {}, providerId: "cli:gemini", model: "x", systemPrompt: "s", input: "i" })).rejects.toThrow(/isolado/);
  });
});
