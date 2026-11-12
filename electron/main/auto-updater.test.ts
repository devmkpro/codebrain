// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  quitAndInstall: vi.fn(),
  send: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) },
}));
vi.mock("electron-updater", () => ({
  autoUpdater: Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn().mockResolvedValue(null),
    quitAndInstall: mocks.quitAndInstall,
  }),
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks(); mocks.handlers.clear(); });
afterEach(() => vi.useRealTimers());

it("clears the install request on asynchronous installer failure so restart can be retried", async () => {
  const { setupAutoUpdater, isUpdateInstallRequested } = await import("./auto-updater");
  const { autoUpdater } = await import("electron-updater");
  setupAutoUpdater({ webContents: { send: mocks.send } } as any);
  await mocks.handlers.get("update:install")!();
  await vi.advanceTimersByTimeAsync(200);
  expect(isUpdateInstallRequested()).toBe(true);
  autoUpdater.emit("error", new Error("installer could not start"));
  expect(isUpdateInstallRequested()).toBe(false);
});

it("catches installer exceptions in the scheduled call and reports them to the renderer", async () => {
  const { setupAutoUpdater, isUpdateInstallRequested } = await import("./auto-updater");
  mocks.quitAndInstall.mockImplementationOnce(() => { throw new Error("installer failed"); });
  setupAutoUpdater({ webContents: { send: mocks.send } } as any);
  await mocks.handlers.get("update:install")!();
  await vi.advanceTimersByTimeAsync(200);
  expect(isUpdateInstallRequested()).toBe(false);
  expect(mocks.send).toHaveBeenCalledWith("update:error", { message: "installer failed" });
});

it("prepares shutdown once before starting the installer even if IPC is repeated", async () => {
  const { setupAutoUpdater } = await import("./auto-updater");
  let finish!: () => void;
  const prepare = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  setupAutoUpdater({ webContents: { send: mocks.send } } as any, prepare);
  const first = mocks.handlers.get("update:install")!();
  await mocks.handlers.get("update:install")!();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  finish(); await first;
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
});
