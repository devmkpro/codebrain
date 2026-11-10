import { describe, expect, it } from "vitest";
import { resolveProvider } from "./provider-resolver";

function context(providers: any[] = []): any {
  return {
    providerStore: { listFull: () => providers },
    cliDetector: { getAll: () => ({ codex: { found: true }, claude: { found: true } }) },
    configStore: { get: () => ({}) },
    paneConfigs: new Map(),
    paneRegistry: new Map(),
  };
}

describe("provider resolver compatibility", () => {
  const kiroCatalog = { id: "kiro-cli", type: "cli", host: "kiro", models: ["gpt-5.6-luna", "claude-opus-5.5", "auto"] };

  it("rejects a foreign provider on an explicitly requested Kiro harness", () => {
    const result = resolveProvider(context([kiroCatalog]), { agent: "kiro", providerId: "codex-oauth", model: "gpt-5.6-luna" });
    expect(result.agent).toBe("kiro");
    expect(result.error).toMatch(/provider.*kiro/i);
  });

  it("rejects models outside Kiro's local catalog before spawning", () => {
    const result = resolveProvider(context([kiroCatalog]), { agent: "kiro", providerId: "kiro-cli", model: "gpt-6.1-sol" });
    expect(result.error).toMatch(/kiro catalog/i);
  });

  it("accepts GPT models actually listed by Kiro instead of guessing from prefixes", () => {
    const result = resolveProvider(context([kiroCatalog]), { agent: "kiro", providerId: "kiro-cli", model: "gpt-5.6-luna" });
    expect(result).toMatchObject({ agent: "kiro", provider: null, providerId: null, model: "gpt-5.6-luna" });
    expect(result.error).toBeUndefined();
  });

  it("leaves Kiro's own default in charge when no model was requested", () => {
    const ctx = context([kiroCatalog]);
    ctx.paneConfigs.set("previous", { agent: "codex", providerId: "codex-oauth", model: "gpt-6.1-sol" });
    ctx.paneRegistry.set("previous", { spawnedAt: Date.now() });
    expect(resolveProvider(ctx, { agent: "kiro" })).toMatchObject({ agent: "kiro", model: undefined });
  });

  it("validates a cloned Kiro pane against its own catalog too", () => {
    const ctx = context([kiroCatalog]);
    ctx.paneConfigs.set("previous", { agent: "kiro", model: "gpt-6.1-sol" });
    ctx.paneRegistry.set("previous", { spawnedAt: Date.now() });
    expect(resolveProvider(ctx, {}).error).toMatch(/kiro catalog/i);
  });

  it.each([
    ["claude", "claude-oauth"], ["codex", "codex-oauth"], ["gemini-cli", "gemini-cli"],
    ["kimi", "kimi"], ["cursor", "cursor"], ["copilot", "copilot"],
  ])("uses the refreshed %s catalog for defaults and validation", (agent, providerId) => {
    const ctx = context([{ id: providerId, host: agent, models: ["release-99.10", "release-99.9"], modelsMode: "manual" }]);
    const selected = resolveProvider(ctx, { agent, providerId, model: "release-99.9" });
    expect(selected.model).toBe("release-99.9");
    expect(selected.agent).toBe(agent);
    expect(resolveProvider(ctx, { agent, providerId }).model).toBe("release-99.10");
    expect(resolveProvider(ctx, { agent, providerId, model: "retired-model" }).model).toBe("release-99.10");
    expect(ctx.providerStore.listFull()[0].models).toEqual(["release-99.10", "release-99.9"]);
  });

  it("rejects a foreign provider before starting a registry harness", () => {
    const ctx = context([{ id: "codex-oauth", host: "codex", models: ["gpt-5.6-luna"] }]);
    const result = resolveProvider(ctx, { agent: "kiro", providerId: "codex-oauth", model: "gpt-5.6-luna" });
    expect(result.agent).toBe("kiro");
    expect(result.error).toMatch(/provider.*codex-oauth.*kiro/i);
  });

  it("rejects stale models against the harness's saved catalog without choosing model zero", () => {
    const ctx = context([{ id: "kiro", host: "kiro", models: ["auto", "claude-sonnet-4.6"] }]);
    const result = resolveProvider(ctx, { agent: "kiro", providerId: "kiro", model: "gpt-5.6-luna" });
    expect(result.error).toMatch(/model.*gpt-5.6-luna.*kiro/i);
    expect(resolveProvider(ctx, { agent: "kiro", providerId: "kiro", model: "claude-sonnet-4.6" }).error).toBeUndefined();
  });

  it.each([
    ["claude", "claude-oauth"], ["kimi", "kimi"], ["cursor", "cursor"], ["copilot", "copilot"],
  ])("pins explicit %s requests without borrowing an unrelated provider", (agent, providerId) => {
    const ctx = context([{ id: "foreign", type: "anthropic-compat", host: "openclaude", models: ["foreign"] }]);
    ctx.paneConfigs.set("previous", { agent: "codex", providerId: "codex-oauth", model: "gpt-5" });
    ctx.paneRegistry.set("previous", { spawnedAt: Date.now() });
    expect(resolveProvider(ctx, { agent })).toMatchObject({ agent, providerId });
  });
  it("never sends a Claude model to Codex OAuth", () => {
    const result = resolveProvider(context(), {
      agent: "codex",
      providerId: "codex-oauth",
      model: "claude-haiku-4-5-20251001",
    });

    expect(result.agent).toBe("codex");
    expect(result.providerId).toBe("codex-oauth");
    expect(result.model).not.toContain("claude");
    expect(result.provider.models).toContain(result.model);
  });

  it("keeps the requested native CLI when another provider supports the incompatible model", () => {
    const anthropic = { id: "anthropic", type: "anthropic-compat", host: "claude", models: ["claude-sonnet-4-6"] };
    const result = resolveProvider(context([anthropic]), {
      agent: "codex",
      providerId: "codex-oauth",
      model: "claude-sonnet-4-6",
    });

    expect(result.providerId).toBe("codex-oauth");
    expect(result.agent).toBe("codex");
    expect(result.model).not.toContain("claude");
  });

  it("does not inherit Claude when Codex is requested without provider or model", () => {
    const ctx = context();
    ctx.paneConfigs.set("previous", {
      agent: "claude",
      providerId: "claude-oauth",
      model: "claude-haiku-4-5-20251001",
    });
    ctx.paneRegistry.set("previous", { spawnedAt: Date.now() });

    const result = resolveProvider(ctx, { agent: "codex" });

    expect(result.agent).toBe("codex");
    expect(result.providerId).toBe("codex-oauth");
    expect(result.model).not.toContain("claude");
  });

  it("keeps a refreshed Claude OAuth model on the Claude Code CLI", () => {
    const result = resolveProvider(context([{
      id: "claude-oauth",
      type: "oauth",
      host: "claude",
      models: ["claude-opus-5"],
    }, {
      id: "anthropic-legacy",
      type: "anthropic-compat",
      host: "openclaude",
      models: ["claude-opus-5"],
    }]), {
      agent: "claude",
      providerId: "claude-oauth",
      model: "claude-opus-5",
    });

    expect(result.providerId).toBe("claude-oauth");
    expect(result.agent).toBe("claude");
    expect(result.model).toBe("claude-opus-5");
  });

  it("does not turn a registry harness into Claude because of its model", () => {
    const oauth = { id: "claude-oauth", type: "oauth", host: "claude", models: ["claude-sonnet-5.5"] };
    const result = resolveProvider(context([oauth]), { agent: "kiro", model: "claude-sonnet-5.5" });

    expect(result).toMatchObject({ agent: "kiro", provider: null, providerId: null, model: "claude-sonnet-5.5" });
  });

  it("does not inherit another pane's provider into a registry harness", () => {
    const ctx = context([{ id: "claude-oauth", type: "oauth", host: "claude", models: ["claude-opus-5"] }]);
    ctx.paneConfigs.set("previous", { agent: "claude", providerId: "claude-oauth", model: "claude-opus-5" });
    ctx.paneRegistry.set("previous", { spawnedAt: Date.now() });

    expect(resolveProvider(ctx, { agent: "grok" })).toMatchObject({ agent: "grok", provider: null, providerId: null });
  });

  it("keeps a cloned registry harness pane on its own CLI", () => {
    const ctx = context([{ id: "claude-oauth", type: "oauth", host: "claude", models: ["claude-opus-5"] }]);
    ctx.paneConfigs.set("previous", { agent: "kiro", model: "claude-opus-5.5" });
    ctx.paneRegistry.set("previous", { spawnedAt: Date.now() });

    expect(resolveProvider(ctx, {})).toMatchObject({ agent: "kiro", provider: null, providerId: null, model: "claude-opus-5.5" });
  });
});
