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
});
