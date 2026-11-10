// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, archive, snapshot, send } = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), archive: vi.fn(), snapshot: vi.fn(), send: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } }));
vi.mock("../context", () => ({ safeSend: send }));
vi.mock("../services/operations", () => ({ archiveOperation: archive, getOperationsSnapshot: snapshot }));
import { registerOperationsHandlers } from "./register-operations";

const ctx = { currentWorkspacePath: "/a", hooksManager: { on: vi.fn() }, ptyManager: { on: vi.fn() } } as any;
beforeEach(() => { handlers.clear(); vi.clearAllMocks(); registerOperationsHandlers(ctx); });

describe("operation archive IPC", () => {
  it("passes the exact selected operation to main and emits an update only after persistence", async () => {
    const args = { workspace: "/a", missionId: "m1", confirmedActive: true };
    archive.mockReturnValue({ ok: true });
    expect(await handlers.get("operations:archive")!(null, args)).toEqual({ ok: true });
    expect(archive).toHaveBeenCalledWith(ctx, args);
    expect(send).toHaveBeenCalledWith(ctx, "operations:updated", expect.objectContaining({ workspace: "/a" }));
  });

  it("does not emit a success update when active-pane confirmation is required", async () => {
    archive.mockReturnValue({ ok: false, requiresConfirmation: true, activePaneIds: ["p1"] });
    const result = await handlers.get("operations:archive")!(null, { workspace: "/a", missionId: "m1" });
    expect(result.activePaneIds).toEqual(["p1"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns persistence errors to the card without reporting success", async () => {
    archive.mockImplementation(() => { throw new Error("cannot persist"); });
    expect(await handlers.get("operations:archive")!(null, { workspace: "/a", missionId: "m1" })).toEqual({ ok: false, error: "cannot persist" });
    expect(send).not.toHaveBeenCalled();
  });
});
