// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForTerminalReady } from "./terminal-prompt";

vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("waitForTerminalReady", () => {
  it("waits for real output to become quiet", async () => {
    let output = "";
    setTimeout(() => {
      output = "booting";
    }, 10);
    setTimeout(() => {
      output = "booting\nready >";
    }, 25);

    const result = await waitForTerminalReady(
      () => output,
      () => true,
      {
        timeoutMs: 300,
        quietMs: 30,
        pollMs: 5,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(30);
  });

  it("does not mistake a silent process for a ready prompt", async () => {
    const result = await waitForTerminalReady(
      () => "",
      () => true,
      {
        timeoutMs: 100,
        quietMs: 20,
        pollMs: 5,
      }
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("não ficou pronta");
  });

  it("reports a CLI that exits during startup", async () => {
    const result = await waitForTerminalReady(
      () => "starting",
      () => false,
      {
        timeoutMs: 100,
        quietMs: 20,
        pollMs: 5,
      }
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("encerrou");
  });
});

describe("Kiro readiness (offline startup transcripts)", () => {
  afterEach(() => vi.useRealTimers());

  it("does not send into a quiet welcome banner or an auth question", async () => {
    vi.useFakeTimers();
    for (const output of ["Welcome to Kiro CLI\r\nLoading tools...", "Sign in to continue\r\n> ", "old screen\r\n> \r\nLoading MCP..."]) {
      const pending = waitForTerminalReady(() => output, () => true, {
        agent: "kiro", timeoutMs: 1000, maxAttempts: 1, quietMs: 100, pollMs: 25,
      });
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(false);
    }
  });

  it("accepts a stable input prompt even while unrelated ANSI status bytes keep arriving", async () => {
    vi.useFakeTimers();
    let frame = 0;
    const pending = waitForTerminalReady(() => `\x1b[2J\x1b[Hkiro ready ${frame++}\r\n\x1b[32m> \x1b[0m`, () => true, {
      agent: "kiro", timeoutMs: 1000, maxAttempts: 1, quietMs: 100, pollMs: 25,
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true, attempts: 1 });
  });

  it("retries observation only, within a bounded budget, for late initialization", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const pending = waitForTerminalReady(() => Date.now() - started < 1200 ? "Loading tools..." : "kiro\r\n> ", () => true, {
      agent: "kiro", timeoutMs: 1000, maxAttempts: 3, quietMs: 100, pollMs: 25,
    });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(result.waitedMs).toBeLessThanOrEqual(3000);
  });

  it("does not accept an input footer while the TUI is still working", async () => {
    vi.useFakeTimers();
    const pending = waitForTerminalReady(() => "Working (1m 35s • esc to interrupt)\r\n› Ask Codex to do anything", () => true, {
      agent: "kiro", timeoutMs: 500, maxAttempts: 1, quietMs: 100, pollMs: 25,
    });
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(false);
  });

  it("caps retry observation at three windows and at 60 seconds even for excessive options", async () => {
    vi.useFakeTimers();
    const pending = waitForTerminalReady(() => "Loading tools...", () => true, {
      agent: "kiro", timeoutMs: 1_000_000, maxAttempts: 100, quietMs: 100, pollMs: 100,
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, waitedMs: 60_000 });
    expect((await pending).attempts).toBeLessThanOrEqual(3);
  });
});

describe("Kiro 3.1 installed RZ() placeholders (source-derived, not live inference)", () => {
  // C:/Users/devmk/AppData/Local/Kiro-Cli/tui.js:1280 RZ(); renderer prefix at :1294.
  const ready = "> ask a question or describe a task ↵";
  const footer = "/sessions to resume · /copy to clipboard";
  afterEach(() => vi.useRealTimers());

  async function observe(output: string | (() => string)) {
    const pending = waitForTerminalReady(typeof output === "string" ? () => output : output, () => true, {
      agent: "kiro", timeoutMs: 500, maxAttempts: 1, quietMs: 100, pollMs: 25,
    });
    await vi.runAllTimersAsync();
    return pending;
  }

  it.each([
    ready,
    "> ask a question or describe a task enter",
    "> ask a question or describe a task ↵  ·  exit plan mode: shift+tab",
    "> ask a question or describe a task · /tangent to go back · /tangent ls to view",
    `${ready}\r\n${footer}`,
    `${ready}\r\nShowing detailed output · ctrl+o to toggle\r\n/copy to clipboard`,
    `${ready}\r\nmodel: claude-sonnet · context: 7%\r\n${footer}`,
  ])("accepts the installed idle placeholder and known UI footer: %s", async (output) => {
    vi.useFakeTimers();
    expect(await observe(output)).toMatchObject({ ok: true, attempts: 1 });
  });

  it("does not reset a stable input on ANSI footer/status redraws", async () => {
    vi.useFakeTimers();
    let frame = 0;
    expect(await observe(() => `\x1b[2J\x1b[H${ready}\r\nmodel: claude-sonnet · context: ${frame++}%\r\n${footer}`)).toMatchObject({ ok: true });
  });

  it.each([
    "> Initializing · type to queue a message",
    "> Initializing · type to queue another message",
    "> Kiro is working · Type to queue",
    "> Kiro is working · 1m 35s · Type to steer · ctrl+s to queue",
    "> Kiro is working · Type to queue · ctrl+s to steer",
    "> Goal Active: work · Iteration 1/5 · Ctrl+C to pause",
    "> Goal Paused: work · Iteration 1/5 · type to resume · Ctrl+C to cancel",
    `${ready}\r\nSign in to continue`,
    `${ready}\r\n> Sign in to continue`,
    `${ready}\r\nTrust this workspace? [y/n]`,
    `${ready}\r\nLoading MCP servers...`,
    `${ready}\r\nAssistant response in the transcript`,
    `${ready}\r\n> Kiro is working · Type to steer · ctrl+s to queue`,
    `\x1b[2J\x1b[H${ready}\x1b[H\x1b[2J> Initializing · type to queue a message`,
    `Example from documentation:\r\n\x60\x60\x60\r\n${ready}\r\n\x60\x60\x60`,
  ])("does not submit into initialization/work/auth or a historical prompt: %s", async (output) => {
    vi.useFakeTimers();
    expect(await observe(`${output}\r\n${footer}`)).toMatchObject({ ok: false, waitedMs: 500 });
  });

  it("starts stability again after the current prompt changes from ready to working to ready", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const result = await observe(() => {
      const elapsed = Date.now() - start;
      return `\x1b[2J\x1b[H${elapsed < 50 || elapsed >= 200 ? ready : "> Kiro is working · Type to queue"}\r\n${footer}`;
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.waitedMs).toBeGreaterThanOrEqual(300);
  });

  it("delivers the installed ready text through the real queue with one Enter after a late boot, despite duplicate callers", async () => {
    vi.useFakeTimers();
    const { PtyManager } = await import("../pty-manager");
    const { PtyInputQueue } = await import("../pty-input");
    const write = vi.fn();
    let output = "> Initializing · type to queue a message";
    const state = { paneId: "offline", config: { agent: "kiro" }, buffer: { readRawText: () => output } };
    // No constructor/spawn: no process, login, filesystem config, or model call.
    const manager = Object.create(PtyManager.prototype) as InstanceType<typeof PtyManager>;
    Object.assign(manager, {
      panes: new Map([["offline", state]]), inputs: new Map([["offline", new PtyInputQueue(write)]]),
    });
    setTimeout(() => { output += `\x1b[H\x1b[2J${ready}\r\n${footer}`; }, 1200);
    const options = { timeoutMs: 1000, quietMs: 100, pollMs: 25 };
    const first = manager.submitWhenReady("offline", "task\r\nsecond line", options);
    const duplicate = manager.submitWhenReady("offline", "task\r\nsecond line", options);
    await vi.advanceTimersByTimeAsync(1325);
    expect(write.mock.calls.map(([chunk]) => chunk).join("")).toBe("\x1b[200~task\nsecond line\x1b[201~");
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ ok: true, attempts: 2, promptSubmitted: true });
    expect(await duplicate).toMatchObject({ ok: true, promptSubmitted: true });
    await manager.submitWhenReady("offline", "task\r\nsecond line", options);
    expect(write.mock.calls.map(([chunk]) => chunk)).toEqual(["\x1b[200~task\nsecond line\x1b[201~", "\r"]);
  });
});
