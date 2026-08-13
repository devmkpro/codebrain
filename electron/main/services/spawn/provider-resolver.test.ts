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

  it("uses the provider host after correcting an incompatible provider", () => {
    const anthropic = { id: "anthropic", type: "anthropic-compat", host: "claude", models: ["claude-sonnet-4-6"] };
    const result = resolveProvider(context([anthropic]), {
      agent: "codex",
      providerId: "codex-oauth",
      model: "claude-sonnet-4-6",
    });

    expect(result.providerId).toBe("anthropic");
    expect(result.agent).toBe("claude");
    expect(result.model).toBe("claude-sonnet-4-6");
  });
});
