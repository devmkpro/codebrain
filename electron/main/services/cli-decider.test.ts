// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => mocked);
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
import { getCliDecider, type CliDeciderRequest } from "./cli-decider";

const flags = "--print --safe-mode --tools --strict-mcp-config --mcp-config --setting-sources --settings --disable-slash-commands --no-session-persistence --system-prompt --output-format --model";
const valid = { taskId: "geral", confidence: 0.9, reason: "classificação" };
const envelope = (raw: unknown) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: typeof raw === "string" ? raw : JSON.stringify(raw) });
const children: any[] = [];
let help = flags;
let response = envelope(valid);
let pending = false;

function ctx() {
  return {
    providerStore: { listFull: () => [{ id: "claude-oauth", models: ["model-5.10", "model-5.9"] }] },
    cliDetector: { getAll: () => ({ claude: { found: true, path: path.resolve("claude.exe"), version: "fixture" }, codex: { found: true, path: path.resolve("codex.exe") }, kiro: { found: true, path: path.resolve("kiro.exe") } }) },
  } as any;
}
function request(extra: Partial<CliDeciderRequest> = {}): CliDeciderRequest {
  return { providerId: "cli:claude", model: "model-5.10", messages: [{ role: "system", content: "return JSON row geral" }, { role: "user", content: "PRIVATE-PROMPT" }], timeoutMs: 1000, signal: new AbortController().signal, ...extra };
}
beforeEach(() => {
  children.length = 0; help = flags; response = envelope(valid); pending = false;
  mocked.spawn.mockReset(); mocked.execFile.mockReset();
  mocked.spawn.mockImplementation((_binary, args, options) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.pid = 987654;
    child.kill = vi.fn(() => { queueMicrotask(() => child.emit("close", 1)); return true; });
    child.options = options; child.args = args;
    children.push(child);
    queueMicrotask(() => {
      if (args.includes("--help")) { child.stdout.write(help); child.emit("close", 0); }
      else if (!pending) { child.stdout.write(response); child.emit("close", 0); }
    });
    return child;
  });
  mocked.execFile.mockImplementation((_file, _args, _options, callback) => {
    children.at(-1)?.emit("close", 1);
    callback(null);
  });
  // Simulated PIDs must never reach the host kill API on non-Windows CI.
  vi.spyOn(process, "kill").mockImplementation(() => { children.at(-1)?.emit("close", 1); return true; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("isolated CLI Decider", () => {
  it("is a context singleton and lists only help-confirmed Claude, never Codex/Kiro", async () => {
    const context = ctx(); const runner = getCliDecider(context);
    expect(getCliDecider(context)).toBe(runner);
    expect(await runner.listProviders()).toEqual([{ id: "cli:claude", label: "Claude · login existente", transport: "cli", cli: "claude", authentication: "existing-login", models: ["model-5.10", "model-5.9"] }]);
    await runner.listProviders();
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
    expect(children[0].args).toEqual(["--help"]);
  });

  it("fails closed if safe-mode or other required flags are absent", async () => {
    help = flags.replace("--safe-mode", "--bare");
    const runner = getCliDecider(ctx());
    expect(await runner.listProviders()).toEqual([]);
    await expect(runner.run(request())).rejects.toThrow(/isolamento/);
    expect(mocked.spawn).toHaveBeenCalledTimes(1);
  });

  it("does not bypass a managed policy that might retain hooks", async () => {
    vi.mocked(fs.existsSync).mockImplementationOnce(() => true);
    expect(await getCliDecider(ctx()).listProviders()).toEqual([]);
    expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it("awaits asynchronous detection before reading the synchronous inventory", async () => {
    const context = ctx(); const getAll = vi.fn(context.cliDetector.getAll);
    let finish!: () => void;
    context.cliDetector.getAll = getAll;
    context.cliDetector.getAllAsync = () => new Promise<void>(resolve => { finish = resolve; });
    const job = getCliDecider(context).listProviders();
    expect(getAll).not.toHaveBeenCalled();
    finish();
    expect(await job).toHaveLength(1);
    expect(getAll).toHaveBeenCalled();
  });

  it("an already cancelled request never probes or starts inference", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getCliDecider(ctx()).run(request({ signal: controller.signal }))).rejects.toThrow(/cancelado/);
    expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it("never executes shell shims or a binary supplied in the request", async () => {
    const context = ctx(); context.cliDetector.getAll = () => ({ claude: { found: true, path: path.resolve("claude.cmd") } });
    expect(await getCliDecider(context).listProviders()).toEqual([]);
    await expect(getCliDecider(ctx()).run(request({ providerId: "cli:codex" }))).rejects.toThrow(/sem modo/);
    expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it("uses no tools, no inherited MCP/settings/instructions, native login paths only", async () => {
    vi.stubEnv("OS", "Windows_NT");
    vi.stubEnv("ANTHROPIC_API_KEY", "NEVER-INHERIT");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "NEVER-INHERIT-TOKEN");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://foreign.invalid");
    vi.stubEnv("NODE_OPTIONS", "untrusted");
    const runner = getCliDecider(ctx()); await runner.listProviders();
    expect(JSON.parse(await runner.run(request()))).toEqual(valid);
    const child = children.at(-1);
    const args = child.args;
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args).toEqual(expect.arrayContaining(["--safe-mode", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence"]));
    expect(args).not.toContain("--bare");
    expect(args.join(" ")).not.toContain("PRIVATE-PROMPT");
    expect(child.options.shell).toBe(false);
    expect(child.options.windowsHide).toBe(true);
    expect(child.options.stdio[2]).toBe("ignore");
    expect(child.options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(child.options.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(child.options.env).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(child.options.env).not.toHaveProperty("NODE_OPTIONS");
    expect(child.options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    expect(child.options.env.OS).toBe("Windows_NT");
    expect(child.options.env.USERPROFILE || child.options.env.HOME).toBeTruthy();
    expect(fs.existsSync(child.options.cwd)).toBe(false);
  });

  it.each(["prefix {\"taskId\":\"geral\",\"confidence\":1}", '{"taskId":"geral","confidence":"1"}', '{"taskId":"geral","confidence":2}', '{"taskId":"geral","confidence":1,"command":"evil"}', '[]', '```json\n{}\n```'])("rejects non-strict classifier output: %s", async raw => {
    response = envelope(raw);
    await expect(getCliDecider(ctx()).run(request())).rejects.toThrow(/JSON inválida/);
  });

  it("rejects a tool/result error envelope without exposing CLI stderr", async () => {
    response = JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "SECRET" });
    await expect(getCliDecider(ctx()).run(request())).rejects.toThrow("Resposta JSON inválida");
  });

  it("validates model and input before any subprocess", async () => {
    const runner = getCliDecider(ctx());
    await expect(runner.run(request({ model: "foreign-model" }))).rejects.toThrow(/catálogo local/);
    await expect(runner.run(request({ messages: [{ role: "tool", content: "x" }] }))).rejects.toThrow(/inválido/);
    expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it("caches successful responses by model + complete input, not prompt content in cache keys", async () => {
    const runner = getCliDecider(ctx()); await runner.listProviders();
    await runner.run(request()); await runner.run(request());
    expect(mocked.spawn).toHaveBeenCalledTimes(2);
    await runner.run(request({ model: "model-5.9" }));
    expect(mocked.spawn).toHaveBeenCalledTimes(3);
  });

  it("has global concurrency one and kills the tree on abort before allowing another run", async () => {
    const runner = getCliDecider(ctx()); await runner.listProviders();
    const controller = new AbortController(); pending = true;
    const job = runner.run(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(children.length).toBe(2));
    await expect(runner.run(request({ model: "model-5.9" }))).rejects.toThrow(/ocupado/);
    controller.abort();
    await expect(job).rejects.toThrow(/cancelado/);
    expect(mocked.execFile.mock.calls[0]?.[1] || ["SIGKILL"]).toEqual(process.platform === "win32" ? ["/PID", "987654", "/T", "/F"] : ["SIGKILL"]);
    pending = false; await expect(runner.run(request())).resolves.toContain("geral");
  });

  it("kills stalled processes on timeout and removes the owned temporary cwd", async () => {
    const runner = getCliDecider(ctx()); await runner.listProviders(); pending = true;
    await expect(runner.run(request({ timeoutMs: 5 }))).rejects.toThrow(/tempo/);
    expect(fs.existsSync(children.at(-1).options.cwd)).toBe(false);
  });

  it("caps output and kills the child rather than storing unlimited classifier content", async () => {
    response = "x".repeat(70 * 1024);
    await expect(getCliDecider(ctx()).run(request())).rejects.toThrow(/excedeu/);
    expect(fs.existsSync(children.at(-1).options.cwd)).toBe(false);
  });
});
