// @vitest-environment node
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  files: new Set<string>(), directories: new Set<string>(),
  execSync: vi.fn(() => { throw new Error("No discovery subprocess allowed in this test"); }),
  execFileSync: vi.fn(() => { throw new Error("No discovery subprocess allowed in this test"); }),
}));
vi.mock("node:child_process", () => ({ execSync: fake.execSync, execFileSync: fake.execFileSync }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("node:fs", () => ({
  constants: { X_OK: 1 },
  existsSync: (name: string) => fake.files.has(name) || fake.directories.has(name),
  statSync: (name: string) => ({ isFile: () => fake.files.has(name) }),
  accessSync: (name: string) => { if (!fake.files.has(name)) throw new Error("missing"); },
  readdirSync: () => [], readFileSync: () => "", openSync: () => 1, closeSync: () => {},
  readSync: (_fd: number, buffer: Buffer) => { buffer.write("MZ"); return 2; },
}));

const windows = process.platform === "win32";
const binDir = windows ? "C:\\qa\\bin" : "/qa/bin";
const kiro = path.join(binDir, windows ? "kiro-cli.exe" : "kiro-cli");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fake.files.clear();
  fake.directories.clear();
  vi.stubEnv("PATH", binDir);
  vi.stubEnv("PATHEXT", ".EXE;.CMD;.BAT;.COM");
});
afterEach(() => vi.unstubAllEnvs());

describe("bounded PTY executable discovery", () => {
  it("resolves a known registry binary from PATH without where, reg, shell or CLI execution", async () => {
    fake.files.add(kiro);
    const { resolveCommand } = await import("./pty-manager");
    const result = resolveCommand("kiro");
    expect(result.binary).toBe(kiro);
    expect(result.unavailable).toBe(false);
    expect(fake.execSync).not.toHaveBeenCalled();
    expect(fake.execFileSync).not.toHaveBeenCalled();
  });

  it("does not launch discovery subprocesses for a missing known registry binary", async () => {
    const { resolveCommand } = await import("./pty-manager");
    expect(resolveCommand("kiro").unavailable).toBe(true);
    expect(fake.execSync).not.toHaveBeenCalled();
    expect(fake.execFileSync).not.toHaveBeenCalled();
  });

  it("rejects a directory named like an executable", async () => {
    fake.directories.add(kiro);
    const { resolveCommand } = await import("./pty-manager");
    expect(resolveCommand("kiro").unavailable).toBe(true);
  });

  it("bounds every remaining custom discovery fallback and hides its Windows window", async () => {
    const { resolveCommand } = await import("./pty-manager");
    resolveCommand("qa-custom-missing-binary");
    const calls = [...fake.execSync.mock.calls, ...fake.execFileSync.mock.calls] as unknown as any[][];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const options = call[call.length - 1];
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(1000);
      expect(options.windowsHide).toBe(true);
    }
  });

  it("does not return a cached executable after it was removed", async () => {
    fake.files.add(kiro);
    const { resolveCommand } = await import("./pty-manager");
    expect(resolveCommand("kiro").binary).toBe(kiro);
    fake.files.delete(kiro);
    expect(resolveCommand("kiro").unavailable).toBe(true);
    expect(fake.execSync).not.toHaveBeenCalled();
    expect(fake.execFileSync).not.toHaveBeenCalled();
  });
});
