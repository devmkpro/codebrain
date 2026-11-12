// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: mocks.execFile,
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); mocks.execFile.mockReset(); });

it("awaits Windows process tree termination before closing native PTY handles", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const { PtyManager } = await import("./pty-manager");
  const manager = Object.create(PtyManager.prototype);
  const closeHandles = vi.fn();
  Object.assign(manager, { panes: new Map([["cli", {}]]), getPid: () => 123456, killAll: closeHandles });
  let terminated!: () => void;
  mocks.execFile.mockImplementation((_exe, _args, _opts, callback) => { terminated = () => callback(null); });
  const stopping = manager.killAllForUpdate();
  expect(mocks.execFile).toHaveBeenCalledWith(expect.stringMatching(/taskkill.exe$/), ["/PID", "123456", "/T", "/F"],
    { windowsHide: true, timeout: 3000 }, expect.any(Function));
  expect(closeHandles).not.toHaveBeenCalled();
  terminated(); await stopping;
  expect(closeHandles).toHaveBeenCalledOnce();
});

it("never targets the app process or invalid PIDs", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const { PtyManager } = await import("./pty-manager");
  const manager = Object.create(PtyManager.prototype);
  Object.assign(manager, { panes: new Map([["self", {}], ["invalid", {}]]),
    getPid: (id: string) => id === "self" ? process.pid : -1, killAll: vi.fn() });
  await manager.killAllForUpdate();
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(manager.killAll).toHaveBeenCalledOnce();
});

it("uses normal PTY shutdown outside Windows", async () => {
  vi.stubGlobal("process", { ...process, platform: "linux" });
  const { PtyManager } = await import("./pty-manager");
  const manager = Object.create(PtyManager.prototype);
  Object.assign(manager, { killAll: vi.fn() });
  await manager.killAllForUpdate();
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(manager.killAll).toHaveBeenCalledOnce();
});
