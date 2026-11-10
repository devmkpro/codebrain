// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommandHandlers } from "./command-handlers.js";

let workspace;
let outside;
let mode;
let opts;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cb-command-bridge-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "cb-command-outside-"));
  mode = "write_external";
  opts = {
    getCurrentWorkspacePath: () => workspace,
    workspaceConfigStore: { getAccessMode: () => mode },
    approveCommand: vi.fn(async () => true),
    runCommand: vi.fn(async () => ({ ok: true, stdout: "out", stderr: "err", exitCode: 0, durationMs: 5, timedOut: false, cancelled: false, truncated: false })),
  };
});
afterEach(() => {
  for (const target of [workspace, outside]) {
    if (path.dirname(target) === fs.realpathSync(os.tmpdir()) || path.dirname(target) === os.tmpdir()) fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("shellRun permission boundary", () => {
  it("passes only normalized approved fields and separate output, not a PTY", async () => {
    const signal = new AbortController().signal;
    const result = await createCommandHandlers(opts).shellRun({ command: "fixture", env: { SECRET: "bad" }, workspacePath: outside }, { signal });
    expect(result).toMatchObject({ ok: true, stdout: "out", stderr: "err", exitCode: 0 });
    expect(opts.approveCommand).toHaveBeenCalledTimes(1);
    const sent = opts.runCommand.mock.calls[0][0];
    expect(sent).toMatchObject({ command: "fixture", cwd: fs.realpathSync(workspace), workspacePath: fs.realpathSync(workspace), timeoutMs: 30_000 });
    expect(sent.signal).toBe(signal);
    expect(sent).not.toHaveProperty("env");
  });

  it.each(["read_external", "workspace", undefined])("denies unsandboxed execution under %s even inside workspace", async value => {
    mode = value;
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture" })).ok).toBe(false);
    expect(opts.runCommand).not.toHaveBeenCalled();
    expect(opts.approveCommand).not.toHaveBeenCalled();
  });

  it("requires a policy store and a fresh approval callback, failing closed", async () => {
    for (const key of ["workspaceConfigStore", "approveCommand", "getCurrentWorkspacePath", "runCommand"]) {
      expect((await createCommandHandlers({ ...opts, [key]: undefined }).shellRun({ command: "fixture" })).ok).toBe(false);
    }
    opts.approveCommand.mockResolvedValue(false);
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture" })).code).toBe("APPROVAL_DENIED");
    expect(opts.runCommand).not.toHaveBeenCalled();
  });

  it("honors readOnly and permissions revocation during the native approval", async () => {
    expect((await createCommandHandlers({ ...opts, readOnly: true }).shellRun({ command: "fixture" })).ok).toBe(false);
    opts.approveCommand.mockImplementation(async () => { mode = "read_external"; return true; });
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture" })).code).toBe("ACCESS_CHANGED");
    expect(opts.runCommand).not.toHaveBeenCalled();
  });

  it("rejects a workspace switch while the user approval is pending", async () => {
    let current = workspace;
    opts.getCurrentWorkspacePath = () => current;
    opts.approveCommand.mockImplementation(async () => { current = outside; return true; });
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture" })).code).toBe("ACCESS_CHANGED");
    expect(opts.runCommand).not.toHaveBeenCalled();
  });

  it("accepts a real child cwd, rejects traversal, siblings and junction/symlink escapes", async () => {
    fs.mkdirSync(path.join(workspace, "child"));
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture", cwd: "child" })).ok).toBe(true);
    opts.runCommand.mockClear();
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture", cwd: outside })).ok).toBe(false);
    fs.symlinkSync(outside, path.join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect((await createCommandHandlers(opts).shellRun({ command: "fixture", cwd: "escape" })).ok).toBe(false);
    expect(opts.runCommand).not.toHaveBeenCalled();
  });

  it.each([{ command: "" }, { command: "x\0y" }, { command: "x", shell: "evil.exe" }, { command: "x", timeoutMs: NaN }])("rejects invalid input %j", async args => {
    expect((await createCommandHandlers(opts).shellRun(args)).ok).toBe(false);
    expect(opts.runCommand).not.toHaveBeenCalled();
  });

  it("caps time at 120 seconds and JSON below 20k even with control characters", async () => {
    opts.runCommand.mockResolvedValue({ ok: true, stdout: "\u0001".repeat(100_000), stderr: "😀".repeat(100_000), exitCode: 0, durationMs: 1, timedOut: false, truncated: false, secret: "do not forward" });
    const result = await createCommandHandlers(opts).shellRun({ command: "fixture", timeoutMs: 999_999, maxOutputChars: 999_999 });
    expect(opts.runCommand.mock.calls[0][0].timeoutMs).toBe(120_000);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(20_000);
    expect(result.truncated).toBe(true);
    expect(result).not.toHaveProperty("secret");
  });

  it("does not execute after cancellation while awaiting approval", async () => {
    const controller = new AbortController();
    opts.approveCommand.mockImplementation(async () => { controller.abort(); return true; });
    const result = await createCommandHandlers(opts).shellRun({ command: "fixture" }, { signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(opts.runCommand).not.toHaveBeenCalled();
  });

  it("does not leak thrown callback errors or commands", async () => {
    opts.runCommand.mockRejectedValue(new Error("SECRET-CONTENT"));
    const result = await createCommandHandlers(opts).shellRun({ command: "private command" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/SECRET-CONTENT|private command/);
  });
});
