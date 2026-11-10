// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { exec, execFile, execSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CliDetector } from "./cli-detector";

vi.mock("node:child_process", () => ({ exec: vi.fn(), execFile: vi.fn(), execSync: vi.fn() }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(execFile).mockImplementation(((
    file: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, value: string) => void
  ) => {
    queueMicrotask(() => done(new Error(`missing ${file}`), ""));
    return {};
  }) as typeof execFile);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("awaits asynchronous CLI detection during startup instead of synchronously probing on the main thread", () => {
  // Source guard only: importing index.ts would start Electron and real services.
  const startup = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf-8");
  expect(/await\s+ctx\.cliDetector\.redetectAsync\(\)/.test(startup)).toBe(true);
  expect(/ctx\.cliDetector\.redetect\(\)/.test(startup)).toBe(false);
});

it("caps asynchronous subprocess probes at two and keeps getAll cached after completion", async () => {
  let active = 0;
  let maximum = 0;
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, value: string) => void
  ) => {
    active++;
    maximum = Math.max(maximum, active);
    queueMicrotask(() => { active--; done(new Error("fixture CLI absent"), ""); });
    return {};
  }) as typeof execFile);
  const detector = new CliDetector();
  const result = await detector.redetectAsync();
  expect(maximum).toBe(2);
  expect(active).toBe(0);
  expect(detector.getAll()).toBe(result);
  expect(execSync).not.toHaveBeenCalled();
});

it("probes asynchronously, shares concurrent refreshes, and returns all 14 registry entries", async () => {
  const detector = new CliDetector();
  const first = detector.redetectAsync();
  expect(detector.redetectAsync()).toBe(first);
  expect(detector.getAllAsync()).toBe(first);
  expect(execSync).not.toHaveBeenCalled();
  const result = await first;
  expect(result.kiro).toEqual({ found: false });
  expect(Object.keys(result).filter((id) => id !== "9router" && id !== "shell")).toHaveLength(14);
  expect(execFile).toHaveBeenCalled();
  expect(await detector.getAllAsync()).toBe(result);
});

it.skipIf(process.platform !== "win32")(
  "finds installed Kiro through its fallback even when PATH and LOCALAPPDATA are absent",
  async () => {
    vi.stubEnv("LOCALAPPDATA", "");
    const installed = path.join(os.homedir(), "AppData", "Local", "Kiro-Cli", "kiro-cli.exe");
    vi.mocked(fs.existsSync).mockImplementation((file) => file === installed);
    vi.mocked(execFile).mockImplementation(((
      file: string,
      _args: string[],
      _options: unknown,
      done: (error: Error | null, value: string) => void
    ) => {
      queueMicrotask(() =>
        done(
          file === installed ? null : new Error("not on PATH"),
          file === installed ? "detected Kiro version" : ""
        )
      );
      return {};
    }) as typeof execFile);
    const detector = new CliDetector();
    const result = await detector.redetectAsync();
    expect(result.kiro).toEqual({ found: true, path: installed, version: "detected Kiro version" });
    expect(execSync).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  }
);

it("finds a CLI from PATH without waiting for a user action", async () => {
  const installed =
    process.platform === "win32" ? "C:\\fixture\\kiro-cli.exe" : "/fixture/kiro-cli";
  vi.mocked(execFile).mockImplementation(((
    file: string,
    args: string[],
    _options: unknown,
    done: (error: Error | null, value: string) => void
  ) => {
    const found = args[0] === "kiro-cli" || file === installed;
    queueMicrotask(() =>
      done(
        found ? null : new Error("missing"),
        file === installed ? "detected Kiro version" : found ? installed : ""
      )
    );
    return {};
  }) as typeof execFile);
  expect((await new CliDetector().getAllAsync()).kiro).toMatchObject({
    found: true,
    path: installed,
  });
});
