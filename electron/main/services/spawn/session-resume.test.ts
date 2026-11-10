// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nativeResumeArgs, nativeResumeSupport } from "./session-resume";

describe("documented native resume contracts", () => {
  const id = "019a1234-1234-4567-8123-123456789abc";
  it.each([
    ["claude", ["--resume", id]], ["openclaude", ["--resume", id]],
    ["codex", ["resume", id]], ["gemini", ["--resume", id]],
    ["kimi", ["--session", id]], ["cursor", ["--resume", id]],
    ["copilot", [`--resume=${id}`]], ["kiro", ["--resume-id", id]],
    ["opencode", ["--session", id]], ["grok", ["--resume", id]],
    ["antigravity", ["--conversation", id]], ["hermes", ["--resume", id]],
    ["muse", ["resume", id]], ["commandcode", ["--resume", id]],
  ])("%s resumes an explicit identity, never latest", (agent, expected) => {
    expect(nativeResumeArgs(agent as string, [], id)).toEqual(expected);
    expect(nativeResumeSupport(agent as string)?.evidence).toBeTruthy();
  });
  it("preserves configuration arguments and inserts before positional terminator", () => {
    expect(nativeResumeArgs("codex", ["-c", "model=x", "--", "not a flag"], id))
      .toEqual(["-c", "model=x", "resume", id, "--", "not a flag"]);
  });
  it("does not duplicate the same explicit session selection", () => {
    expect(nativeResumeArgs("kiro", ["--resume-id", id], id)).toEqual(["--resume-id", id]);
    expect(nativeResumeArgs("codex", ["resume", id, "--model", "x"], id)).toEqual(["resume", id, "--model", "x"]);
  });
  it.each([["kiro", ["--resume"]], ["codex", ["resume", "--last"]], ["claude", ["--continue"]], ["grok", ["--resume", "other"]], ["muse", ["resume", "other"]], ["claude", ["--fork-session"]]])(
    "rejects conflicting/broad resume arguments for %s", (agent, args) => {
      expect(() => nativeResumeArgs(agent as string, args as string[], id)).toThrow();
    });
  it.each(["", "--last", "latest", "one two", "bad\nvalue", "../session"])("rejects unsafe or non-exact identity %j", value => {
    expect(() => nativeResumeArgs("codex", [], value)).toThrow();
  });
  it.each([["kiro", "-r"], ["opencode", "-s"], ["grok", "-r"], ["claude", "-c"]])("rejects alternative selectors for %s", (agent, alias) => {
    expect(() => nativeResumeArgs(agent, [alias], id)).toThrow();
  });
  it("does not claim support for shell or an unknown harness", () => {
    expect(nativeResumeSupport("shell")).toBeUndefined();
    expect(nativeResumeSupport("__proto__")).toBeUndefined();
    expect(nativeResumeSupport("constructor")).toBeUndefined();
    expect(() => nativeResumeArgs("unknown", [], id)).toThrow();
  });
});
