import * as fs from "node:fs";

const ANSI_PATTERN = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MAX_CAPTURE_CHARS = 200_000;

export interface PendingConversationTurn {
  paneId: string;
  parentId?: string;
  workspace?: string;
  startedAt: number;
  lastInputAt: number;
  output: string;
}

export interface CompletedConversationTurn extends PendingConversationTurn {
  content: string;
  source: "transcript" | "terminal";
}

function eventTime(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Read the final answer emitted by Codex without scraping its TUI. */
export function readCodexFinalAnswer(file: string | undefined, since: number): string | null {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let entry: any;
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      if (eventTime(entry?.timestamp) < since) break;
      const payload = entry?.payload;
      if (entry?.type === "event_msg" && payload?.type === "task_complete" && typeof payload.last_agent_message === "string") {
        const content = payload.last_agent_message.trim();
        if (content) return content;
      }
      if (entry?.type === "response_item" && payload?.role === "assistant" && Array.isArray(payload.content)) {
        const content = payload.content
          .filter((item: any) => item?.type === "output_text" && typeof item.text === "string")
          .map((item: any) => item.text)
          .join("\n")
          .trim();
        if (content) return content;
      }
    }
  } catch {}
  return null;
}

/** Conservative fallback for CLIs that do not expose a structured transcript. */
export function cleanTerminalReply(raw: string): string {
  const clean = raw
    .replace(ANSI_PATTERN, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const ignored = [
    /^\s*(working|thinking|esc to interrupt)\b/i,
    /^\s*(model|directory|permissions)\s*:/i,
    /^\s*(tip|called)\b/i,
    /^\s*[›❯>]\s*$/,
  ];
  const lines: string[] = [];
  for (const value of clean.split("\n")) {
    const line = value.trimEnd();
    if (!line.trim() || ignored.some((pattern) => pattern.test(line))) continue;
    if (lines[lines.length - 1] === line) continue;
    lines.push(line);
  }
  return lines.join("\n").trim().slice(0, 20_000);
}

export class ConversationTurnTracker {
  private pending = new Map<string, PendingConversationTurn>();

  begin(args: { paneId: string; parentId?: string; workspace?: string; now?: number }): void {
    const now = args.now ?? Date.now();
    const current = this.pending.get(args.paneId);
    if (current) {
      current.parentId = args.parentId ?? current.parentId;
      current.workspace = args.workspace ?? current.workspace;
      current.lastInputAt = now;
      return;
    }
    this.pending.set(args.paneId, {
      paneId: args.paneId,
      parentId: args.parentId,
      workspace: args.workspace,
      startedAt: now,
      lastInputAt: now,
      output: "",
    });
  }

  append(paneId: string, data: string): void {
    const turn = this.pending.get(paneId);
    if (!turn || !data) return;
    turn.output = (turn.output + data).slice(-MAX_CAPTURE_CHARS);
  }

  complete(args: { paneId: string; agent?: string; transcriptFile?: string; now?: number; force?: boolean }): CompletedConversationTurn | null {
    const turn = this.pending.get(args.paneId);
    if (!turn) return null;
    const now = args.now ?? Date.now();
    const isCodex = args.agent === "codex";
    const transcriptReply = isCodex ? readCodexFinalAnswer(args.transcriptFile, turn.lastInputAt) : null;
    const terminalReply = !isCodex || args.force || now - turn.lastInputAt >= 8_000
      ? cleanTerminalReply(turn.output)
      : "";
    const content = transcriptReply || terminalReply;
    if (!content) return null;
    this.pending.delete(args.paneId);
    return { ...turn, content, source: transcriptReply ? "transcript" : "terminal" };
  }

  discard(paneId: string): void {
    this.pending.delete(paneId);
  }
}
