// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "./store.js";
import { loadDatabase } from "./sqlite.js";

const WS = "D:/repo";
const Database = loadDatabase();

describe.each(["fts", "fallback"])("memory search using real SQLite :memory: (%s)", (mode) => {
  let store;
  const write = (key, content = "shared context", extra = {}) => {
    const result = store.write({ key, content, type: "semantic", workspace: WS, ...extra });
    expect(result.ok).toBe(true);
    return result.id;
  };
  beforeEach(() => {
    // Disable only the feature probe; every search still runs on real SQLite.
    const prepare = Database.prototype.prepare;
    const spy = mode === "fallback" ? vi.spyOn(Database.prototype, "prepare").mockImplementation(function(sql) {
      if (sql === "SELECT * FROM memory_fts LIMIT 0") throw new Error("FTS unavailable in this test");
      return prepare.call(this, sql);
    }) : null;
    try { store = createMemoryStore(":memory:"); } finally { spy?.mockRestore(); }
  });
  afterEach(() => store?.close());

  it("returns the exact brief key first despite a stronger repeated body match", () => {
    const exact = write("ui-redesign-brief-2026", "The requested brief.");
    write("other", "ui redesign brief 2026 ".repeat(40));
    const result = store.search({ query: "ui-redesign-brief-2026", workspace: WS, include_auto: true, limit: 1 });
    expect(result.ok).toBe(true);
    expect(result.memories.map((row) => row.id)).toEqual([exact]);
  });

  it("requires all whole terms instead of OR matches and keeps ordinary working memories", () => {
    const expected = write("design-plan", "A UI redesign brief", { type: "working" });
    write("only-ui", "UI button changed");
    write("only-redesign", "redesign deployment");
    write("substring", "build redesign");
    expect(store.search({ query: "ui redesign", workspace: WS }).memories.map((row) => row.id)).toEqual([expected]);
  });

  it("filters automatic hooks without deleting them or excluding explicit background file-change searches", () => {
    const brief = write("ui-redesign-brief-2026", "UI redesign brief");
    const file = write("file-changed-src/ui.tsx", "UI redesign brief", { type: "working", tags: ["file-change", "auto"] });
    write("hook-session_started-agent", "UI redesign brief", { type: "episodic", tags: ["hook", "agent-lifecycle"] });
    const count = store.list({ workspace: WS }).count;
    expect(store.search({ query: "ui redesign", workspace: WS }).memories.map((row) => row.id)).toEqual([brief]);
    expect(store.search({ query: "ui redesign", workspace: WS, include_auto: true }).count).toBe(3);
    expect(store.search({ query: "file-changed", workspace: WS }).memories.map((row) => row.id)).toEqual([file]);
    expect(store.search({ query: "file-changed-src/ui.tsx", workspace: WS }).memories[0].id).toBe(file);
    expect(store.search({ query: "file-changed", workspace: WS, include_auto: false }).count).toBe(0);
    expect(store.list({ workspace: WS }).count).toBe(count);
    expect(store.read({ id: file }).ok).toBe(true);
  });

  it("applies exact tag intersection/exclusion before the limit and preserves scope/type/workspace", () => {
    write("design-plan", "UI redesign", { tags: ["brief", "frontend"] });
    const kept = write("chosen", "UI redesign", { type: "procedural", tags: ["brief", "frontend"], scope: "local" });
    write("wrong-workspace", "UI redesign", { workspace: "D:/other", type: "procedural", tags: ["brief", "frontend"], scope: "local" });
    write("blocked", "UI redesign", { type: "procedural", tags: ["brief", "frontend", "obsolete"], scope: "local" });
    write("partial-tags", "UI redesign", { type: "procedural", tags: ["briefing", "frontend"], scope: "local" });
    expect(store.search({ query: "UI redesign", tags: ["not-present"] }).count).toBe(0);
    expect(store.search({ query: "UI redesign", exclude_tags: ["frontend"] }).count).toBe(0);
    expect(store.search({ query: "UI redesign", workspace: WS, type: "procedural", scope: "local", tags: ["brief", "frontend"], exclude_tags: ["obsolete"], limit: 1 }).memories.map((row) => row.id)).toEqual([kept]);
  });

  it("never broadens an exact-key hit past workspace, scope or type filters", () => {
    write("private-brief", "UI redesign", { workspace: "D:/private", scope: "local", type: "procedural" });
    expect(store.search({ query: "private-brief", workspace: WS }).count).toBe(0);
    expect(store.search({ query: "private-brief", scope: "project" }).count).toBe(0);
    expect(store.search({ query: "private-brief", type: "working" }).count).toBe(0);
  });

  it("matches Unicode terms without letting partial English tokens through", () => {
    const expected = write("international", "ação 東京");
    write("unrelated", "compilação 東京");
    expect(store.search({ query: "ação 東京" }).memories.map((row) => row.id)).toEqual([expected]);
  });

  it("treats punctuation and query syntax as literal data and validates tag arrays", () => {
    const exact = write("###", "punctuation key", { tags: ["x' OR 1=1 --"] });
    expect(store.search({ query: "###", tags: ["x' OR 1=1 --"] }).memories[0]?.id).toBe(exact);
    expect(store.search({ query: "   " }).ok).toBe(false);
    expect(store.search({ query: "design", tags: "brief" }).ok).toBe(false);
  });

  it("bounds oversized, negative and non-finite result limits", () => {
    for (let i = 0; i < 105; i++) write(`bounded-${i}`, "bounded query");
    expect(store.search({ query: "bounded", limit: 10000 }).count).toBe(100);
    expect(store.search({ query: "bounded", limit: -1 }).count).toBe(1);
    expect(store.search({ query: "bounded", limit: NaN }).count).toBe(20);
  });
});

it("a real FTS query failure uses the same filtered token fallback", () => {
  const store = createMemoryStore(":memory:");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    store.write({ key: "brief", content: "UI redesign", tags: ["brief"], type: "semantic", workspace: WS });
    store.write({ key: "hook-hidden", content: "UI redesign", tags: ["hook", "brief"], type: "episodic", workspace: WS });
    // Exercise SQL error recovery rather than mocking a search return value.
    store.db.exec("DROP TABLE memory_fts");
    expect(store.search({ query: "UI redesign", tags: ["brief"], workspace: WS }).memories.map((row) => row.key)).toEqual(["brief"]);
    expect(warn).toHaveBeenCalled();
  } finally { warn.mockRestore(); store.close(); }
});
