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
    process.emit("close", 1);
    await expect(pending).rejects.toMatchObject({ code: "SSM_TUNNEL_FAILED" });
  });

  it("retries a disconnected target and opens the same tunnel when SSM reconnects", async () => {
    vi.useFakeTimers();
    const disconnected = child();
    const recovered = child();
    mocks.spawn.mockReturnValueOnce(disconnected).mockReturnValueOnce(recovered);
    const pending = startSsmTunnel(config, 22);
    disconnected.stderr.emit("data", Buffer.from("TargetNot"));
    disconnected.stderr.emit("data", Buffer.from("Connected"));
    disconnected.emit("close", 1);
    await vi.advanceTimersByTimeAsync(2_000);
    recovered.stdout.emit("data", Buffer.from("Port 2221 opened for sessionId ready"));
    await expect(pending).resolves.toBe(recovered);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn.mock.calls[1][1]).toEqual(mocks.spawn.mock.calls[0][1]);
  });

  it.each([
    ["Error loading SSO Token: SECRET", "SSM_AWS_AUTH_REQUIRED"],
    ["AccessDeniedException: SECRET", "SSM_ACCESS_DENIED"],
    ["SessionManagerPlugin is not found: SECRET", "SSM_PLUGIN_UNAVAILABLE"],
    ["bind: Only one usage of each socket address is normally permitted: SECRET", "SSM_LOCAL_PORT_IN_USE"],
  ])("reports a safe error for %s without retrying", async (diagnostic, code) => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const pending = startSsmTunnel(config, 22);
    process.stderr.emit("data", Buffer.from(diagnostic));
    process.emit("close", 1);
    const result = await pending.catch(error => error);
    expect(result.code).toBe(code);
    expect(result.message).not.toContain("SECRET");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
});
