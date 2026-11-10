import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";

const harness = vi.hoisted(() => ({
  terminals: [] as any[], frames: [] as FrameRequestCallback[],
  updatePane: vi.fn(), resize: vi.fn(), spawn: vi.fn(),
  output: (_id: string, _data: string, _echo?: boolean) => {},
}));
vi.mock("../../stores/providers-store", () => ({ X$1: () => null }));
vi.mock("../../stores/voice-store", () => ({ spawnedPaneIds: new Set(), openWebLink: vi.fn(), usePushToTalk: () => ({ handleKeyEvent: () => false }) }));
vi.mock("../../stores/panes-store", () => ({ usePanesStore: (selector: any) => selector({ updatePane: harness.updatePane }) }));
vi.mock("../panes/PaneHeader", () => ({ PaneHeader: () => null }));
vi.mock("../panes/PaneIdBadge", () => ({ PaneIdBadge: () => null }));
vi.mock("../panes/PaneTokenBadge", () => ({ PaneTokenBadge: () => null }));
vi.mock("../panes/MissionBadge", () => ({ MissionBadge: () => null }));
vi.mock("../panes/SavedContextPanel", () => ({ SavedContextPanel: () => null }));
vi.mock("./xterm-theme", () => ({ terminalThemeFromTokens: () => ({}), observeTokenTheme: () => () => {}, useBrandTerminalFont: (_id: string, stack: string) => stack }));
vi.mock("../../lib/xterm-exports", () => ({
  xtermExports: { Terminal: class {
    cols = 80; rows = 24; element = document.createElement("div");
    options: any; buffer = { active: { viewportY: 0, baseY: 0 } };
    write = vi.fn((_text: string, callback?: () => void) => callback?.());
    writeln = vi.fn(); refresh = vi.fn(); focus = vi.fn(); dispose = vi.fn();
    scrollToBottom = vi.fn(); onData = vi.fn(); attachCustomKeyEventHandler = vi.fn();
    getSelection = () => "";
    constructor(options: any) { this.options = options; harness.terminals.push(this); }
    loadAddon(addon: any) { addon.activate?.(this); }
    open(element: HTMLElement) { element.append(this.element); }
  } },
  addonFitExports: { FitAddon: class { fit() {} } }, L: class {},
}));

beforeEach(() => {
  vi.useFakeTimers();
  harness.terminals.length = 0;
  harness.frames.length = 0;
  vi.clearAllMocks();
  harness.resize.mockResolvedValue({ ok: true });
  harness.spawn.mockResolvedValue({ ok: true });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { harness.frames.push(callback); return harness.frames.length; });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("codeBrainApp", { pty: {
    spawn: harness.spawn, resize: harness.resize,
    onOutput: (callback: typeof harness.output) => { harness.output = callback; return () => {}; },
    onExit: () => () => {},
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function settleFit() {
  for (let frame = 0; frame < 4; frame++) {
    await act(async () => {
      const callbacks = harness.frames.splice(0);
      callbacks.forEach((callback) => callback(frame * 16));
    });
  }
}

describe("terminal transport synchronization", () => {
  it("does not force the viewport to the bottom while output is streaming", async () => {
    render(<TerminalPane pane={{ id: "reading", agent: "codex", externallySpawned: true }} isActive={false} onClick={() => {}} />);
    await settleFit();
    const term = harness.terminals[0];
    term.buffer.active.baseY = 200;
    term.buffer.active.viewportY = 80;
    term.scrollToBottom.mockClear();
    act(() => {
      harness.output("reading", "new output\r\n");
      harness.output("reading", "\x1b[Hredraw\x1b[6n");
    });
    expect(term.write).toHaveBeenCalledWith("\x1b[Hredraw\x1b[6n");
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it("does not jump to the bottom during delayed fit while reading history", async () => {
    render(<TerminalPane pane={{ id: "reading-fit", agent: "codex", externallySpawned: true }} isActive={false} onClick={() => {}} />);
    const term = harness.terminals[0];
    term.buffer.active.baseY = 200;
    term.buffer.active.viewportY = 80;
    term.scrollToBottom.mockClear();
    await act(async () => { vi.advanceTimersByTime(350); });
    await settleFit();
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });

  it("applies all ANSI output even when an older main labels it as echo", () => {
    render(<TerminalPane pane={{ id: "receiver", agent: "codex", externallySpawned: true }} isActive={false} onClick={() => {}} />);
    const frame = "\x1b[2J\x1b[H[MK MODE]\x1b[24;1Hstatus";
    act(() => harness.output("receiver", frame, true));
    expect(harness.terminals[0].write).toHaveBeenCalledWith(frame);
  });

  it("sends stable fitted dimensions to an externally created PTY, not just the cache", async () => {
    render(<TerminalPane pane={{ id: "external", agent: "codex", externallySpawned: true }} isActive={false} onClick={() => {}} />);
    harness.resize.mockClear();
    await settleFit();
    expect(harness.resize).toHaveBeenCalledWith("external", 80, 24);
  });

  it("creates a local PTY with xterm's dimensions rather than the 220-column default", async () => {
    render(<TerminalPane pane={{ id: "local", agent: "shell" }} isActive={false} onClick={() => {}} />);
    await act(async () => {});
    expect(harness.spawn).toHaveBeenCalledWith(expect.objectContaining({ paneId: "local", cols: 80, rows: 24 }));
  });
});
