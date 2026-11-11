// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), existsSync: vi.fn(() => false) }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
import { startSsmTunnel } from "./ssm-tunnel";

const config = { instanceId: "i-0123456789abcdef0", region: "sa-east-1", profile: "fixture", localPort: 2221 };
function child() {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), pid: undefined });
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe("SSM tunnel", () => {
  it("waits for the CLI port-forward confirmation and uses argv without a shell", async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const pending = startSsmTunnel(config, 22);
    process.stdout.emit("data", Buffer.from("Port 2221 opened for sessionId test"));
    expect(await pending).toBe(process);
    expect(mocks.spawn.mock.calls[0][1]).toContain("portNumber=22,localPortNumber=2221");
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true });
  });
  it("fails closed when the CLI exits instead of reusing an unrelated listener", async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const pending = startSsmTunnel(config, 22);
    process.emit("exit", 1);
    await expect(pending).rejects.toMatchObject({ code: "SSM_TUNNEL_FAILED" });
  });
});
