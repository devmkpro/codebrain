import { describe, expect, it } from "vitest";
import {
  nativeToolsForRole,
  withCodexDeveloperInstructions,
  withEffort,
  withNativeToolAllowlist,
  withSkillWhitelist,
} from "./native-tools";

describe("withEffort", () => {
  it("preserves Codex config overrides in long equals form", () => {
    const args = ['--config=model_reasoning_effort="low"'];
    expect(withEffort(args, "codex", "high")).toEqual(args);
  });
  it("uses each CLI's own flag", () => {
    expect(withEffort([], "claude", "high")).toEqual(["--effort", "high"]);
    expect(withEffort([], "openclaude", "high")).toEqual(["--effort", "high"]);
    expect(withEffort([], "codex", "low")).toEqual(["-c", 'model_reasoning_effort="low"']);
  });

  it("leaves other CLIs, missing or unknown values and explicit flags alone", () => {
    expect(withEffort([], "gemini-cli", "high")).toEqual([]);
    expect(withEffort([], "claude", undefined)).toEqual([]);
    expect(withEffort([], "claude", "high; rm -rf")).toEqual([]);
    expect(withEffort(["--effort", "low"], "claude", "high")).toEqual(["--effort", "low"]);
    expect(withEffort(["-c", 'model_reasoning_effort="low"'], "codex", "high")).toEqual(["-c", 'model_reasoning_effort="low"']);
  });
});

describe("withSkillWhitelist", () => {
  it("denies every installed skill outside the whitelist", () => {
    expect(withSkillWhitelist([], "claude", ["a"], ["a", "b", "c"])).toEqual(["--disallowedTools", "Skill(b),Skill(c)"]);
  });

  it("does nothing without a whitelist or on other CLIs", () => {
    expect(withSkillWhitelist([], "claude", [], ["a"])).toEqual([]);
    expect(withSkillWhitelist([], "codex", ["a"], ["a", "b"])).toEqual([]);
  });
});

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

  it("preserves an explicit Codex developer prompt in --config= form", () => {
    const args = ['--config=developer_instructions="mine"'];
    expect(withCodexDeveloperInstructions(args, "new")).toEqual(args);
  });
});
