// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ display: { workArea: { x: 0, y: 0, width: 1920, height: 1040 } } }));
vi.mock("electron", () => ({ app: {}, BrowserWindow: class {}, screen: Object.assign(new EventEmitter(), { getDisplayMatching: () => mocks.display }) }));
vi.mock("./auto-updater", () => ({ isUpdateInstallRequested: () => false }));
vi.mock("./platform", () => ({ is: { dev: false } }));
import { keepWindowInWorkArea } from "./window";

afterEach(() => vi.useRealTimers());
it("does not setBounds during a native Windows drag, even if output delays queued work", () => {
  vi.useFakeTimers();
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isFullScreen: () => false, isMaximized: () => false,
    getBounds: () => ({ x: -20, y: 5, width: 1280, height: 800 }), setBounds: vi.fn(),
  });
  keepWindowInWorkArea(win as any);
  win.emit("ready-to-show");
  win.emit("will-move");
  for (let i = 0; i < 100; i++) { win.emit("move"); vi.advanceTimersByTime(16); }
  expect(win.setBounds).not.toHaveBeenCalled();
  win.emit("moved"); vi.runOnlyPendingTimers();
  expect(win.setBounds).toHaveBeenCalledTimes(1);
  win.emit("closed");
});
it("still constrains a maximized frameless window above the taskbar", () => {
  vi.useFakeTimers();
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isFullScreen: () => false, isMaximized: () => true,
    getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }), setBounds: vi.fn(),
  });
  keepWindowInWorkArea(win as any);
  win.emit("maximize"); vi.runOnlyPendingTimers();
  expect(win.setBounds).toHaveBeenCalledWith(mocks.display.workArea);
  win.emit("closed");
});
