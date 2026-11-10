// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ options: null as any, send: vi.fn(), dialog: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => "C:/fixture" }, dialog: { showMessageBox: mocks.dialog }, safeStorage: {} }));
vi.mock("../context", () => ({ safeSend: mocks.send }));
vi.mock("./access-vault", () => ({
  AccessVaultError: class extends Error {},
  createAccessVault: (options: any) => { mocks.options = options; return {}; },
}));
import { getAccessVault } from "./access-vault-runtime";

describe("SSH pane registration", () => {
  it("bypasses repeated prompts only for hosts and credentials already authorized by the user", async () => {
    getAccessVault({} as any);
    expect(await mocks.options.approveAgentConnection({ allowAgentAccess: true }, null)).toBe(true);
    expect(await mocks.options.approveAgentConnection({ allowAgentAccess: true }, { allowAgentAccess: true })).toBe(true);
    expect(await mocks.options.approveAgentConnection({ allowAgentAccess: false }, null)).toBe(false);
    expect(await mocks.options.approveAgentConnection({ allowAgentAccess: true }, { allowAgentAccess: false })).toBe(false);
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
  it("registers the SSH terminal in the same workspace for UI and agent discovery", async () => {
    const ctx = {
      mainWindow: { isDestroyed: () => false }, currentWorkspacePath: "D:/fixture-project",
      ptyManager: { spawn: vi.fn().mockResolvedValue("ssh-fixture") },
      paneConfigs: new Map(), paneRegistry: new Map(),
    } as any;
    getAccessVault(ctx);
    await mocks.options.openSshPane({ executable: "ssh", args: ["--", "fixture"], label: "Fixture", hostId: "fixture" });
    expect(ctx.paneRegistry.get("ssh-fixture")).toMatchObject({ paneId: "ssh-fixture", cwd: ctx.currentWorkspacePath });
    expect(ctx.paneConfigs.get("ssh-fixture")).toMatchObject({ workspacePath: ctx.currentWorkspacePath, agent: "shell" });
    expect(ctx.paneConfigs.get("ssh-fixture").ownerPaneId).toBeUndefined();
    await mocks.options.openSshPane({ executable: "ssh", args: ["--", "fixture"], label: "Fixture", hostId: "fixture", ownerPaneId: "agent-1" });
    expect(ctx.paneConfigs.get("ssh-fixture")).toMatchObject({ ownerPaneId: "agent-1" });
    expect(mocks.send).toHaveBeenCalledWith(ctx, "pane:added", expect.objectContaining({ paneId: "ssh-fixture", workspacePath: ctx.currentWorkspacePath }));
  });
});
