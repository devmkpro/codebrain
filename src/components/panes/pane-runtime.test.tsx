import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaneRuntime } from "./pane-runtime";
import { usePanesStore } from "../../stores/panes-store";

let receive: (paneId: string, text: string) => void;
let paneId: string;
let sequence = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  paneId = `codex-status-${sequence++}`;
  usePanesStore.setState({ panes: [{ id: paneId, agent: "codex", status: "running", activitySince: 100_000 }] } as any);
  vi.stubGlobal("codeBrainApp", { pty: {
    onOutput: (callback: typeof receive) => { receive = callback; return () => {}; },
    list: async () => [], getRole: async () => ({ ok: false }),
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const current = () => (usePanesStore.getState() as any).panes.find((pane) => pane.id === paneId);

describe("sidebar terminal activity runtime", () => {
  it("keeps Working active beyond the output timeout without resetting its activity clock", async () => {
    renderHook(usePaneRuntime);
    act(() => receive(paneId, "\x1b[1mWorking\x1b[0m (1m 35s • esc to interrupt)\r\n› Ask Codex to do anything"));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(current().live).toBe("thinking");
    const since = current().activitySince;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(current().live).toBe("thinking");
    expect(current().activitySince).toBe(since);
  });

  it("returns to idle when the real prompt replaces Working, even with fresh output", async () => {
    renderHook(usePaneRuntime);
    act(() => receive(paneId, "Working (1s • esc to interrupt)\r\n› Ask Codex to do anything"));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(current().live).toBe("thinking");
    act(() => receive(paneId, "\x1b[H\x1b[2J› Ask Codex to do anything"));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(current().live).toBe(null);
  });
});
