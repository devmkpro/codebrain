import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicRestore, type SessionSnapshot } from "./session-restore";

afterEach(() => vi.unstubAllGlobals());

describe("restauração de panes", () => {
  it("resumes the exact native session without a synthetic prompt", async () => {
    const spawn = vi.fn(async (_config: any) => ({ ok: true, paneId: "new" }));
    vi.stubGlobal("window", { codeBrainApp: { pty: { list: async () => [], spawn } } });
    const session = { provider: "kiro", id: "exact-session", capturedAt: 1, confidence: "high" as const, source: "fixture" };
    const result = await deterministicRestore({ id: "s", workspacePath: "/project", savedAt: 1,
      panes: [{ id: "old", agent: "kiro", cwd: "/project", accountId: "one", session, lastLines: ["not full context"] }] }, vi.fn());
    expect(result).toEqual({ restored: 1, skipped: 0, errors: [] });
    expect(spawn.mock.calls[0][0]).toMatchObject({ session, accountId: "one", cwd: "/project" });
    expect(spawn.mock.calls[0][0]).not.toHaveProperty("sessionContext");
    expect(spawn.mock.calls[0][0]).not.toHaveProperty("initialPrompt");
  });
  it("does not silently open a fresh session for a legacy preview", async () => {
    const spawn = vi.fn();
    vi.stubGlobal("window", { codeBrainApp: { pty: { list: async () => [], spawn } } });
    const result = await deterministicRestore({ id: "s", workspacePath: "/project", savedAt: 1,
      panes: [{ id: "old", agent: "kiro", cwd: "/project", lastLines: ["preview"] }] }, vi.fn());
    expect(result.restored).toBe(0); expect(result.errors[0]).toContain("sem ID nativo"); expect(spawn).not.toHaveBeenCalled();
  });
  it.each([
    [{ paneId: "live" }],
    { ok: true, panes: [{ paneId: "live" }] },
  ])("aceita lista e envelope IPC sem duplicar processo vivo: %j", async (response) => {
    const spawn = vi.fn(async () => ({ ok: true, paneId: "new" }));
    vi.stubGlobal("window", { codeBrainApp: { pty: { list: async () => response, spawn } } });
    const snapshot: SessionSnapshot = {
      id: "snapshot", workspacePath: "/project", savedAt: 1,
      panes: [{ id: "live", agent: "kiro", cwd: "/project", role: "worker" }],
    };
    const addPane = vi.fn();
    expect(await deterministicRestore(snapshot, addPane)).toEqual({ restored: 0, skipped: 1, errors: [] });
    expect(spawn).not.toHaveBeenCalled();
    expect(addPane).not.toHaveBeenCalled();
  });
});
