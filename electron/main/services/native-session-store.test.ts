// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NativeSessionStore, sessionScope, type SavedConversationPane } from "./native-session-store";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const fixture = (id: string, accountId = "one"): SavedConversationPane => ({
  id: "pane", agent: "codex", cwd: "/project", workspacePath: "/project", accountId,
  session: { provider: "codex", id, scopeKey: sessionScope("codex", "/project", accountId), capturedAt: 2, confidence: "high", source: "fixture" },
});
describe("native conversation persistence", () => {
  it("survives a store restart and does not merge parallel panes or accounts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-resume-")); dirs.push(dir);
    const store = new NativeSessionStore(dir);
    store.save(fixture("session-one")); store.save(fixture("session-two")); store.save(fixture("session-one", "two"));
    const restored = new NativeSessionStore(dir).list("/project");
    expect(restored).toHaveLength(3);
    expect(new Set(restored.map(row => row.id)).size).toBe(3);
    expect(new NativeSessionStore(dir).list("/other")).toEqual([]);
    const saved = store.save({ ...fixture("session-one"), env: { API_KEY: "SECRET" }, args: ["SECRET"], lastLines: ["SECRET"] } as any);
    expect(fs.readFileSync(path.join(dir, `${saved.id}.json`), "utf8")).not.toContain("SECRET");
    store.delete(saved.id, "/other"); expect(store.list()).toHaveLength(3);
    store.delete(saved.id, "/project"); expect(store.list()).toHaveLength(2);
    store.clear("/project"); expect(store.list()).toEqual([]);
  });
  it("scope changes with profile, machine context, cwd and account", () => {
    expect(sessionScope("codex", "/p", "one", { CODEX_HOME: "/a" })).not.toBe(sessionScope("codex", "/p", "one", { CODEX_HOME: "/b" }));
    expect(sessionScope("kiro", "/p")).not.toBe(sessionScope("kiro", "/q"));
  });
});
