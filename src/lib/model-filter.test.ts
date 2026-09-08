import { describe, it, expect } from "vitest";
import { filterModels, filterProviders, matchesQuery } from "./model-filter";

const openRouterModels = [
  "anthropic/claude-opus-4",
  "anthropic/claude-opus-4.7-fast",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "meta-llama/llama-4-maverick",
  "accounts/fireworks/models/kimi-k2-instruct",
  "x-ai/grok-4.3",
];

describe("matchesQuery", () => {
  it("ignores separator style so hyphens, slashes and dots all match", () => {
    expect(matchesQuery("claude opus 4", "anthropic/claude-opus-4")).toBe(true);
    expect(matchesQuery("claude-opus", "anthropic/claude-opus-4")).toBe(true);
    expect(matchesQuery("gpt 5.6", "gpt-5.6-terra")).toBe(true);
  });

  it("matches terms in any order and requires all of them", () => {
    expect(matchesQuery("opus anthropic", "anthropic/claude-opus-4")).toBe(true);
    expect(matchesQuery("opus gemini", "anthropic/claude-opus-4")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesQuery("", "anything")).toBe(true);
    expect(matchesQuery("   ", "anything")).toBe(true);
  });

  it("searches across every field it is given", () => {
    expect(matchesQuery("openrouter opus", "OpenRouter", "anthropic/claude-opus-4")).toBe(true);
  });
});

describe("filterModels", () => {
  it("narrows a large catalogue", () => {
    expect(filterModels(openRouterModels, "opus")).toEqual([
      "anthropic/claude-opus-4",
      "anthropic/claude-opus-4.7-fast",
    ]);
  });

  it("returns everything when the query is empty", () => {
    expect(filterModels(openRouterModels, "")).toHaveLength(openRouterModels.length);
  });

  it("returns nothing when there is no match", () => {
    expect(filterModels(openRouterModels, "mistral")).toEqual([]);
  });
});

describe("filterProviders", () => {
  const providers = [
    { id: "openrouter", label: "OpenRouter", host: "openclaude", models: openRouterModels },
    { id: "codex-oauth", label: "Codex", host: "codex", models: ["gpt-5.6-terra"] },
    { id: "empty", label: "Sem modelos", host: "openclaude", models: [] },
  ];

  it("matches on the provider name", () => {
    expect(filterProviders(providers, "codex").map((p) => p.id)).toEqual(["codex-oauth"]);
  });

  it("matches a provider by a model it carries", () => {
    expect(filterProviders(providers, "kimi").map((p) => p.id)).toEqual(["openrouter"]);
    expect(filterProviders(providers, "terra").map((p) => p.id)).toEqual(["codex-oauth"]);
  });

  it("returns everything when the query is empty", () => {
    expect(filterProviders(providers, "")).toHaveLength(3);
  });
});
