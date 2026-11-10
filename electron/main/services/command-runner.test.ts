// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommandRunner, type CommandRequest } from "./command-runner";
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile), spawn: vi.fn(actual.spawn) };
});

let workspace: string;
let runner: ReturnType<typeof createCommandRunner>;
beforeEach(() => { workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cb-command-runtime-")); runner = createCommandRunner(); });
afterEach(async () => {
  await runner.dispose();
  if (path.dirname(path.resolve(workspace)) === path.resolve(os.tmpdir())) fs.rmSync(workspace, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.mocked(childProcess.execFile).mockRestore();
  vi.mocked(childProcess.spawn).mockRestore();
  vi.useRealTimers();
});
function nodeCommand(code: string): string {
  const file = path.join(workspace, `fixture-${Math.random().toString(36).slice(2)}.cjs`);
  fs.writeFileSync(file, code);
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  return `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(file)}`;
}
function request(command: string, extra: Partial<CommandRequest> = {}): CommandRequest {
  return { command, cwd: workspace, workspacePath: workspace, timeoutMs: 5000, maxOutputChars: 12000, ...extra };
}

describe("isolated command lifecycle (offline Node fixtures)", () => {
  it.runIf(process.platform === "win32")("supports the fixed cmd shell without mixing stderr or hiding exit codes", async () => {
    const result = await runner.runCommand(request("echo cmd-out & echo cmd-err 1>&2 & exit /b 3", { shell: "cmd" }));
    expect(result.exitCode).toBe(3);
    expect(result.stdout.trim()).toBe("cmd-out");
    expect(result.stderr.trim()).toBe("cmd-err");
  });

  it("returns actual stdout/stderr, exit code and duration from an isolated process", async () => {
    const result = await runner.runCommand(request(nodeCommand('process.stdout.write("out");process.stderr.write("err");process.exitCode=7;')));
    expect(result).toMatchObject({ ok: false, stdout: "out", stderr: "err", exitCode: 7, timedOut: false, cancelled: false, truncated: false });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses the approved cwd, closed stdin and no automatic secrets/credential env", async () => {
    vi.stubEnv("OPENAI_API_KEY", "not-real-secret");
    vi.stubEnv("SSH_AUTH_SOCK", "not-real-agent");
    vi.stubEnv("NODE_OPTIONS", "--invalid-option-that-must-not-be-inherited");
    const result = await runner.runCommand(request(nodeCommand('process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({cwd:process.cwd(),secret:process.env.OPENAI_API_KEY,sock:process.env.SSH_AUTH_SOCK,os:process.env.OS})));')));
    expect(result.ok).toBe(true);
    const output = JSON.parse(result.stdout);
    expect(fs.realpathSync(output.cwd)).toBe(fs.realpathSync(workspace));
    expect(output).not.toHaveProperty("secret"); expect(output).not.toHaveProperty("sock");
    if (process.platform === "win32") expect(output.os).toBe("Windows_NT");
  });

  it("bounds hostile JSON escaping/unicode output without mixing streams", async () => {
    const result = await runner.runCommand(request(nodeCommand('process.stdout.write("\\u0001".repeat(50000));process.stderr.write("😀".repeat(50000));')));
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(20_000);
    expect(result.stdout).not.toContain("😀");
    expect(result.stderr).not.toContain("\u0001");
  });

  it("times out and terminates the shell plus its child tree", async () => {
    const result = await runner.runCommand(request(nodeCommand('setInterval(()=>{},1000);'), { timeoutMs: 200 }));
    expect(result).toMatchObject({ ok: false, timedOut: true, cancelled: false, terminationConfirmed: true });
    expect(result.durationMs).toBeLessThan(5000);
  });

  it.runIf(process.platform === "win32")("confirms job-protected descendants when taskkill reports failure after root close", async () => {
    const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(childProcess.execFile).mockImplementation(((file: any, args: any, options: any, callback: any) =>
      original.execFile(file, args, options, () => callback(Object.assign(new Error("simulated root already exited"), { code: 128 })))) as any);
    const marker = path.join(workspace, "owned-race-pid.json");
    const command = nodeCommand(`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:child.pid}));setInterval(()=>{},1000);`);
    const controller = new AbortController();
    const job = runner.runCommand(request(command, { signal: controller.signal }));
    await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), { timeout: 3000 });
    controller.abort();
    const result = await job;
    expect(result).toMatchObject({ ok: false, cancelled: true, terminationConfirmed: true });
    const { pid } = JSON.parse(fs.readFileSync(marker, "utf8"));
    await vi.waitFor(() => {
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      expect(alive).toBe(false);
    }, { timeout: 1500 });
  });

  it.runIf(process.platform === "win32")("a failed startup kill cannot release any command payload before the job handshake", async () => {
    vi.mocked(childProcess.execFile).mockImplementationOnce(((_file: any, _args: any, _options: any, callback: any) => {
      queueMicrotask(() => callback(Object.assign(new Error("simulated startup kill failure"), { code: 128 })));
      return {};
    }) as any);
    const marker = path.join(workspace, "must-not-execute.txt");
    const result = await runner.runCommand(request(nodeCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected execution');`), { timeoutMs: 1 }));
    expect(result).toMatchObject({ ok: false, timedOut: true, terminationConfirmed: true });
    expect(fs.existsSync(marker)).toBe(false);
    // No quarantine: root close + the sealed, empty bootstrap is actual proof.
    expect((await runner.runCommand(request(nodeCommand('process.stdout.write("next");')))).stdout).toBe("next");
  });

  it.runIf(process.platform === "win32")("fails closed when taskkill fails and root exit is never observed", async () => {
    vi.useFakeTimers();
    const child: any = new EventEmitter();
    child.pid = 987654;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.unref = vi.fn();
    vi.mocked(childProcess.spawn).mockReturnValueOnce(child);
    vi.mocked(childProcess.execFile).mockImplementationOnce(((_file: any, _args: any, _options: any, callback: any) => {
      callback(Object.assign(new Error("simulated access denied"), { code: 5 }));
      return {};
    }) as any);
    const job = runner.runCommand(request("this payload must never be sent", { timeoutMs: 10 }));
    await vi.advanceTimersByTimeAsync(3010);
    expect(await job).toMatchObject({ ok: false, timedOut: true, terminationConfirmed: false, code: "TERMINATION_UNCONFIRMED" });
    expect((await runner.runCommand(request("must remain quarantined"))).code).toBe("RUNNER_CLOSED");
  });

  it.each(["normal exit", "abort"])("reaps an actual offline grandchild on %s", async mode => {
    const marker = path.join(workspace, "owned-child-pid.json");
    const command = nodeCommand(`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:child.pid}));child.unref();${mode === "abort" ? "setInterval(()=>{},1000);" : ""}`);
    const controller = new AbortController();
    const job = runner.runCommand(request(command, { signal: controller.signal }));
    await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), { timeout: 3000 });
    if (mode === "abort") controller.abort();
    const result = await job;
    expect(result.terminationConfirmed).toBe(true);
    expect(result.cancelled).toBe(mode === "abort");
    const { pid } = JSON.parse(fs.readFileSync(marker, "utf8"));
    await vi.waitFor(() => {
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      expect(alive).toBe(false);
    }, { timeout: 1500 });
  });

  it("propagates cancellation and dispose terminates an active run", async () => {
    const controller = new AbortController();
    const job = runner.runCommand(request(nodeCommand('setInterval(()=>{},1000);'), { signal: controller.signal }));
    controller.abort();
    expect(await job).toMatchObject({ ok: false, cancelled: true, timedOut: false });
    const another = runner.runCommand(request(nodeCommand('setInterval(()=>{},1000);')));
    await runner.dispose();
    expect(await another).toMatchObject({ ok: false, cancelled: true });
    expect((await runner.runCommand(request("never execute"))).ok).toBe(false);
  });

  it("rejects arbitrary shells, missing cwd and scope escape before executing", async () => {
    expect((await runner.runCommand(request("never", { shell: "arbitrary.exe" as any }))).ok).toBe(false);
    expect((await runner.runCommand(request("never", { cwd: path.dirname(workspace) }))).ok).toBe(false);
    expect((await runner.runCommand(request("never", { cwd: path.join(workspace, "missing") }))).ok).toBe(false);
  });
});
