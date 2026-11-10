// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleDetector } from "./idle-detector";
import { OutputBuffer } from "./output-buffer";

let detector: IdleDetector;
let buffer: OutputBuffer;
beforeEach(() => { vi.useFakeTimers(); detector = new IdleDetector(); buffer = new OutputBuffer(); });
afterEach(() => { detector.cancelAll(); vi.useRealTimers(); });

function output(data: string) { buffer.push(data); detector.activity("codex", buffer); }

describe("TUI-aware idle detection", () => {
  it("does not emit idle after quiet output while Codex still shows Working", async () => {
    const idle = vi.fn();
    detector.on("idle", idle);
    output("\x1b[1mWorking\x1b[0m (1m 35s • esc to interrupt)\r\n\r\n› Ask Codex to do anything");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(idle).not.toHaveBeenCalled();
  });

  it("includes the partial current TUI line instead of only newline-terminated history", async () => {
    const idle = vi.fn();
    detector.on("idle", idle);
    output("⠹ Working…");
    await vi.advanceTimersByTimeAsync(3500);
    expect(idle).not.toHaveBeenCalled();
  });

  it("returns to idle after ANSI clears the spinner and redraws the actual prompt", async () => {
    const idle = vi.fn();
    detector.on("idle", idle);
    output("Working (1m 35s • esc to interrupt)\r\n› Ask Codex to do anything");
    await vi.advanceTimersByTimeAsync(4000);
    expect(idle).not.toHaveBeenCalled();
    output("\x1b[1A\r\x1b[2K\x1b[1B\r› Ask Codex to do anything");
    await vi.advanceTimersByTimeAsync(3000);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("does not keep a completed turn active just because Working remains in history", async () => {
    const idle = vi.fn();
    detector.on("idle", idle);
    output("Working (1s • esc to interrupt)\r\n─ Worked for 2s ─\r\n› Ask Codex to do anything");
    await vi.advanceTimersByTimeAsync(3000);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary quiet shell output idle and cancels timers on exit", async () => {
    const idle = vi.fn();
    detector.on("idle", idle);
    output("build finished\r\n$ ");
    await vi.advanceTimersByTimeAsync(3000);
    expect(idle).toHaveBeenCalledOnce();
    output("more\r\n");
    detector.cancel("codex");
    await vi.advanceTimersByTimeAsync(3000);
    expect(idle).toHaveBeenCalledOnce();
  });
});
