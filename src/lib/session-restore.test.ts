import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicRestore, type SessionSnapshot } from "./session-restore";

afterEach(() => vi.unstubAllGlobals());

describe("restauração de panes", () => {
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
