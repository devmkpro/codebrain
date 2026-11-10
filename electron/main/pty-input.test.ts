// @vitest-environment node
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PtyInputQueue } from "./pty-input";

afterEach(() => vi.useRealTimers());

describe("ordered PTY input", () => {
  it("serializes large pastes and submit into complete non-interleaved transactions", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const queue = new PtyInputQueue(write);
    const first = `\x1b[200~${"😀".repeat(3000)}\x1b[201~`;
    const second = "\x1b[200~second\x1b[201~";
    queue.enqueue(first, 150);
    queue.enqueue("\r");
    queue.enqueue(second, 150);
    queue.enqueue("\r");
    await vi.runAllTimersAsync();
    expect(write.mock.calls.map(([chunk]) => chunk).join("")).toBe(first + "\r" + second + "\r");
    expect(write.mock.calls.every(([chunk]) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
  });

  it("cancels delayed input when a terminal exits", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const queue = new PtyInputQueue(write);
    queue.enqueue("x".repeat(5000));
    queue.enqueue("\r");
    queue.cancel();
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports native write failures instead of accepting further input silently", () => {
    const error = new Error("closed pipe");
    const queue = new PtyInputQueue(() => { throw error; });
    expect(() => queue.enqueue("message")).toThrow(error);
    expect(() => queue.enqueue("next")).toThrow(error);
  });

  it("reports asynchronous failures without crashing a delayed paste callback", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("closed pipe"); });
    const onError = vi.fn();
    const queue = new PtyInputQueue(write, onError);
    queue.enqueue("x".repeat(5000));
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "closed pipe" }));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("acknowledges Enter only after its native write, and rejects a canceled receipt", async () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const queue = new PtyInputQueue(write);
    queue.enqueue("paste", 150);
    const acknowledged = vi.fn();
    const receipt = queue.enqueueAndWait("\r").then(acknowledged);
    await vi.advanceTimersByTimeAsync(149);
    expect(acknowledged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await receipt;
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(write.mock.calls.map(([text]) => text).join("")).toBe("paste\r");

    queue.enqueue("next paste", 150);
    const canceled = queue.enqueueAndWait("\r").catch((error) => error);
    queue.cancel();
    expect(await canceled).toBeInstanceOf(Error);
    await vi.runAllTimersAsync();
    expect(write.mock.calls.map(([text]) => text).join("")).toBe("paste\rnext paste");
  });

  it("provides an offline TUI fixture that accepts bracketed multiline messages only on Enter", () => {
    const output = execFileSync(process.execPath, [path.resolve("electron/main/__fixtures__/tui-transport.cjs")], {
      input: "\x1b[200~[MESSAGE] first\nsecond\x1b[201~\r\x1b[200~next\x1b[201~\r", encoding: "utf-8", timeout: 5000,
    });
    expect(output).toContain("Paste received; waiting for Enter.");
    expect(output).toContain("[MESSAGE] first second");
    expect(output).toContain("Submitted message 2.");
    expect(output).toContain("STATUS cols=80 rows=24 received=2");
  });

  it("provides an offline Working-to-prompt demo for browser/sidebar validation", () => {
    const output = execFileSync(process.execPath, [path.resolve("electron/main/__fixtures__/tui-transport.cjs"), "--status-demo=5"], {
      input: "", encoding: "utf-8", timeout: 5000,
    });
    expect(output).toContain("Working (1m 35s • esc to interrupt)");
    expect(output).toContain("› Ask Codex to do anything");
    expect(output).toContain("─ Worked for 6s ─");
  });
});
