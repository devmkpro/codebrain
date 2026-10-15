// @vitest-environment node

import { describe, expect, it } from "vitest";
import { waitForTerminalReady } from "./terminal-prompt";

describe("waitForTerminalReady", () => {
  it("waits for real output to become quiet", async () => {
    let output = "";
    setTimeout(() => {
      output = "booting";
    }, 10);
    setTimeout(() => {
      output = "booting\nready >";
    }, 25);

    const result = await waitForTerminalReady(
      () => output,
      () => true,
      {
        timeoutMs: 300,
        quietMs: 30,
        pollMs: 5,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(30);
  });

  it("does not mistake a silent process for a ready prompt", async () => {
    const result = await waitForTerminalReady(
      () => "",
      () => true,
      {
        timeoutMs: 100,
        quietMs: 20,
        pollMs: 5,
      }
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("não ficou pronta");
  });

  it("reports a CLI that exits during startup", async () => {
    const result = await waitForTerminalReady(
      () => "starting",
      () => false,
      {
        timeoutMs: 100,
        quietMs: 20,
        pollMs: 5,
      }
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("encerrou");
  });
});
