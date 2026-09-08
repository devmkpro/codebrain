import { describe, it, expect, beforeEach } from "vitest";
import {
  CLAUDE_CODEX_PRESET,
  resolveSquadPreset,
  resetPresetIds,
  type PresetProvider,
} from "./squad-presets";

const claudeOauth: PresetProvider = {
  id: "claude-oauth",
  label: "Claude",
  models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7", "claude-opus-4-8"],
};
const codexOauth: PresetProvider = {
  id: "codex-oauth",
  label: "Codex",
  models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
};
const gemini: PresetProvider = {
  id: "gemini",
  label: "Google Gemini",
  models: ["gemini-3.5-flash", "gemini-3.1-pro-preview"],
};

describe("resolveSquadPreset", () => {
  beforeEach(() => resetPresetIds());

  it("puts Opus on the orchestrator and gpt-5.6-terra on the workers", () => {
    const resolved = resolveSquadPreset(CLAUDE_CODEX_PRESET, [claudeOauth, codexOauth, gemini]);
    expect(resolved).not.toBeNull();
    expect(resolved!.orchestrator).toEqual({
      providerId: "claude-oauth",
      model: "claude-opus-4-8",
    });
    expect(resolved!.workers).toHaveLength(3);
    for (const worker of resolved!.workers) {
      expect(worker.providerId).toBe("codex-oauth");
      expect(worker.model).toBe("gpt-5.6-terra");
    }
    expect(resolved!.workers.map((w) => w.role)).toEqual(["backend", "frontend", "tester"]);
    expect(resolved!.warnings).toEqual([]);
  });

  it("falls back to a matching provider and warns when Codex is absent", () => {
    const resolved = resolveSquadPreset(CLAUDE_CODEX_PRESET, [claudeOauth, gemini]);
    expect(resolved!.orchestrator.providerId).toBe("claude-oauth");
    // No codex provider: workers land on something usable rather than empty.
    expect(resolved!.workers[0].providerId).toBe("claude-oauth");
    expect(resolved!.workers[0].model).toBeTruthy();
    expect(resolved!.warnings.join(" ")).toContain("Codex");
  });

  it("warns when no Claude provider is configured", () => {
    const resolved = resolveSquadPreset(CLAUDE_CODEX_PRESET, [codexOauth]);
    expect(resolved!.orchestrator.providerId).toBe("codex-oauth");
    expect(resolved!.warnings.join(" ")).toContain("Claude");
  });

  it("returns null when nothing is configured so the caller can redirect", () => {
    expect(resolveSquadPreset(CLAUDE_CODEX_PRESET, [])).toBeNull();
    expect(resolveSquadPreset(CLAUDE_CODEX_PRESET, [{ id: "empty", models: [] }])).toBeNull();
  });

  it("gives every worker slot a distinct id", () => {
    const resolved = resolveSquadPreset(CLAUDE_CODEX_PRESET, [claudeOauth, codexOauth]);
    const ids = resolved!.workers.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
