import { describe, expect, it } from "vitest";
import { parseTokenUsage } from "./token-parser";

describe("parseTokenUsage", () => {
  it("reads Claude usage and cache fields from JSON output", () => {
    expect(
      parseTokenUsage([
        '{"message":{"model":"claude-opus-4-7","usage":{"input_tokens":15536,"output_tokens":16,"cache_read_input_tokens":1200,"cache_creation_input_tokens":300}}}',
      ])
    ).toMatchObject({
      inputTokens: 15536,
      outputTokens: 16,
      cacheReadTokens: 1200,
      cacheWriteTokens: 300,
      model: "claude-opus-4-7",
    });
  });

  it("accepts the compact worker summary as a cheap output", () => {
    expect(parseTokenUsage(["OK|parser ISO-8601 corrigido|src/date.ts"])).toBeNull();
  });

  it("reads nested Gemini headless stats and cache usage", () => {
    expect(
      parseTokenUsage([
        JSON.stringify({
          response: "ok",
          stats: { total_tokens: 123, input_tokens: 100, output_tokens: 23, cached: 17 },
        }),
      ])
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: 23,
      cacheReadTokens: 17,
      totalTokens: 123,
    });
  });
});
