import { describe, expect, it } from "vitest";
import { resolveSpawnTarget } from "./resolve-spawn-target";

const providers = [
  { id: "codex-oauth", type: "codex", host: "codex", models: ["gpt-5.5", "gpt-5.4-mini"] },
  { id: "claude-oauth", type: "oauth", host: "claude", models: ["claude-sonnet-4-6"] },
];

describe("resolveSpawnTarget", () => {
  it("repairs a stale Codex favorite containing a Claude model", () => {
    const target = resolveSpawnTarget({
      providerId: "codex-oauth",
      model: "claude-haiku-4-5-20251001",
      providers,
      preferredAgent: "claude",
      explicit: false,
    });

    expect(target.agent).toBe("codex");
    expect(target.model).toBe("gpt-5.5");
  });

  it("keeps a valid provider and model pair", () => {
    const target = resolveSpawnTarget({ providerId: "claude-oauth", model: "claude-sonnet-4-6", providers });
    expect(target).toMatchObject({ providerId: "claude-oauth", model: "claude-sonnet-4-6", agent: "claude" });
  });
});
