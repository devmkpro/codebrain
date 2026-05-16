import { ipcMain } from "electron";
import type { AppContext } from "../context";
import {
  sendBrowserCmd,
  getConsoleLog,
  getNetworkLog,
  clearBrowserLogs,
  resolveBrowserPaneId,
  saveScreenshot,
  saveScreenshotElement,
} from "../services/browser";
import { BROWSER_LOG_MAX } from "../services/constants";
import { safeSend } from "../context";

export function registerBrowserHandlers(ctx: AppContext): void {
  // Result from renderer for pending commands
  ipcMain.on("codebrain:browser:result", (_event, payload: { requestId: string; ok: boolean; result?: unknown; error?: string }) => {
    const pending = ctx.browserPending.get(payload.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      ctx.browserPending.delete(payload.requestId);
      pending.resolve({ ok: payload.ok, result: payload.result, error: payload.error });
    }
  });

  ipcMain.on("codebrain:browser:console-entry", (_event, entry: { id: string; timestamp: number; level: string; message: string; source?: string }) => {
    ctx.browserConsoleLog.push(entry);
    if (ctx.browserConsoleLog.length > BROWSER_LOG_MAX) ctx.browserConsoleLog.splice(0, ctx.browserConsoleLog.length - BROWSER_LOG_MAX);
  });

  ipcMain.on("codebrain:browser:network-entry-js", (_event, entry: { id: string; timestamp: number; method: string; url: string; status: number; [key: string]: unknown }) => {
    ctx.browserNetworkLog.push(entry);
    if (ctx.browserNetworkLog.length > BROWSER_LOG_MAX) ctx.browserNetworkLog.splice(0, ctx.browserNetworkLog.length - BROWSER_LOG_MAX);
  });

  ipcMain.on("codebrain:browser:pane-created", (_event, paneId: string) => ctx.browserPaneIds.add(paneId));
  ipcMain.on("codebrain:browser:pane-destroyed", (_event, paneId: string) => ctx.browserPaneIds.delete(paneId));

  const withPane = (paneId: string | undefined, cmd: Record<string, unknown>) => {
    const pid = resolveBrowserPaneId(ctx, paneId);
    if (!pid) return Promise.resolve({ ok: false, error: "no browser pane" });
    return sendBrowserCmd(ctx, pid, cmd).catch(err => ({ ok: false, error: String(err) }));
  };

  ipcMain.handle("browser:navigate", async (_event, url: string, paneId?: string) => withPane(paneId, { type: "navigate", url }));

  ipcMain.handle("browser:open", async (_event, url: string) => {
    try {
      const paneId = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout creating browser pane")), 10000);
        const handler = (_evt: unknown, createdPaneId: string) => {
          clearTimeout(timer);
          ipcMain.off("codebrain:browser:pane-created", handler);
          resolve(createdPaneId);
        };
        ipcMain.on("codebrain:browser:pane-created", handler);
        safeSend(ctx, "codebrain:browser:create-pane", { url });
      });
      ctx.browserPaneIds.add(paneId);
      await new Promise(r => setTimeout(r, 1000));
      const navResult = await sendBrowserCmd(ctx, paneId, { type: "navigate", url });
      return { ...navResult, paneId };
    } catch (err) { return { ok: false, error: String(err) }; }
  });

  ipcMain.handle("browser:back", async (_event, paneId?: string) => withPane(paneId, { type: "back" }));
  ipcMain.handle("browser:forward", async (_event, paneId?: string) => withPane(paneId, { type: "forward" }));
  ipcMain.handle("browser:reload", async (_event, hard?: boolean, paneId?: string) => withPane(paneId, { type: "reload", hard }));

  // DOM reading
  ipcMain.handle("browser:get-html", async (_event, selector?: string, paneId?: string) => withPane(paneId, { type: "get-html", selector }));
  ipcMain.handle("browser:get-text", async (_event, selector?: string, paneId?: string) => withPane(paneId, { type: "get-text", selector }));
  ipcMain.handle("browser:get-a11y-tree", async (_event, maxDepth?: number, maxNodes?: number, paneId?: string) => withPane(paneId, { type: "get-a11y-tree", maxDepth, maxNodes }));
  ipcMain.handle("browser:find-by-text", async (_event, text: string, role?: string, exact?: boolean, paneId?: string) => withPane(paneId, { type: "find-by-text", text, role, exact }));
  ipcMain.handle("browser:get-element", async (_event, selector: string, paneId?: string) => withPane(paneId, { type: "get-element", selector }));
  ipcMain.handle("browser:get-url", async (_event, paneId?: string) => withPane(paneId, { type: "get-url" }));

  // DOM interaction
  ipcMain.handle("browser:click", async (_event, selector: string, paneId?: string) => withPane(paneId, { type: "click", selector }));
  ipcMain.handle("browser:fill", async (_event, selector: string, value: string, clearFirst?: boolean, paneId?: string) => withPane(paneId, { type: "fill", selector, value, clearFirst }));
  ipcMain.handle("browser:select", async (_event, selector: string, valueOrText: string, paneId?: string) => withPane(paneId, { type: "select", selector, valueOrText }));
  ipcMain.handle("browser:check", async (_event, selector: string, checked?: boolean, paneId?: string) => withPane(paneId, { type: "check", selector, checked }));
  ipcMain.handle("browser:clear", async (_event, selector: string, paneId?: string) => withPane(paneId, { type: "clear", selector }));
  ipcMain.handle("browser:focus", async (_event, selector: string, paneId?: string) => withPane(paneId, { type: "focus", selector }));
  ipcMain.handle("browser:hover", async (_event, selector: string, paneId?: string) => withPane(paneId, { type: "hover", selector }));

  // Coordinate interaction
  ipcMain.handle("browser:click-at", async (_event, x: number, y: number, button?: string, paneId?: string) => withPane(paneId, { type: "click-at", x, y, button }));
  ipcMain.handle("browser:hover-at", async (_event, x: number, y: number, paneId?: string) => withPane(paneId, { type: "hover-at", x, y }));
  ipcMain.handle("browser:drag", async (_event, x1: number, y1: number, x2: number, y2: number, steps?: number, paneId?: string) => withPane(paneId, { type: "drag", x1, y1, x2, y2, steps }));
  ipcMain.handle("browser:scroll", async (_event, selector: string | undefined, direction: string, amount: number, paneId?: string) => withPane(paneId, { type: "scroll", selector, direction, amount }));

  // Keyboard
  ipcMain.handle("browser:type", async (_event, text: string, delayMs?: number, paneId?: string) => withPane(paneId, { type: "type", text, delayMs }));
  ipcMain.handle("browser:key", async (_event, key: string, paneId?: string) => withPane(paneId, { type: "key", key }));
  ipcMain.handle("browser:shortcut", async (_event, keys: string, paneId?: string) => withPane(paneId, { type: "shortcut", keys }));

  // Wait/Assert
  ipcMain.handle("browser:wait-for", async (_event, selector: string, timeoutMs?: number, paneId?: string) => withPane(paneId, { type: "wait-for", selector, timeoutMs }));
  ipcMain.handle("browser:wait-for-text", async (_event, text: string, selector?: string, timeoutMs?: number, paneId?: string) => withPane(paneId, { type: "wait-for-text", text, selector, timeoutMs }));
  ipcMain.handle("browser:wait-for-url", async (_event, pattern: string, timeoutMs?: number, paneId?: string) => withPane(paneId, { type: "wait-for-url", pattern, timeoutMs }));
  ipcMain.handle("browser:wait-for-load", async (_event, timeoutMs?: number, paneId?: string) => withPane(paneId, { type: "wait-for-load", timeoutMs }));

  // Screenshots
  ipcMain.handle("browser:screenshot", async (_event, fullPage?: boolean, paneId?: string) => saveScreenshot(ctx, paneId, fullPage));
  ipcMain.handle("browser:screenshot-el", async (_event, selector: string, paneId?: string) => saveScreenshotElement(ctx, selector, paneId));

  // Eval
  ipcMain.handle("browser:eval", async (_event, javascript: string, paneId?: string) => withPane(paneId, { type: "eval", javascript }));

  // Logs
  ipcMain.handle("browser:console-log", async (_event, level?: string, sinceMs?: number, limit?: number, paneId?: string) => {
    const entries = getConsoleLog(ctx, paneId, level, sinceMs, limit);
    return { ok: true, entries, total: ctx.browserConsoleLog.length };
  });
  ipcMain.handle("browser:clear-console", async () => { ctx.browserConsoleLog.length = 0; return { ok: true }; });

  ipcMain.handle("browser:network-log", async (_event, urlFilter?: string, method?: string, status?: string, sinceMs?: number, limit?: number, paneId?: string) => {
    const entries = getNetworkLog(ctx, paneId, urlFilter, method, status, sinceMs, limit);
    return { ok: true, entries, total: ctx.browserNetworkLog.length };
  });
  ipcMain.handle("browser:network-wait", async (_event, pattern: string, method?: string, timeoutMs?: number) => {
    const timeout = timeoutMs || 10000;
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const found = ctx.browserNetworkLog.find(e => {
          const urlMatch = e.url?.includes(pattern) || (e.data as string)?.includes(pattern);
          const methodMatch = !method || e.method === method.toUpperCase();
          return urlMatch && methodMatch;
        });
        if (found) { resolve({ ok: true, entry: found, timedOut: false }); return; }
        if (Date.now() - start > timeout) { resolve({ ok: true, entry: null, timedOut: true }); return; }
        setTimeout(check, 300);
      };
      check();
    });
  });
  ipcMain.handle("browser:clear-network", async () => { ctx.browserNetworkLog.length = 0; return { ok: true }; });

  ipcMain.handle("browser:annotate", async (_event, screenshotPath: string, _annotations: unknown[]) => {
    return { ok: true, path: screenshotPath, note: "annotation not yet implemented" };
  });
}
