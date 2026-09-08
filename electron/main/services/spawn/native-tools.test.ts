import { describe, expect, it } from "vitest";
import {
  nativeToolsForRole,
  withCodexDeveloperInstructions,
  withNativeToolAllowlist,
} from "./native-tools";

describe("native Claude-compatible tool allowlists", () => {
  it("keeps orchestrators unable to edit files", () => {
    expect(nativeToolsForRole("orchestrator")).toEqual(["Read", "Grep", "Glob", "TodoWrite"]);
  });

  it("gives workers the implementation tool set", () => {
    expect(withNativeToolAllowlist([], "claude", "worker")).toEqual([
      "--tools",
      "Read,Edit,Write,Grep,Glob,Bash,TodoWrite",
    ]);
  });

  it("covers OpenClaude without changing explicit selections or other CLIs", () => {
    expect(withNativeToolAllowlist(["--tools", "Read"], "claude", "worker")).toEqual([
      "--tools",
      "Read",
    ]);
    expect(withNativeToolAllowlist([], "openclaude", "worker")).toEqual([
      "--tools",
      "Read,Edit,Write,Grep,Glob,Bash,TodoWrite",
    ]);
    expect(withNativeToolAllowlist([], "codex", "worker")).toEqual([]);
    expect(withNativeToolAllowlist([], "gemini-cli", "worker")).toEqual([]);
  });

  it("transports the compact prompt through Codex's supported config key", () => {
    expect(withCodexDeveloperInstructions([], 'line 1\nline "2"')).toEqual([
      "-c",
      'developer_instructions="line 1\\nline \\\"2\\\""',
    ]);
    expect(
      withCodexDeveloperInstructions(["-c", "developer_instructions=existing"], "new")
    ).toEqual(["-c", "developer_instructions=existing"]);
  });
});
