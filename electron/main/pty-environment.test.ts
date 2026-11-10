// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPtyEnvironment } from "./pty-environment";

describe("PTY child environment allowlist", () => {
  it("preserves Windows OS, native/WOW architecture and standard installation roots", () => {
    const source = {
      OS: "Windows_NT", PROCESSOR_ARCHITECTURE: "x86", PROCESSOR_ARCHITEW6432: "ARM64",
      ProgramFiles: "C:\\Program Files (x86)", "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramW6432: "C:\\Program Files",
      SystemDrive: "C:", ALLUSERSPROFILE: "C:\\ProgramData", PROGRAMDATA: "C:\\ProgramData",
    };
    const env = buildPtyEnvironment(source, {}, "win32");
    for (const [key, value] of Object.entries(source)) expect(env[key]).toBe(value);
  });

  it("provides factual OS identity if a Windows desktop launcher omitted it", () => {
    expect(buildPtyEnvironment({}, {}, "win32").OS).toBe("Windows_NT");
    expect(buildPtyEnvironment({ OS: "" }, {}, "win32").OS).toBe("Windows_NT");
    expect(buildPtyEnvironment({}, {}, "linux").OS).toBeUndefined();
    expect(buildPtyEnvironment({}, {}, "darwin").OS).toBeUndefined();
  });

  it("handles Windows key casing without duplicate PATH/Path aliases", () => {
    const env = buildPtyEnvironment({ Path: "system-path", SystemRoot: "C:\\Windows", os: "Windows_NT", programfiles: "C:\\Program Files" }, { path: "pane-path" }, "win32");
    expect(env.PATH).toBe("pane-path");
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.ProgramFiles).toBe("C:\\Program Files");
    expect(env.OS).toBe("Windows_NT");
    expect(Object.keys(env).filter((key) => key.toLowerCase() === "path")).toEqual(["PATH"]);
  });

  it("does not inherit unrelated secrets or Electron/Node runtime injection", () => {
    const env = buildPtyEnvironment({ PATH: "/bin", AWS_SECRET_ACCESS_KEY: "synthetic-secret", DATABASE_PASSWORD: "synthetic-password", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--inspect" }, {}, "win32");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.DATABASE_PASSWORD).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PATH).toBe("/bin");
  });

  it("retains existing provider allowlist and explicit per-pane overrides", () => {
    const env = buildPtyEnvironment({ OPENAI_API_KEY: "synthetic-key", OPENAI_BASE_URL: "https://provider.invalid", CODEBRAIN_MCP_PORT: "61011" }, { OPENAI_BASE_URL: "http://127.0.0.1:9000", CUSTOM_PANE_FLAG: "explicit" }, "linux");
    expect(env.OPENAI_API_KEY).toBe("synthetic-key");
    expect(env.OPENAI_BASE_URL).toBe("http://127.0.0.1:9000");
    expect(env.CODEBRAIN_MCP_PORT).toBe("61011");
    expect(env.CUSTOM_PANE_FLAG).toBe("explicit");
    expect(env.TERM).toBe("xterm-256color");
  });
});
