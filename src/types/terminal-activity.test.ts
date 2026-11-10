import { describe, expect, it } from "vitest";
import { readTerminalActivity, terminalStatusText } from "./terminal-activity";

describe("shared terminal activity projection", () => {
  it("handles cursor movement and line erasure without retaining a historical spinner", () => {
    const raw = "Working (5s • esc to interrupt)\r\n› Ask Codex to do anything\x1b[1A\r\x1b[2K\x1b[1B";
    expect(readTerminalActivity(raw).active).toBe(null);
    expect(terminalStatusText(raw)).not.toContain("Working");
  });

  it("removes an old turn on a full TUI repaint", () => {
    const raw = "Working (5s • esc to interrupt)\x1b[H\x1b[2J› Ask Codex to do anything";
    expect(readTerminalActivity(raw).active).toBe(null);
    expect(terminalStatusText(raw)).toBe("› Ask Codex to do anything");
  });

  it("recognizes a new Working turn after a previous completion", () => {
    const raw = "─ Worked for 2s ─\r\n› Ask Codex to do anything\r\nWorking (1s • esc to interrupt)\r\n› Ask Codex to do anything";
    expect(readTerminalActivity(raw).active).toBe("thinking");
  });

  it("preserves progress and spinner states through color and synchronized-output controls", () => {
    expect(readTerminalActivity("\x1b[?2026h\x1b[36m⠹ Working…\x1b[0m\x1b[?2026l").active).toBe("thinking");
    expect(readTerminalActivity("Installing 30%\r\x1b[2KInstalling 45%").active).toBe("running");
  });

  it("does not keep an old progress percentage active after reaching 100 percent", () => {
    expect(readTerminalActivity("Downloading model 45%\r\nDownloading model 100%\r\n› Ask Codex to do anything").active).toBe(null);
  });

  it.each([
    "> Kiro is working · Type to queue",
    "> Kiro is working · 1m 35s · Type to steer · ctrl+s to queue",
    "> Kiro is working · Type to queue · ctrl+s to steer",
  ])("recognizes the installed Kiro RZ() working placeholder without a spinner: %s", (text) => {
    expect(readTerminalActivity(`\x1b[36m${text}\x1b[0m\r\n/copy to clipboard`).active).toBe("thinking");
  });

  it("keeps initialization active and ends Kiro activity only after a real idle input returns", () => {
    expect(readTerminalActivity("> Initializing · type to queue a message\r\n/copy to clipboard").active).toBe("running");
    const busy = "> Kiro is working · Type to queue\r\n/copy to clipboard";
    const idle = "> ask a question or describe a task ↵\r\n/copy to clipboard";
    expect(readTerminalActivity(`${busy}\x1b[H\x1b[2J${idle}`).active).toBe(null);
    expect(readTerminalActivity(`${busy}\r\n${idle}`).active).toBe(null);
    expect(readTerminalActivity(`${idle}\r\n> Kiro is working · Type to steer · ctrl+s to queue`).active).toBe("thinking");
    expect(readTerminalActivity(`Quoted text says Kiro is working, not a TUI input.\r\n${idle}`).active).toBe(null);
  });
});
