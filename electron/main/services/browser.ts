import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../context";
import { safeSend } from "../context";

export function sendBrowserCmd(
  ctx: AppContext,
  paneId: string,
  cmd: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    if (!ctx.mainWindow) { reject(new Error("no main window")); return; }
    const requestId = `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      ctx.browserPending.delete(requestId);
      reject(new Error("browser command timeout"));
    }, 30000);
    ctx.browserPending.set(requestId, { resolve: resolve as (v: unknown) => void, timer });
    safeSend(ctx, "codebrain:browser:cmd", { ...cmd, requestId, paneId });
  });
}

export function getNetworkLog(
  ctx: AppContext,
  paneId?: string,
  urlFilter?: string,
  method?: string,
  status?: string,
  sinceMs?: number,
  limit?: number,
) {
  let entries = ctx.browserNetworkLog;
  if (urlFilter) entries = entries.filter(e => e.url.includes(urlFilter));
  if (method) entries = entries.filter(e => e.method === method.toUpperCase());
  if (status) {
    if (status.endsWith("xx")) {
      const prefix = parseInt(status);
      entries = entries.filter(e => Math.floor((e.status as number) / 100) === prefix);
    } else {
      entries = entries.filter(e => e.status === parseInt(status));
    }
  }
  if (sinceMs) entries = entries.filter(e => e.timestamp > Date.now() - sinceMs);
  if (limit) entries = entries.slice(-limit);
  return entries.map(e => {
    const base: Record<string, unknown> = {
      id: e.id,
      timestamp: e.timestamp,
      durationMs: e.durationMs,
      method: e.method,
      url: e.url,
      type: e.type,
      status: e.status,
      statusText: e.statusText,
      ok: e.ok,
      error: e.error,
      requestBody: typeof e.requestBody === "string" ? (e.requestBody as string).substring(0, 2000) : e.requestBody,
      responseBody: typeof e.responseBody === "string" ? (e.responseBody as string).substring(0, 5000) : e.responseBody,
    };
    if (e.type === "ws_send" || e.type === "ws_message" || e.type === "ws_open" || e.type === "ws_close" || e.type === "ws_error") {
      base["wsId"] = e.wsId;
      base["data"] = typeof e.data === "string" ? (e.data as string).substring(0, 5000) : e.data;
      if (e.code !== undefined) base["code"] = e.code;
      if (e.reason) base["reason"] = e.reason;
    }
    return base;
  });
}

export function getConsoleLog(
  ctx: AppContext,
  paneId?: string,
  level?: string,
  sinceMs?: number,
  limit?: number,
) {
  let entries = ctx.browserConsoleLog;
  if (level) entries = entries.filter(e => e.level === level);
  if (sinceMs) entries = entries.filter(e => e.timestamp > Date.now() - sinceMs);
  if (limit) entries = entries.slice(-limit);
  return entries;
}

export function clearBrowserLogs(ctx: AppContext): void {
  ctx.browserNetworkLog.length = 0;
  ctx.browserConsoleLog.length = 0;
}

export function resolveBrowserPaneId(ctx: AppContext, paneId?: string, workspacePath?: string): string | null {
  // If a specific paneId was requested and it exists, use it
  if (paneId && ctx.browserPaneIds.has(paneId)) return paneId;
  if (paneId) return paneId;

  const ids = Array.from(ctx.browserPaneIds);
  if (ids.length === 0) return null;

  // When workspacePath is provided, prefer browser panes from the same workspace
  if (workspacePath) {
    const sameWorkspace = ids.filter(id => ctx.browserPaneWorkspace.get(id) === workspacePath);
    if (sameWorkspace.length > 0) return sameWorkspace[sameWorkspace.length - 1];
  }

  // Fallback: return the last browser pane (original behavior)
  return ids[ids.length - 1];
}

export async function saveScreenshot(
  ctx: AppContext,
  paneId?: string,
  fullPage?: boolean,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const pid = resolveBrowserPaneId(ctx, paneId);
  if (!pid) return { ok: false, error: "no browser pane" };
  try {
    const screenshotDir = path.join(ctx.currentWorkspacePath, ".codebrain", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${Date.now()}.png`);
    const result = await sendBrowserCmd(ctx, pid, { type: "screenshot", fullPage });
    const res = result?.result as { dataUrl?: string } | undefined;
    if (result?.ok && res?.dataUrl) {
      const base64 = res.dataUrl.split(",")[1];
      if (base64) fs.writeFileSync(screenshotPath, Buffer.from(base64, "base64"));
      return { ok: true, path: screenshotPath };
    }
    return { ok: false, error: result?.error || "screenshot failed" };
  } catch (err) { return { ok: false, error: String(err) }; }
}

export async function saveScreenshotElement(
  ctx: AppContext,
  selector: string,
  paneId?: string,
): Promise<{ ok: boolean; path?: string; bounds?: unknown; error?: string }> {
  const pid = resolveBrowserPaneId(ctx, paneId);
  if (!pid) return { ok: false, error: "no browser pane" };
  try {
    const screenshotDir = path.join(ctx.currentWorkspacePath, ".codebrain", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${Date.now()}_${selector.replace(/[^a-zA-Z0-9]/g, "_")}.png`);
    const result = await sendBrowserCmd(ctx, pid, { type: "screenshot-el", selector });
    const res = result?.result as { dataUrl?: string; bounds?: unknown } | undefined;
    if (result?.ok && res?.dataUrl) {
      const base64 = res.dataUrl.split(",")[1];
      if (base64) fs.writeFileSync(screenshotPath, Buffer.from(base64, "base64"));
      return { ok: true, path: screenshotPath, bounds: res.bounds };
    }
    return { ok: false, error: result?.error || "screenshot failed" };
  } catch (err) { return { ok: false, error: String(err) }; }
}
