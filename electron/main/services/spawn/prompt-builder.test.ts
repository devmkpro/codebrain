import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt-builder";

const temporaryDirs: string[] = [];

function makeContext() {
  return {
    providerStore: { listFull: () => [] },
    ptyManager: { list: () => [] },
    detachedPaneIds: new Set<string>(),
    workspaceConfigStore: { getAccessMode: () => "workspace" },
  } as any;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("prompt builder token budget", () => {
  it.each(["claude", "openclaude", "codex", "gemini-cli", "kimi", "cursor", "copilot"])(
    "keeps the %s worker prompt compact and lazy",
    (agent) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-prompt-"));
      temporaryDirs.push(cwd);
      const promptFile = buildSystemPrompt(makeContext(), {
        paneId: "p1",
        cwd,
        agent,
        role: "worker",
      });
      const prompt = fs.readFileSync(promptFile, "utf8");

      expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(8_000);
      expect(prompt).not.toContain("mcp__codebrain__mcp__codebrain__");
      expect(prompt).toContain("Direct conversation needs no bootstrap");
      expect(prompt).toContain("OK|PART|FAIL|BLOCK");
    }
  );
});
