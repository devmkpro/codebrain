"use strict";

/**
 * Browser control bridge handlers.
 */
function createBrowserHandlers(opts) {
  async function browserCmd(type, payload = {}) {
    if (!opts.sendBrowserCmd) throw new Error("browser control not available");
    const paneId = opts.resolveBrowserPaneId ? opts.resolveBrowserPaneId(payload.paneId) : payload.paneId;
    if (!paneId) throw new Error("no browser pane found");
    const { paneId: _, ...cmdPayload } = payload;
    return opts.sendBrowserCmd(paneId, { type, ...cmdPayload });
  }

  return {
    async browserNavigate(url, paneId) { return browserCmd("navigate", { url, paneId }); },
    async browserOpen(url) {
      if (!opts.createBrowserPane) throw new Error("browser pane creation not available");
      return opts.createBrowserPane(url);
    },
    async browserBack(paneId) { return browserCmd("back", { paneId }); },
    async browserForward(paneId) { return browserCmd("forward", { paneId }); },
    async browserReload(hard, paneId) { return browserCmd("reload", { hard, paneId }); },
    async browserGetHtml(selector, paneId) { return browserCmd("get-html", { selector, paneId }); },
    async browserGetText(selector, paneId) { return browserCmd("get-text", { selector, paneId }); },
    async browserGetA11yTree(maxDepth, maxNodes, paneId) { return browserCmd("get-a11y-tree", { maxDepth, maxNodes, paneId }); },
    async browserFindByText(text, role, exact, paneId) { return browserCmd("find-by-text", { text, role, exact, paneId }); },
    async browserGetElement(selector, paneId) { return browserCmd("get-element", { selector, paneId }); },
    async browserGetUrl(paneId) { return browserCmd("get-url", { paneId }); },
    async browserClick(selector, paneId) { return browserCmd("click", { selector, paneId }); },
    async browserFill(selector, value, clearFirst, paneId) { return browserCmd("fill", { selector, value, clearFirst, paneId }); },
    async browserSelect(selector, valueOrText, paneId) { return browserCmd("select", { selector, valueOrText, paneId }); },
    async browserCheck(selector, checked, paneId) { return browserCmd("check", { selector, checked, paneId }); },
    async browserClear(selector, paneId) { return browserCmd("clear", { selector, paneId }); },
    async browserFocus(selector, paneId) { return browserCmd("focus", { selector, paneId }); },
    async browserHover(selector, paneId) { return browserCmd("hover", { selector, paneId }); },
    async browserClickAt(x, y, button, paneId) { return browserCmd("click-at", { x, y, button, paneId }); },
    async browserHoverAt(x, y, paneId) { return browserCmd("hover-at", { x, y, paneId }); },
    async browserDrag(x1, y1, x2, y2, steps, paneId) { return browserCmd("drag", { x1, y1, x2, y2, steps, paneId }); },
    async browserScroll(selector, direction, amount, paneId) { return browserCmd("scroll", { selector, direction, amount, paneId }); },
    async browserType(text, delayMs, paneId) { return browserCmd("type", { text, delayMs, paneId }); },
    async browserKey(key, paneId) { return browserCmd("key", { key, paneId }); },
    async browserShortcut(keys, paneId) { return browserCmd("shortcut", { keys, paneId }); },
    async browserWaitFor(selector, timeoutMs, paneId) { return browserCmd("wait-for", { selector, timeoutMs, paneId }); },
    async browserWaitForText(text, selector, timeoutMs, paneId) { return browserCmd("wait-for-text", { text, selector, timeoutMs, paneId }); },
    async browserWaitForUrl(pattern, timeoutMs, paneId) { return browserCmd("wait-for-url", { pattern, timeoutMs, paneId }); },
    async browserWaitForLoad(timeoutMs, paneId) { return browserCmd("wait-for-load", { timeoutMs, paneId }); },
    async browserScreenshot(fullPage, paneId) {
      if (!opts.saveScreenshot) throw new Error("screenshot not available");
      return opts.saveScreenshot(paneId, fullPage);
    },
    async browserScreenshotElement(selector, paneId) {
      if (!opts.saveScreenshotElement) throw new Error("screenshot not available");
      return opts.saveScreenshotElement(selector, paneId);
    },
    async browserAnnotate(path, annotations) { return { ok: true, path, note: "annotation not yet implemented" }; },
    async browserEval(javascript, paneId) { return browserCmd("eval", { javascript, paneId }); },
    async browserClickText(text, role, paneId) { return browserCmd("click-text", { text, role, paneId }); },
    async browserFillForm(fields, paneId) { return browserCmd("fill-form", { fields, paneId }); },
    async browserPageSummary(paneId) { return browserCmd("page-summary", { paneId }); },
    async browserConsoleLog(level, sinceMs, limit, paneId) {
      if (!opts.getConsoleLog) throw new Error("console log not available");
      return { ok: true, entries: opts.getConsoleLog(paneId, level, sinceMs, limit) };
    },
    async browserClearConsole() {
      if (opts.clearBrowserLogs) opts.clearBrowserLogs();
      return { ok: true };
    },
    async browserNetworkLog(urlFilter, method, status, sinceMs, limit, paneId) {
      if (!opts.getNetworkLog) throw new Error("network log not available");
      return { ok: true, entries: opts.getNetworkLog(paneId, urlFilter, method, status, sinceMs, limit) };
    },
    async browserNetworkWait(pattern, method, timeoutMs) {
      if (!opts.sendBrowserCmd) throw new Error("browser control not available");
      const timeout = timeoutMs || 10000;
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          const entries = opts.getNetworkLog ? opts.getNetworkLog() : [];
          const found = entries.find(e => {
            const urlMatch = e.url?.includes(pattern) || e.data?.includes(pattern);
            const methodMatch = !method || e.method === method.toUpperCase();
            return urlMatch && methodMatch;
          });
          if (found) { resolve({ ok: true, entry: found, timedOut: false }); return; }
          if (Date.now() - start > timeout) { resolve({ ok: true, entry: null, timedOut: true }); return; }
          setTimeout(check, 300);
        };
        check();
      });
    },
    async browserClearNetwork() {
      if (opts.clearBrowserLogs) opts.clearBrowserLogs();
      return { ok: true };
    },
  };
}

module.exports = { createBrowserHandlers };
