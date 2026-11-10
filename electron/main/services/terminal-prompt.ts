import { readKiroInput, readTerminalActivity } from "../../../src/types/terminal-activity";

export interface TerminalReadyOptions {
  agent?: string;
  timeoutMs?: number;
  quietMs?: number;
  pollMs?: number;
  /** Observation windows only: never restart the process or resend input. */
  maxAttempts?: number;
}

export interface TerminalReadyResult {
  ok: boolean;
  waitedMs: number;
  attempts?: number;
  /** Set by the transport, not by the readiness observer. No provider ACK implied. */
  promptSubmitted?: boolean;
  deliveryState?: "not_submitted" | "submitted" | "uncertain";
  error?: string;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Kiro requires a visible, stable input prompt, not a quiet welcome banner.
 * Unrelated spinner/status repaint bytes do not reset that prompt's stability.
 * Other harnesses retain the quiet-output fallback, but not while visibly busy.
 * All retries are read-only observation, bounded to at most 60 seconds total.
 */
export async function waitForTerminalReady(
  readOutput: () => string,
  isAlive: () => boolean,
  options: TerminalReadyOptions = {}
): Promise<TerminalReadyResult> {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value! : fallback));
  const timeoutMs = bounded(options.timeoutMs, 20_000, 100, 60_000);
  const quietMs = bounded(options.quietMs, 800, 50, 5000);
  const pollMs = bounded(options.pollMs, 100, 10, Math.min(quietMs, 500));
  const requirePrompt = options.agent === "kiro";
  const maxAttempts = Math.floor(bounded(options.maxAttempts, requirePrompt ? 3 : 1, 1, 3));
  const totalMs = Math.min(60_000, timeoutMs * maxAttempts);
  const startedAt = Date.now();
  let lastOutput = "";
  let changedAt = startedAt;
  let sawOutput = false;
  let prompt = "";
  let promptSince = startedAt;
  const attempts = () => Math.min(maxAttempts, Math.ceil(totalMs / timeoutMs), 1 + Math.floor((Date.now() - startedAt) / timeoutMs));

  while (Date.now() - startedAt < totalMs) {
    if (!isAlive()) {
      return {
        ok: false,
        waitedMs: Date.now() - startedAt,
        attempts: attempts(),
        error: "O terminal encerrou antes de aceitar o prompt.",
      };
    }

    const output = readOutput();
    if (output !== lastOutput) {
      lastOutput = output;
      changedAt = Date.now();
      if (output.trim().length > 0) sawOutput = true;
    }

    const status = readTerminalActivity(output);
    const tail = status.text.trimEnd().split("\n").slice(-12);
    const authOrApproval = /(?:sign\s+in|log\s*in|authenticate|authentication required|authorize|confirm|trust this|\[y\/n\]|\(y\/n\))/i.test(tail.join("\n"));
    const kiro = readKiroInput(status.text);
    const inputPrompt = !status.active && !authOrApproval && kiro?.kind === "ready" ? kiro.prompt : "";
    if (inputPrompt !== prompt) { prompt = inputPrompt; promptSince = Date.now(); }
    const stablePrompt = Boolean(prompt) && Date.now() - promptSince >= quietMs;
    if (requirePrompt ? stablePrompt : sawOutput && !status.active && !authOrApproval && Date.now() - changedAt >= quietMs) {
      return { ok: true, waitedMs: Date.now() - startedAt, attempts: attempts() };
    }
    await delay(Math.min(pollMs, totalMs - (Date.now() - startedAt)));
  }

  return {
    ok: false,
    waitedMs: Date.now() - startedAt,
    attempts: attempts(),
    error: "O terminal abriu, mas a CLI não ficou pronta para receber o prompt.",
  };
}
