import { describe, expect, it } from "vitest";
import { sortModelIds } from "./model-catalog-order";

describe("model catalog recency", () => {
  it("does not promote a dated old Claude release above newer versioned models", () => {
    expect(sortModelIds(["claude-haiku-4-5-20251001", "claude-opus-5-5", "claude-sonnet-5", "claude-opus-4-8"]))
      .toEqual(["claude-opus-5-5", "claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"]);
  });
  it("compares semantic numbers, not strings", () => {
    expect(sortModelIds(["gpt-5.9", "gpt-5.10", "gpt-6", "gpt-5.10.2"])).toEqual([
      "gpt-6",
      "gpt-5.10.2",
      "gpt-5.10",
      "gpt-5.9",
    ]);
  });
  it("uses source timestamps in seconds, milliseconds and ISO dates", () => {
    expect(
      sortModelIds(
        ["gpt-9", "model-b", "model-c", "model-a"],
        [
          { id: "model-a", created: 1_780_000_000 },
          { id: "model-b", created_at: 1_790_000_000_000 },
          { id: "model-c", release_date: "2026-11-09" },
        ]
      )
    ).toEqual(["model-c", "model-b", "model-a", "gpt-9"]);
  });
  it("recognizes release dates in dated model IDs", () => {
    expect(sortModelIds(["claude-20250901", "claude-20261001", "gpt-5.10"])).toEqual([
      "claude-20261001",
      "claude-20250901",
      "gpt-5.10",
    ]);
  });
  it("keeps aliases stable at the end, preserves manual contents and does not mutate inputs", () => {
    const manual = ["auto", "gpt-5.9", "opus", "gpt-5.10", "custom", "default"];
    const before = [...manual];
    const sorted = sortModelIds(manual);
    expect(sorted).toEqual(["gpt-5.10", "gpt-5.9", "auto", "opus", "custom", "default"]);
    expect(new Set(sorted)).toEqual(new Set(manual));
    expect(manual).toEqual(before);
  });
  it("ignores invalid metadata without inventing a release date", () => {
    expect(
      sortModelIds(["auto", "gpt-5.9", "gpt-5.10"], [{ id: "auto", created_at: "yesterday" }])
    ).toEqual(["gpt-5.10", "gpt-5.9", "auto"]);
  });
  it("generic aliases are never dated releases even when their catalog row has a creation date", () => {
    expect(
      sortModelIds(
        ["auto", "gpt-5.10", "opus"],
        [
          { id: "auto", created_at: "2026-11-09" },
          { id: "opus", date: "2026-11-10" },
        ]
      )
    ).toEqual(["gpt-5.10", "auto", "opus"]);
  });
});
