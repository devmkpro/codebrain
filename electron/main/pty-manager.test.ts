// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PtyManager } from "./pty-manager";

const native = vi.hoisted(() => ({
  output: (_data: string) => {}, exit: (_event: { exitCode: number }) => {},
  write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
  env: {} as Record<string, string>,
  command: { binary: "", args: [] as string[] },
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@lydell/node-pty", () => ({ spawn: (binary: string, args: string[], options: any) => {
  native.env = options.env;
  native.command = { binary, args };
  return ({
  write: native.write, resize: native.resize, kill: native.kill,
  onData: (callback: typeof native.output) => { native.output = callback; },
  onExit: (callback: typeof native.exit) => { native.exit = callback; },
}); } }));

let manager: PtyManager;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  native.write.mockReset();
  // Avoid installing process signal handlers or touching existing temp scripts.
  manager = Object.create(PtyManager.prototype);
  Object.assign(manager, {
    panes: new Map(), zombieBuffers: new Map(), pendingEcho: new Map(), inputs: new Map(),
    idleDetector: { activity: vi.fn(), cancel: vi.fn() },
  });
  await manager.spawn({ paneId: "receiver", agent: "shell", cwd: process.cwd(), cols: 90, rows: 24 });
});
afterEach(() => { manager.kill("receiver"); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("PTY transport preserves TUI state", () => {
  it("preserves Windows identity in the child environment for official installers", async () => {
    vi.stubEnv("OS", "Windows_NT");
    manager.kill("receiver");
    await manager.spawn({ paneId: "receiver", agent: "shell", cwd: process.cwd() });
    expect(native.env.OS).toBe("Windows_NT");
  });

  it("launches trusted main-only executable argv directly without shell quoting", async () => {
    const binary = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
    const args = ["-p", "2222", "-i", "C:\\QA keys\\test key", "dev@example.invalid", "printf '%s' 'a b'"];
    manager.kill("receiver");
    await manager.spawn({ paneId: "receiver", agent: "shell", cwd: process.cwd() }, { binary, args });
    expect(native.command.binary).toBe(binary);
    expect(native.command.args).toEqual(args);
  });

  it("ignores executable overrides smuggled into the public config object", async () => {
    manager.kill("receiver");
    await manager.spawn({ paneId: "receiver", agent: "shell", cwd: process.cwd(), binary: "untrusted.exe", command: { binary: "untrusted.exe", args: [] } } as any);
    expect(native.command.binary).not.toBe("untrusted.exe");
  });

  it("never discards an ANSI frame when one character matches a programmatic message", () => {
    const output = vi.fn();
    manager.on("output", output);
    manager.writeSilent("receiver", "[MESSAGE from worker] update", true);
    const frame = "\x1b[2J\x1b[H[MK MODE]\r\n\x1b[24;1Hstatus ready";
    native.output(frame);
    expect(output).toHaveBeenCalledWith("receiver", frame);
    expect(manager.readRawText("receiver")).toContain(frame);
  });

  it("keeps pasted prompt redraws in the same ordered output stream", () => {
    const output = vi.fn();
    manager.on("output", output);
    manager.writeSilent("receiver", "hello", true);
    native.output("\x1b[4;1Hhello\x1b[K");
    native.output("\x1b[1A\ranswer\x1b[K");
    expect(output.mock.calls.map((call) => call[1]).join("")).toBe("\x1b[4;1Hhello\x1b[K\x1b[1A\ranswer\x1b[K");
  });

  it("preserves the ordering of Enter followed by the next keystroke", () => {
    manager.write("receiver", "\r");
    manager.write("receiver", "x");
    expect(native.write.mock.calls.map(([data]) => data).join("")).toBe("\rx");
  });

  it("does not interleave Enter into a large bracketed paste", async () => {
    const text = "á😀".repeat(3000);
    manager.writeSilent("receiver", text, true);
    manager.write("receiver", "\r");
    await vi.runAllTimersAsync();
    expect(native.write.mock.calls.map(([data]) => data).join("")).toBe(`\x1b[200~${text}\x1b[201~\r`);
    expect(native.write.mock.calls.every(([data]) => data.length <= 2048)).toBe(true);
  });

  it("submits one normalized paste before its Enter, after the TUI consumes paste", async () => {
    manager.submit("receiver", "first\r\nsecond");
    expect(native.write.mock.calls.map(([data]) => data).join("")).toBe("\x1b[200~first\nsecond\x1b[201~");
    await vi.runAllTimersAsync();
    expect(native.write.mock.calls.map(([data]) => data).join("")).toBe("\x1b[200~first\nsecond\x1b[201~\r");
  });

  it("does not write delayed chunks after the recipient exits", async () => {
    manager.writeSilent("receiver", "x".repeat(5000), true);
    native.exit({ exitCode: 0 });
    await vi.runAllTimersAsync();
    expect(native.write).toHaveBeenCalledTimes(1);
    expect(manager.hasPane("receiver")).toBe(false);
  });

  it("rejects invalid sizes and avoids redundant native TUI redraws", () => {
    manager.resize("receiver", 90, 24);
    manager.resize("receiver", 0, 0);
    manager.resize("receiver", NaN, 24);
    manager.resize("receiver", 90.5, 24);
    expect(native.resize).not.toHaveBeenCalled();
    manager.resize("receiver", 80, 20);
    manager.resize("receiver", 80, 20);
    expect(native.resize).toHaveBeenCalledTimes(1);
    expect(native.resize).toHaveBeenCalledWith(80, 20);
  });

  it("does not acknowledge a prompt if the terminal exits before the delayed Enter", async () => {
    native.output("ready >");
    const pending = manager.submitWhenReady("receiver", "task", { timeoutMs: 1000, quietMs: 50, pollMs: 10 });
    await vi.advanceTimersByTimeAsync(60);
    expect(native.write).toHaveBeenCalledTimes(1);
    native.exit({ exitCode: 0 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, promptSubmitted: false });
    expect(native.write.mock.calls.map(([text]) => text).join("")).not.toContain("\r");
  });

  it("coalesces duplicate delivery calls and acknowledges only after the native Enter write", async () => {
    native.output("ready >");
    const options = { timeoutMs: 1000, quietMs: 50, pollMs: 10 };
    const first = manager.submitWhenReady("receiver", "same task", options);
    const second = manager.submitWhenReady("receiver", "same task", options);
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ ok: true, promptSubmitted: true });
    expect(await second).toMatchObject({ ok: true, promptSubmitted: true });
    await manager.submitWhenReady("receiver", "same task", options);
    expect(native.write.mock.calls.map(([text]) => text).join("")).toBe("\x1b[200~same task\x1b[201~\r");
  });

  it("retains task-only brief separately and reports the real shell without changing its command", async () => {
    manager.kill("receiver");
    const spawnBrief = { id: "brief_receiver", prompt: "Inspect offline fixture", truncated: false, delivery: { state: "pending", promptSubmitted: false } };
    await manager.spawn({ paneId: "receiver", agent: "shell", cwd: process.cwd(), spawnBrief } as any, { binary: "C:\\Windows\\System32\\cmd.exe", args: ["/q"] });
    const pane = manager.list()[0] as any;
    expect(pane).toMatchObject({ hasInitialPrompt: true, initialPromptId: "brief_receiver", promptSubmitted: false, shell: { kind: "cmd", commandSyntax: "cmd" } });
    expect(pane).not.toHaveProperty("spawnBrief");
    expect(pane).not.toHaveProperty("initialPrompt");
    expect((manager as any).getSpawnBrief("receiver")).toMatchObject({ prompt: "Inspect offline fixture" });
    expect(native.command.args).toEqual(["/q"]);
    native.output("ready >");
    const pending = manager.submitWhenReady("receiver", "generated context + original task", { quietMs: 50, pollMs: 10 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: true, promptSubmitted: true });
    expect(spawnBrief.delivery).toMatchObject({ state: "submitted", promptSubmitted: true });
    expect(manager.getSpawnBrief("receiver")!.prompt).toBe("Inspect offline fixture");
    const copy = manager.getSpawnBrief("receiver")!;
    copy.delivery.promptSubmitted = false;
    expect(manager.getSpawnBrief("receiver")!.delivery.promptSubmitted).toBe(true);
  });

  it("reproduces five offline boot profiles with three later than 20 seconds, writing each task once", async () => {
    // Synthetic readiness timings from the reported failure mode, not live Kiro inference.
    for (const readyAfter of [200, 500, 20_500, 31_000, 45_000]) {
      manager.kill("receiver");
      native.write.mockClear();
      await manager.spawn({ paneId: "receiver", agent: "kiro", cwd: process.cwd() }, { binary: "offline-kiro-fixture", args: [] });
      native.output("Welcome to Kiro CLI\r\nLoading tools...");
      setTimeout(() => native.output("\x1b[2J\x1b[H[fixture-agent] > "), readyAfter);
      const pending = manager.submitWhenReady("receiver", `task ${readyAfter}`, { quietMs: 100, pollMs: 100 });
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ ok: true, promptSubmitted: true, attempts: readyAfter > 20_000 ? Math.floor(readyAfter / 20_000) + 1 : 1 });
      expect(native.write.mock.calls.map(([text]) => text).join("")).toBe(`\x1b[200~task ${readyAfter}\x1b[201~\r`);
    }
  });

  it("does not retry a partial native write or misreport it as submitted", async () => {
    native.output("ready >");
    native.write.mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("closed pipe"); });
    const pending = manager.submitWhenReady("receiver", "task", { timeoutMs: 1000, quietMs: 50 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ ok: false, promptSubmitted: false, deliveryState: "uncertain" });
    const calls = native.write.mock.calls.length;
    expect(await manager.submitWhenReady("receiver", "task")).toMatchObject({ ok: false, promptSubmitted: false });
    expect(native.write).toHaveBeenCalledTimes(calls);
  });

  it("times out without any paste, then permits explicit observation again if nothing was written", async () => {
    manager.kill("receiver");
    await manager.spawn({ paneId: "receiver", agent: "kiro", cwd: process.cwd() }, { binary: "offline-kiro-fixture", args: [] });
    native.output("Loading tools...");
    const first = manager.submitWhenReady("receiver", "task", { timeoutMs: 100, maxAttempts: 1, quietMs: 50 });
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ ok: false, promptSubmitted: false, deliveryState: "not_submitted" });
    expect(native.write).not.toHaveBeenCalled();
    native.output("\x1b[2J\x1b[H> ");
    const next = manager.submitWhenReady("receiver", "task", { timeoutMs: 1000, quietMs: 50 });
    await vi.runAllTimersAsync();
    expect(await next).toMatchObject({ ok: true, promptSubmitted: true });
    expect(native.write.mock.calls.map(([text]) => text).join("")).toBe("\x1b[200~task\x1b[201~\r");
  });
});
