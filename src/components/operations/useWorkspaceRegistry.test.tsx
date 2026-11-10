import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRegistry } from "./useWorkspaceRegistry";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("live workspace registry", () => {
  it("updates when a workspace is unlinked and on focus after external deletion", async () => {
    const recent = vi.fn().mockResolvedValue(["/registered", "/removed"]);
    let updated: (event: any) => void = () => {};
    const off = vi.fn();
    vi.stubGlobal("codeBrainApp", { workspaces: { recent }, operations: { onUpdated: (callback: typeof updated) => { updated = callback; return off; } } });
    const { result, unmount } = renderHook(useWorkspaceRegistry);
    await waitFor(() => expect(result.current.recents).toEqual(["/registered", "/removed"]));
    recent.mockResolvedValue(["/registered"]);
    act(() => updated({ workspaceListChanged: true }));
    await waitFor(() => expect(result.current.recents).toEqual(["/registered"]));
    recent.mockResolvedValue([]);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.recents).toEqual([]));
    unmount();
    expect(off).toHaveBeenCalledOnce();
  });

  it("does not let a slow old response revive an unlinked workspace", async () => {
    let resolveOld: (paths: string[]) => void = () => {};
    const recent = vi.fn().mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveOld = resolve; })).mockResolvedValue([]);
    vi.stubGlobal("codeBrainApp", { workspaces: { recent } });
    const { result } = renderHook(useWorkspaceRegistry);
    await act(async () => { await result.current.refresh(); });
    await act(async () => { resolveOld(["/removed"]); });
    expect(result.current.recents).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });
});
