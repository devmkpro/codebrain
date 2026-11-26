// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AccessVaultError } from "./access-vault";
import { createSsmTunnelManager } from "./ssm-tunnel-manager";

const config = { instanceId: "i-0123456789abcdef0", region: "us-east-1", profile: "fixture", localPort: 2224 };
const child = () => Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), pid: 1 }) as any;

function harness(overrides: Record<string, any> = {}) {
  const timers: Array<() => void> = [];
  let clock = 0;
  const deps = {
    start: vi.fn(async () => child()),
    stop: vi.fn(),
    login: vi.fn(async () => undefined),
    probe: vi.fn(async () => true),
    now: () => clock,
    setTimer: vi.fn((fn: () => void) => { timers.push(fn); return timers.length; }),
    clearTimer: vi.fn(),
    ...overrides,
  };
  const manager = createSsmTunnelManager(deps);
  return { deps, manager, timers, advance: (ms: number) => { clock += ms; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

describe("SSM tunnel manager", () => {
  it("reuses a live tunnel instead of starting a new AWS session", async () => {
    const { deps, manager } = harness();
    await manager.ensure(config, 22);
    await manager.ensure(config, 22);
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(manager.status()[0].state).toBe("ready");
  });

  it("restarts a dropped tunnel in the background", async () => {
    const first = child();
    const second = child();
    const { deps, manager, timers } = harness({ start: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) });
    await manager.ensure(config, 22);
    first.emit("close", 0);
    expect(manager.status()[0].state).toBe("reconnecting");
    timers.shift()!();
    await flush();
    expect(deps.start).toHaveBeenCalledTimes(2);
    expect(manager.status()[0].state).toBe("ready");
  });

  it("replaces a tunnel whose process lives but whose port no longer answers", async () => {
    const stale = child();
    const { deps, manager } = harness({ start: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(child()), probe: vi.fn(async () => false) });
    await manager.ensure(config, 22);
    await manager.ensure(config, 22);
    expect(deps.stop).toHaveBeenCalledWith(stale);
    expect(deps.start).toHaveBeenCalledTimes(2);
  });

  it("logs in to SSO once on an explicit connect and retries", async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new AccessVaultError("SSM_AWS_AUTH_REQUIRED", "expired"))
      .mockResolvedValueOnce(child());
    const { deps, manager } = harness({ start });
    await manager.ensure(config, 22);
    expect(deps.login).toHaveBeenCalledWith("fixture");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("never opens the SSO browser from a background restart", async () => {
    const first = child();
    const start = vi.fn().mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new AccessVaultError("SSM_AWS_AUTH_REQUIRED", "expired"));
    const { deps, manager, timers } = harness({ start });
    await manager.ensure(config, 22);
    first.emit("close", 0);
    timers.shift()!();
    await flush();
    expect(deps.login).not.toHaveBeenCalled();
    expect(manager.status()[0].state).toBe("auth_required");
    expect(timers).toHaveLength(0);
  });

  it("keeps retrying transient failures with backoff", async () => {
    const start = vi.fn().mockRejectedValue(new AccessVaultError("SSM_TUNNEL_TIMEOUT", "slow"));
    const { manager, timers } = harness({ start });
    await expect(manager.ensure(config, 22)).rejects.toThrow();
    expect(timers).toHaveLength(1);
    timers.shift()!();
    await flush();
    expect(timers).toHaveLength(1);
  });

  it("stops every tunnel on shutdown without restarting", async () => {
    const tunnel = child();
    const { deps, manager, timers } = harness({ start: vi.fn().mockResolvedValueOnce(tunnel) });
    await manager.ensure(config, 22);
    manager.stopAll();
    tunnel.emit("close", 0);
    expect(deps.stop).toHaveBeenCalledWith(tunnel);
    expect(timers).toHaveLength(0);
  });

  it("refuses a second host on the same local port", async () => {
    const { manager } = harness();
    await manager.ensure(config, 22);
    await expect(manager.ensure({ ...config, instanceId: "i-0fedcba9876543210" }, 22)).rejects.toMatchObject({ code: "SSM_LOCAL_PORT_IN_USE" });
  });
});
