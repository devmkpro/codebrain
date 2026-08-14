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
});
