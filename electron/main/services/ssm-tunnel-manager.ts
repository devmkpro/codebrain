import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as net from "node:net";
import type { SsmTunnelConfig } from "../../../src/types/access-vault";
import { AccessVaultError } from "./access-vault";
import { loginAwsSso, startSsmTunnel, stopSsmTunnel } from "./ssm-tunnel";

/**
 * Persistent SSM port forwards, owned by the app instead of a terminal pane.
 * A tunnel survives pane exits, is shared by every SSH session to the same
 * host and is restarted in the background when AWS drops it, so opening or
 * reconnecting a terminal only pays the SSH handshake.
 */
export interface SsmTunnelManagerDeps {
  start?: typeof startSsmTunnel;
  stop?: typeof stopSsmTunnel;
  login?: typeof loginAwsSso;
  probe?: (port: number) => Promise<boolean>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type SsmTunnelState = "starting" | "ready" | "reconnecting" | "auth_required" | "failed" | "stopped";

interface Entry {
  key: string;
  config: SsmTunnelConfig;
  remotePort: number;
  child?: ChildProcessWithoutNullStreams;
  pending?: Promise<void>;
  state: SsmTunnelState;
  attempt: number;
  readyAt: number;
  timer?: unknown;
  lastError?: string;
}

export const RESTART_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000];
const STABLE_MS = 60_000;

function probeLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1_500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export function createSsmTunnelManager(deps: SsmTunnelManagerDeps = {}) {
  const start = deps.start ?? startSsmTunnel;
  const stop = deps.stop ?? stopSsmTunnel;
  const login = deps.login ?? loginAwsSso;
  const probe = deps.probe ?? probeLocalPort;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  const entries = new Map<string, Entry>();
  let closed = false;

  const keyOf = (c: SsmTunnelConfig, remotePort: number) =>
    [c.instanceId, c.region, c.profile, c.localPort, remotePort].join("|");

  function supervise(entry: Entry, child: ChildProcessWithoutNullStreams) {
    entry.child = child;
    entry.state = "ready";
    entry.readyAt = now();
    entry.lastError = undefined;
    child.once("close", () => {
      if (entry.child !== child) return;
      entry.child = undefined;
      if (closed || entry.state === "stopped") return;
      // A tunnel that stayed up resets the backoff: AWS idle/session limits are routine.
      if (now() - entry.readyAt >= STABLE_MS) entry.attempt = 0;
      schedule(entry);
    });
  }

  function schedule(entry: Entry) {
    if (closed || entry.timer || entry.pending) return;
    entry.state = "reconnecting";
    const delay = RESTART_DELAYS_MS[Math.min(entry.attempt, RESTART_DELAYS_MS.length - 1)];
    entry.attempt++;
    entry.timer = setTimer(() => {
      entry.timer = undefined;
      // Background restarts never open a browser: an expired SSO waits for the next explicit connect.
      void launch(entry, false).catch(() => undefined);
    }, delay);
  }

  function launch(entry: Entry, interactive: boolean): Promise<void> {
    if (entry.pending) return entry.pending;
    if (entry.timer) { clearTimer(entry.timer); entry.timer = undefined; }
    if (entry.state !== "reconnecting") entry.state = "starting";
    entry.pending = (async () => {
      try {
        let child: ChildProcessWithoutNullStreams;
        try {
          child = await start(entry.config, entry.remotePort);
        } catch (error) {
          if (!(error instanceof AccessVaultError) || error.code !== "SSM_AWS_AUTH_REQUIRED") throw error;
          if (!interactive) { entry.state = "auth_required"; entry.lastError = error.code; throw error; }
          await login(entry.config.profile);
          child = await start(entry.config, entry.remotePort);
        }
        if (closed || entry.state === "stopped") { stop(child); throw new AccessVaultError("SSM_TUNNEL_FAILED", "O túnel SSM foi encerrado."); }
        supervise(entry, child);
      } catch (error) {
        entry.lastError = error instanceof AccessVaultError ? error.code : "SSM_TUNNEL_FAILED";
        const permanent = error instanceof AccessVaultError && [
          "SSM_AWS_AUTH_REQUIRED", "SSM_ACCESS_DENIED", "SSM_PROFILE_NOT_FOUND",
          "SSM_PLUGIN_UNAVAILABLE", "SSM_AWS_CLI_UNAVAILABLE", "SSO_LOGIN_FAILED", "SSM_LOCAL_PORT_IN_USE",
        ].includes(error.code);
        if (entry.state !== "auth_required") entry.state = permanent ? "failed" : entry.state;
        if (!permanent && !closed) { entry.pending = undefined; schedule(entry); }
        throw error;
      } finally {
        entry.pending = undefined;
      }
    })();
    return entry.pending;
  }

  /** Return once the local port forwards to the host, starting or healing the tunnel as needed. */
  async function ensure(config: SsmTunnelConfig, remotePort: number): Promise<void> {
    if (closed) throw new AccessVaultError("SSM_TUNNEL_FAILED", "O aplicativo está encerrando.");
    const key = keyOf(config, remotePort);
    for (const other of entries.values()) {
      if (other.key !== key && other.config.localPort === config.localPort && other.state !== "stopped")
        throw new AccessVaultError("SSM_LOCAL_PORT_IN_USE", "Outro host já usa a mesma porta local de túnel SSM.");
    }
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, config, remotePort, state: "starting", attempt: 0, readyAt: 0 };
      entries.set(key, entry);
    }
    if (entry.child && entry.state === "ready") {
      if (await probe(config.localPort)) return;
      // Process alive but port dead: replace it instead of handing SSH a broken forward.
      const stale = entry.child;
      entry.child = undefined;
      stop(stale);
    }
    entry.attempt = 0;
    if (entry.state === "stopped") entry.state = "starting";
    await launch(entry, true);
  }

  function status() {
    return [...entries.values()].map(e => ({
      instanceId: e.config.instanceId, localPort: e.config.localPort, state: e.state, lastError: e.lastError,
    }));
  }

  function stopAll() {
    closed = true;
    for (const entry of entries.values()) {
      entry.state = "stopped";
      if (entry.timer) { clearTimer(entry.timer); entry.timer = undefined; }
      if (entry.child) { const c = entry.child; entry.child = undefined; stop(c); }
    }
  }

  return { ensure, status, stopAll };
}

export type SsmTunnelManager = ReturnType<typeof createSsmTunnelManager>;
