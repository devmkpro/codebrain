import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleanTerminalReply, ConversationTurnTracker, readCodexFinalAnswer } from "./conversation-turns";

const files: string[] = [];
afterEach(() => {
  for (const file of files.splice(0)) fs.rmSync(file, { force: true });
});

describe("conversation turns", () => {
  it("reads the exact final answer from a Codex transcript", () => {
    const file = path.join(os.tmpdir(), `codebrain-turn-${Date.now()}.jsonl`);
    files.push(file);
    fs.writeFileSync(file, [
      JSON.stringify({ timestamp: "2026-08-13T19:00:00.000Z", type: "event_msg", payload: { type: "task_complete", last_agent_message: "old" } }),
      JSON.stringify({ timestamp: "2026-08-13T19:01:03.000Z", type: "event_msg", payload: { type: "task_complete", last_agent_message: "Resposta **final**" } }),
    ].join("\n"));
    expect(readCodexFinalAnswer(file, Date.parse("2026-08-13T19:01:00.000Z"))).toBe("Resposta **final**");
  });

  it("keeps a Codex turn pending until a real answer exists", () => {
    const tracker = new ConversationTurnTracker();
    tracker.begin({ paneId: "codex-1", now: 1_000 });
    tracker.append("codex-1", "Working (3s · esc to interrupt)\r\n");
    expect(tracker.complete({ paneId: "codex-1", agent: "codex", now: 4_000 })).toBeNull();
    tracker.append("codex-1", "Resposta pronta\r\n");
    expect(tracker.complete({ paneId: "codex-1", agent: "codex", now: 10_000 })?.content).toBe("Resposta pronta");
  });

  it("removes terminal chrome from provider fallbacks", () => {
    expect(cleanTerminalReply("\x1b[32mWorking\x1b[0m\r\nTip: foo\r\nOlá!\r\nOlá!\r\n")).toBe("Olá!");
  });
});
