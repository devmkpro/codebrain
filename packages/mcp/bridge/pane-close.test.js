// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createPaneHandlers } from "./pane-handlers.js";

describe("closing panes", () => {
  it("terminates the process and removes the visible pane", async () => {
    const live = new Set(["ssh"]);
    const pty = Object.assign(new EventEmitter(), {
      hasPane: (id) => live.has(id), list: () => [],
      kill: vi.fn((id) => live.delete(id)),
    });
    const emitToRenderer = vi.fn();
    const paneConfigs = new Map([["ssh", { label: "SSH · host" }]]);
    const api = createPaneHandlers(pty, { emitToRenderer, paneConfigs });
    await api.killPaneCascade("ssh");
    expect(pty.kill).toHaveBeenCalledWith("ssh");
    expect(emitToRenderer).toHaveBeenCalledWith("pane:removed", { paneId: "ssh" });
    expect(paneConfigs.has("ssh")).toBe(false);
    await expect(api.killPaneCascade("missing")).rejects.toThrow("pane not found");
  });
  it("removes a visible pane even if its SSH process already exited", async () => {
    const pty = Object.assign(new EventEmitter(), { hasPane: () => false, list: () => [], kill: vi.fn() });
    const emitToRenderer = vi.fn();
    const api = createPaneHandlers(pty, { emitToRenderer, paneConfigs: new Map([["dead", {}]]) });
    await api.killPaneCascade("dead");
    expect(pty.kill).not.toHaveBeenCalled();
    expect(emitToRenderer).toHaveBeenCalledWith("pane:removed", { paneId: "dead" });
  });
  it("keeps an exited SSH pane discoverable by host and label until closed", async () => {
    const pty = Object.assign(new EventEmitter(), { hasPane: () => false, list: () => [], kill: vi.fn() });
    const paneConfigs = new Map([["dead", { sshHostId: "host-1", agent: "shell", cwd: "/work", label: "SSH · example", ownerPaneId: "owner" }]]);
    const api = createPaneHandlers(pty, { paneConfigs });
    expect(await api.listPanes(new Map())).toEqual([expect.objectContaining({
      paneId: "dead", sshHostId: "host-1", label: "SSH · example", status: "exited", ownerPaneId: "owner",
    })]);
  });
});
