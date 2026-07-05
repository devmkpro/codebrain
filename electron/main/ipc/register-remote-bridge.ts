/**
 * IPC handlers for the Remote Bridge feature.
 *
 * Exposes remote bridge control to the renderer:
 * - Start/stop the WSS server
 * - Get status (running, port, clients, pairing code)
 * - Get current pairing code (for display in UI)
 * - Revoke all tokens
 *
 * The pairing code is also pushed to the renderer via the "remote-bridge:pairCode" event
 * whenever it rotates (every 5 minutes).
 */

import { ipcMain } from "electron";
import type { AppContext } from "../context";

export function registerRemoteBridgeHandlers(ctx: AppContext): void {
  // ── Start remote bridge ─────────────────────────────────────────────────
  ipcMain.handle("remote-bridge:start", async (_event, args?: { port?: number }) => {
    try {
      const bridge = (ctx as any)._mcpBridge;
      if (!bridge?.remoteBridgeStart) return { ok: false, error: "remote bridge not available" };
      return await bridge.remoteBridgeStart(args || {});
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Stop remote bridge ──────────────────────────────────────────────────
  ipcMain.handle("remote-bridge:stop", async () => {
    try {
      const bridge = (ctx as any)._mcpBridge;
      if (!bridge?.remoteBridgeStop) return { ok: false, error: "remote bridge not available" };
      return await bridge.remoteBridgeStop();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get status ──────────────────────────────────────────────────────────
  ipcMain.handle("remote-bridge:status", async () => {
    try {
      const bridge = (ctx as any)._mcpBridge;
      if (!bridge?.remoteBridgeStatus) return { ok: false, error: "remote bridge not available" };
      return await bridge.remoteBridgeStatus();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Get pairing code ────────────────────────────────────────────────────
  ipcMain.handle("remote-bridge:pairCode", async () => {
    try {
      const bridge = (ctx as any)._mcpBridge;
      if (!bridge?.remoteBridgePairCode) return { ok: false, error: "remote bridge not available" };
      return await bridge.remoteBridgePairCode();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Revoke all tokens ───────────────────────────────────────────────────
  ipcMain.handle("remote-bridge:revokeTokens", async () => {
    try {
      const bridge = (ctx as any)._mcpBridge;
      if (!bridge?.remoteBridgeRevokeTokens) return { ok: false, error: "remote bridge not available" };
      return await bridge.remoteBridgeRevokeTokens();
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}
