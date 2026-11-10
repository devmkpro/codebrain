import { describe, expect, it } from "vitest";

import {
  PANE_ACTIVITIES,
  activityClockKey,
  classifyTerminalOutput,
  derivePaneActivity,
  formatElapsed,
  statusPresentation,
  stripTerminalControls,
  toPaneStatus,
  type PaneActivity,
} from "./pane-status";

describe("derivePaneActivity", () => {
  it("does not call a live process with no output working", () => {
    expect(derivePaneActivity({ status: "running" })).toBe("idle");
  });

  it("uses the live signal while the process runs", () => {
    expect(derivePaneActivity({ status: "running", live: "thinking" })).toBe("thinking");
    expect(derivePaneActivity({ status: "running", live: "running" })).toBe("running");
  });

  it("treats booting and waking as execution", () => {
    expect(derivePaneActivity({ status: "booting" })).toBe("running");
    expect(derivePaneActivity({ status: "waking" })).toBe("running");
  });

  it("maps hibernated and unknown values to idle", () => {
    expect(derivePaneActivity({ status: "hibernated" })).toBe("idle");
    expect(derivePaneActivity({ status: 42 })).toBe("idle");
    expect(derivePaneActivity(null)).toBe("idle");
  });

  it("splits process exit by exit code", () => {
    expect(derivePaneActivity({ status: "exited", exitCode: 0 })).toBe("done");
    expect(derivePaneActivity({ status: "exited", exitCode: 1 })).toBe("failed");
    expect(derivePaneActivity({ status: "error" })).toBe("failed");
  });

  it("lets waiting win over any activity, but not over a dead process", () => {
    expect(derivePaneActivity({ status: "running", live: "waiting" })).toBe("waiting");
    expect(derivePaneActivity({ status: "running", awaitingInput: true, handoffStatus: "done" })).toBe("waiting");
    expect(derivePaneActivity({ status: "needs_input" })).toBe("waiting");
    expect(derivePaneActivity({ status: "exited", exitCode: 0, live: "waiting" })).toBe("done");
  });

  it("reads the handoff once the pane is quiet", () => {
    expect(derivePaneActivity({ status: "running", handoffStatus: "done" })).toBe("done");
    expect(derivePaneActivity({ status: "running", handoffStatus: "blocked" })).toBe("blocked");
    expect(derivePaneActivity({ status: "running", handoffStatus: "error" })).toBe("failed");
    expect(derivePaneActivity({ status: "running", handoffStatus: "done", contractStatus: "failed" })).toBe("failed");
  });

  it("shows work again after a pane that delivered resumes", () => {
    expect(derivePaneActivity({ status: "running", handoffStatus: "done", live: "thinking" })).toBe("thinking");
  });
});

describe("vocabulary", () => {
  it("defines the seven states in Portuguese", () => {
    const labels = Object.values(PANE_ACTIVITIES).map((item) => item.label);
    expect(labels.sort()).toEqual(
      ["aguardando você", "bloqueado", "concluído", "executando", "falhou", "ocioso", "pensando"],
    );
  });

  it("uses tokens for every color, and moves only active states", () => {
    for (const presentation of Object.values(PANE_ACTIVITIES)) {
      expect(presentation.color).toMatch(/^var\(--cb-/);
    }
    const moving = (Object.keys(PANE_ACTIVITIES) as PaneActivity[]).filter(
      (key) => PANE_ACTIVITIES[key].motion !== "none",
    );
    expect(moving.sort()).toEqual(["running", "thinking", "waiting"]);
  });

  it("marks only waiting as urgent", () => {
    const urgent = (Object.keys(PANE_ACTIVITIES) as PaneActivity[]).filter((key) => PANE_ACTIVITIES[key].urgent);
    expect(urgent).toEqual(["waiting"]);
  });

  it("keeps thinking and running on the same clock", () => {
    expect(activityClockKey("thinking")).toBe(activityClockKey("running"));
    expect(activityClockKey("waiting")).not.toBe(activityClockKey("running"));
  });
});

describe("classifyTerminalOutput", () => {
  it("keeps actual Codex Working active through silence and the idle-looking footer", () => {
    const output = "\x1b[1mWorking\x1b[0m (1m 35s • \x1b[1mesc\x1b[0m to interrupt)\r\n\r\n› \x1b[2mAsk Codex to do anything\x1b[0m";
    expect(classifyTerminalOutput("codex", output, false)).toBe("thinking");
    expect(classifyTerminalOutput("codex", output, true)).toBe("thinking");
  });

  it("does not keep old Working active after a real completed prompt", () => {
    const output = "Working (1m 35s • esc to interrupt)\r\n› Ask Codex to do anything\r\n─ Worked for 1m 37s ─\r\n› Ask Codex to do anything";
    expect(classifyTerminalOutput("codex", output, false)).toBe(null);
    expect(classifyTerminalOutput("codex", output, true)).toBe(null);
  });

  it("respects ANSI erasure of the old spinner before returning to the prompt", () => {
    const output = "Working (1m 35s • esc to interrupt)\r\n› Ask Codex to do anything\x1b[1A\r\x1b[2K\x1b[1B\r› Ask Codex to do anything";
    expect(classifyTerminalOutput("codex", output, false)).toBe(null);
    expect(classifyTerminalOutput("codex", "Working (2s • esc to interrupt)\x1b[H\x1b[2J› ", true)).toBe(null);
  });

  it("recognizes persistent spinner and unfinished progress without recent bytes", () => {
    expect(classifyTerminalOutput("codex", "⠹ Working…\r\n› Ask Codex to do anything", false)).toBe("thinking");
    expect(classifyTerminalOutput("codex", "Downloading model 45%\r\n› Ask Codex to do anything", false)).toBe("running");
    expect(classifyTerminalOutput("codex", "Downloading model 100%\r\n› Ask Codex to do anything", false)).toBe(null);
  });

  it("keeps a real approval newer than Working in the waiting state", () => {
    const output = "Working (1s • esc to interrupt)\r\nDo you want to run this command?\r\n❯ 1. Yes";
    expect(classifyTerminalOutput("codex", output, false)).toBe("waiting");
  });

  it("finds a question on screen even without recent output", () => {
    expect(classifyTerminalOutput("claude", "Do you want to proceed?\n❯ 1. Yes\n  2. No", false)).toBe("waiting");
    expect(classifyTerminalOutput("shell", "Overwrite file? [y/N] ", false)).toBe("waiting");
  });

  it("ignores a question the CLI has moved past", () => {
    expect(classifyTerminalOutput("claude", "Do you want to proceed?\n1. Yes\n✻ Working… (esc to interrupt)", true)).toBe("thinking");
  });

  it("reads through ANSI sequences", () => {
    expect(classifyTerminalOutput("claude", "\x1b[1mDo you want\x1b[0m to \x1b[33mproceed?\x1b[0m", false)).toBe("waiting");
  });

  it("separates tool use from thinking on AI CLIs", () => {
    expect(classifyTerminalOutput("claude", "⏺ Bash(npm test)", true)).toBe("running");
    expect(classifyTerminalOutput("claude", "✻ Pondering…", true)).toBe("thinking");
  });

  it("treats shell output as execution and silence as no signal", () => {
    expect(classifyTerminalOutput("shell", "compiling…", true)).toBe("running");
    expect(classifyTerminalOutput("claude", "tudo pronto", false)).toBe(null);
  });
});

describe("helpers", () => {
  it("formats elapsed time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(42_000)).toBe("0:42");
    expect(formatElapsed(725_000)).toBe("12:05");
    expect(formatElapsed(3_720_000)).toBe("1h02");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("strips OSC and control characters", () => {
    expect(stripTerminalControls("\x1b]0;titulo\x07ok\x07\n")).toBe("ok\n");
  });

  it("keeps the raw-string API working for status readers", () => {
    expect(toPaneStatus("running")).toBe("running");
    expect(toPaneStatus("blocked")).toBe("blocked");
    expect(toPaneStatus("nope")).toBe("unknown");
    expect(statusPresentation("error")).toEqual({ color: "var(--cb-agent-failed)", label: "falhou", pulse: false });
    expect(statusPresentation("running").pulse).toBe(true);
  });
});
