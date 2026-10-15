export interface TerminalReadyOptions {
  timeoutMs?: number;
  quietMs?: number;
  pollMs?: number;
}

export interface TerminalReadyResult {
  ok: boolean;
  waitedMs: number;
  error?: string;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A CLI is ready for programmatic input after it has produced output and that
 * output has stopped changing briefly. This replaces fixed sleeps, which race
 * provider startup, MCP discovery, authentication checks, and slow machines.
 */
export async function waitForTerminalReady(
  readOutput: () => string,
  isAlive: () => boolean,
  options: TerminalReadyOptions = {}
): Promise<TerminalReadyResult> {
  const timeoutMs = Math.max(100, options.timeoutMs ?? 20_000);
  const quietMs = Math.max(50, options.quietMs ?? 800);
  const pollMs = Math.max(10, Math.min(quietMs, options.pollMs ?? 100));
  const startedAt = Date.now();
  let lastOutput = "";
  let changedAt = startedAt;
  let sawOutput = false;

  while (Date.now() - startedAt < timeoutMs) {
    if (!isAlive()) {
      return {
        ok: false,
        waitedMs: Date.now() - startedAt,
        error: "O terminal encerrou antes de aceitar o prompt.",
      };
    }

    const output = readOutput();
    if (output !== lastOutput) {
      lastOutput = output;
      changedAt = Date.now();
      if (output.trim().length > 0) sawOutput = true;
    }

    if (sawOutput && Date.now() - changedAt >= quietMs) {
      return { ok: true, waitedMs: Date.now() - startedAt };
    }
    await delay(pollMs);
  }

  return {
    ok: false,
    waitedMs: Date.now() - startedAt,
    error: "O terminal abriu, mas a CLI não ficou pronta para receber o prompt.",
  };
}
