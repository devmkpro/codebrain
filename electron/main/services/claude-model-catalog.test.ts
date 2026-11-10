// @vitest-environment node
import { expect, it } from "vitest";
import { claudeCatalogArgs, parseClaudeModelInfo } from "./claude-model-catalog";

it("uses resolved IDs supplied by the CLI instead of guessing from labels or keeping aliases", () => {
  expect(parseClaudeModelInfo([
    { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
    { value: "opus", resolvedModel: "claude-opus-5", displayName: "Opus 5" },
    { value: "claude-opus-4-8", displayName: "Opus 4.8" },
    { value: "fable", displayName: "Fable 5.1" },
    { value: "sonnet", displayName: "Custom model" },
  ])).toEqual(["claude-sonnet-5", "claude-opus-5", "claude-opus-4-8"]);
});
it("gates every flag by installed help and never sends a generative user message", () => {
  expect(() => claudeCatalogArgs("--model <model>")).toThrow();
  const help = "--print --input-format --output-format --verbose --strict-mcp-config --mcp-config --settings --setting-sources --no-session-persistence";
  const args = claudeCatalogArgs(help);
  expect(args).toContain("--no-session-persistence");
  expect(args).toContain("--strict-mcp-config");
  expect(args).toContain('{"disableAllHooks":true}');
  expect(args).not.toContain("--model");
});
