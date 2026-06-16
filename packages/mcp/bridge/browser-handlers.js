"use strict";

/**
 * Browser control bridge handlers with CDP proxy pattern.
 *
 * AUTO-DETECTION: When Chrome is running with --remote-debugging-port,
 * all browser commands are routed via CDP (native Chrome). Otherwise,
 * falls back to the embedded Electron webview.
 */

const { createNativeChromeHandlers } = require("./native-chrome-handlers.js");

function createBrowserHandlers(opts) {
  // Persistent storage for active browser pane (webview mode)
  let activeBrowserPaneId = null;

  // ── CDP / Native Chrome state ──────────────────────────────────────────
  let nativeMode = null; // null = not checked, true = CDP, false = webview
  let nativeHandlers = null;
  let cdpCheckPromise = null;
  let lastCdpCheckTime = 0;
  const CDP_RECHECK_INTERVAL_MS = 5000; // re-check every 5s when in webview mode

  /**
   * Lazy CDP detection — checks on first call, and re-checks periodically
   * when in webview mode (so connecting Chrome later is auto-detected).
   */
  async function ensureBrowserMode() {
    // If already in CDP mode and connected, stay there
    const cdpClient = opts.cdpClient;
    if (nativeMode === true && nativeHandlers && cdpClient?.isConnected()) return true;

    // If in webview mode, re-check periodically in case Chrome was launched after startup
    const now = Date.now();
    if (nativeMode === false && now - lastCdpCheckTime < CDP_RECHECK_INTERVAL_MS) {
      return false;
    }

    // Only one concurrent check
    if (cdpCheckPromise) return cdpCheckPromise;

    cdpCheckPromise = (async () => {
      if (!cdpClient) {
        nativeMode = false;
        lastCdpCheckTime = Date.now();
        return false;
      }

      try {
        const det = await cdpClient.detect();
        if (det.available) {
          if (!cdpClient.isConnected()) {
            await cdpClient.connect(det.port);
          }
          nativeHandlers = createNativeChromeHandlers(cdpClient);
          nativeMode = true;
          lastCdpCheckTime = Date.now();
          console.log(
            `[Browser] Native Chrome detected on port ${det.port} — using CDP`
          );
          return true;
        }
      } catch (err) {
        console.log(`[Browser] CDP detection failed: ${err.message}`);
      }

      nativeMode = false;
      lastCdpCheckTime = Date.now();
      if (nativeHandlers) {
        console.log("[Browser] Chrome disconnected — falling back to webview");
        nativeHandlers = null;
      }
      return false;
    })();

    cdpCheckPromise.finally(() => { cdpCheckPromise = null; });
    return cdpCheckPromise;
  }

  async function browserCmd(type, payload) {
    payload = payload || {};

    // Check CDP mode first (lazy)
    const isCdp = await ensureBrowserMode();
    if (isCdp && nativeHandlers) {
      // Map command type to native handler method
      const handlerMap = {
        navigate: () => nativeHandlers.navigate(payload.url),
        back: () => nativeHandlers.back(),
        forward: () => nativeHandlers.forward(),
        reload: () => nativeHandlers.reload(payload.hard),
        "get-html": () => nativeHandlers.getHtml(payload.selector),
        "get-text": () => nativeHandlers.getText(payload.selector),
        "get-url": () => nativeHandlers.getUrl(),
        "get-a11y-tree": () =>
          nativeHandlers.getA11yTree(payload.maxDepth, payload.maxNodes),
        "find-by-text": () =>
          nativeHandlers.findByText(
            payload.text,
            payload.role,
            payload.exact
          ),
        "get-element": () => nativeHandlers.getElement(payload.selector),
        click: () => nativeHandlers.click(payload.selector),
        fill: () =>
          nativeHandlers.fill(
            payload.selector,
            payload.value,
            payload.clearFirst
          ),
        select: () =>
          nativeHandlers.select(payload.selector, payload.valueOrText),
        check: () => nativeHandlers.check(payload.selector, payload.checked),
        clear: () => nativeHandlers.clear(payload.selector),
        focus: () => nativeHandlers.focus(payload.selector),
        hover: () => nativeHandlers.hover(payload.selector),
        "click-at": () =>
          nativeHandlers.clickAt(payload.x, payload.y, payload.button),
        "hover-at": () => nativeHandlers.hoverAt(payload.x, payload.y),
        drag: () =>
          nativeHandlers.drag(
            payload.x1,
            payload.y1,
            payload.x2,
            payload.y2,
            payload.steps
          ),
        scroll: () =>
          nativeHandlers.scroll(
            payload.selector,
            payload.direction,
            payload.amount
          ),
        type: () => nativeHandlers.type(payload.text, payload.delayMs),
        key: () => nativeHandlers.key(payload.key),
        shortcut: () => nativeHandlers.shortcut(payload.keys),
        "wait-for": () =>
          nativeHandlers.waitFor(payload.selector, payload.timeoutMs),
        "wait-for-text": () =>
          nativeHandlers.waitForText(
            payload.text,
            payload.selector,
            payload.timeoutMs
          ),
        "wait-for-url": () =>
          nativeHandlers.waitForUrl(payload.pattern, payload.timeoutMs),
        "wait-for-load": () => nativeHandlers.waitForLoad(payload.timeoutMs),
        eval: () => nativeHandlers.evalJs(payload.javascript),
        "page-summary": () => nativeHandlers.pageSummary(),
      };

      const handler = handlerMap[type];
      if (handler) return handler();

      // Fallback for unmapped commands
      console.warn(`[Browser] No CDP handler for command: ${type}`);
      return { ok: false, error: `Command '${type}' not supported in CDP mode` };
    }

    // ── Webview fallback ────────────────────────────────────────────────
    if (!opts.sendBrowserCmd) throw new Error("browser control not available");
    const paneId = opts.resolveBrowserPaneId
      ? opts.resolveBrowserPaneId(payload.paneId)
      : payload.paneId;
    if (!paneId) throw new Error("no browser pane found");
    const { paneId: _, ...cmdPayload } = payload;
    return opts.sendBrowserCmd(paneId, { type, ...cmdPayload });
  }

  function setActiveBrowserPane(paneId) {
    if (paneId) {
      activeBrowserPaneId = paneId;
      console.log(`[Browser] Active pane: ${paneId}`);
    }
  }

  return {
    // ── Browser mode info ───────────────────────────────────────────────
    async browserMode() {
      await ensureBrowserMode();
      const cdpClient = opts.cdpClient;
      return {
        mode: nativeMode ? "cdp" : "webview",
        port: nativeMode ? cdpClient?.activePort : null,
        connected: nativeMode ? cdpClient?.isConnected() : false,
      };
    },

    async refreshBrowserMode() {
      nativeMode = null;
      cdpCheckPromise = null;
      nativeHandlers = null;
      lastCdpCheckTime = 0; // force immediate re-check
      return this.browserMode();
    },

    // ── Pane management (webview mode) ──────────────────────────────────
    async getBrowserPaneId() {
      return { ok: true, paneId: activeBrowserPaneId };
    },

    // ── Navigation ─────────────────────────────────────────────────────
    async browserNavigate(url, paneId) {
      return browserCmd("navigate", { url, paneId });
    },
    async browserOpen(url) {
      // Check CDP mode first
      let isCdp = await ensureBrowserMode();

      // If not in CDP mode, auto-launch the bundled Chromium
      if (!isCdp && opts.cdpClient) {
        console.log("[Browser] No CDP detected — auto-launching bundled Chromium...");
        try {
          const launched = await opts.cdpClient.launch({ port: 9223 });
          if (launched.ok) {
            // Reset detection state and re-check
            nativeMode = null;
            cdpCheckPromise = null;
            nativeHandlers = null;
            lastCdpCheckTime = 0;
            isCdp = await ensureBrowserMode();
            console.log(`[Browser] Chromium launched (pid ${launched.pid}) — CDP mode: ${isCdp}`);
          } else {
            console.log(`[Browser] Auto-launch failed: ${launched.error}`);
          }
        } catch (err) {
          console.log(`[Browser] Auto-launch error: ${err.message}`);
        }
      }

      // CDP mode: open new tab in Chromium
      if (isCdp && nativeHandlers) {
        const result = await nativeHandlers.tabsCreate(url);
        return { ...result, mode: "cdp" };
      }

      // Fallback: embedded webview pane
      if (!opts.createBrowserPane)
        throw new Error("browser pane creation not available");
      const result = await opts.createBrowserPane(url);
      if (result?.ok && result?.paneId) {
        setActiveBrowserPane(result.paneId);
      }
      return { ...result, mode: "webview" };
    },
    async browserBack(paneId) {
      return browserCmd("back", { paneId });
    },
    async browserForward(paneId) {
      return browserCmd("forward", { paneId });
    },
    async browserReload(hard, paneId) {
      return browserCmd("reload", { hard, paneId });
    },

    // ── DOM Reading ─────────────────────────────────────────────────────
    async browserGetHtml(selector, paneId) {
      return browserCmd("get-html", { selector, paneId });
    },
    async browserGetText(selector, paneId) {
      return browserCmd("get-text", { selector, paneId });
    },
    async browserGetA11yTree(maxDepth, maxNodes, paneId) {
      return browserCmd("get-a11y-tree", { maxDepth, maxNodes, paneId });
    },
    async browserFindByText(text, role, exact, paneId) {
      return browserCmd("find-by-text", { text, role, exact, paneId });
    },
    async browserGetElement(selector, paneId) {
      return browserCmd("get-element", { selector, paneId });
    },
    async browserGetUrl(paneId) {
      return browserCmd("get-url", { paneId });
    },

    // ── DOM Interaction ─────────────────────────────────────────────────
    async browserClick(selector, paneId) {
      return browserCmd("click", { selector, paneId });
    },
    async browserFill(selector, value, clearFirst, paneId) {
      return browserCmd("fill", { selector, value, clearFirst, paneId });
    },
    async browserSelect(selector, valueOrText, paneId) {
      return browserCmd("select", { selector, valueOrText, paneId });
    },
    async browserCheck(selector, checked, paneId) {
      return browserCmd("check", { selector, checked, paneId });
    },
    async browserClear(selector, paneId) {
      return browserCmd("clear", { selector, paneId });
    },
    async browserFocus(selector, paneId) {
      return browserCmd("focus", { selector, paneId });
    },
    async browserHover(selector, paneId) {
      return browserCmd("hover", { selector, paneId });
    },

    // ── Coordinate Interaction ──────────────────────────────────────────
    async browserClickAt(x, y, button, paneId) {
      return browserCmd("click-at", { x, y, button, paneId });
    },
    async browserHoverAt(x, y, paneId) {
      return browserCmd("hover-at", { x, y, paneId });
    },
    async browserDrag(x1, y1, x2, y2, steps, paneId) {
      return browserCmd("drag", { x1, y1, x2, y2, steps, paneId });
    },
    async browserScroll(selector, direction, amount, paneId) {
      return browserCmd("scroll", { selector, direction, amount, paneId });
    },

    // ── Keyboard ───────────────────────────────────────────────────────
    async browserType(text, delayMs, paneId) {
      return browserCmd("type", { text, delayMs, paneId });
    },
    async browserKey(key, paneId) {
      return browserCmd("key", { key, paneId });
    },
    async browserShortcut(keys, paneId) {
      return browserCmd("shortcut", { keys, paneId });
    },

    // ── Wait ───────────────────────────────────────────────────────────
    async browserWaitFor(selector, timeoutMs, paneId) {
      return browserCmd("wait-for", { selector, timeoutMs, paneId });
    },
    async browserWaitForText(text, selector, timeoutMs, paneId) {
      return browserCmd("wait-for-text", {
        text,
        selector,
        timeoutMs,
        paneId,
      });
    },
    async browserWaitForUrl(pattern, timeoutMs, paneId) {
      return browserCmd("wait-for-url", { pattern, timeoutMs, paneId });
    },
    async browserWaitForLoad(timeoutMs, paneId) {
      return browserCmd("wait-for-load", { timeoutMs, paneId });
    },

    // ── Screenshot ─────────────────────────────────────────────────────
    async browserScreenshot(fullPage, paneId) {
      const isCdp = await ensureBrowserMode();
      if (isCdp && nativeHandlers) {
        return nativeHandlers.screenshot(fullPage);
      }
      // Webview mode: use dedicated screenshot function
      if (!opts.saveScreenshot)
        throw new Error("screenshot not available");
      return opts.saveScreenshot(paneId, fullPage);
    },
    async browserScreenshotElement(selector, paneId) {
      const isCdp = await ensureBrowserMode();
      if (isCdp && nativeHandlers) {
        // CDP doesn't have element screenshot — use eval to get bounds, then screenshot
        return { ok: false, error: "Element screenshot not supported in CDP mode — use browser_screenshot with full_page" };
      }
      if (!opts.saveScreenshotElement)
        throw new Error("screenshot not available");
      return opts.saveScreenshotElement(selector, paneId);
    },
    async browserAnnotate(path, annotations) {
      return { ok: true, path, note: "annotation not yet implemented" };
    },

    // ── Eval ───────────────────────────────────────────────────────────
    async browserEval(javascript, paneId) {
      return browserCmd("eval", { javascript, paneId });
    },

    // ── Composite ──────────────────────────────────────────────────────
    async browserClickText(text, role, paneId) {
      return browserCmd("click-text", { text, role, paneId });
    },
    async browserFillForm(fields, paneId) {
      return browserCmd("fill-form", { fields, paneId });
    },
    async browserPageSummary(paneId) {
      return browserCmd("page-summary", { paneId });
    },

    // ── Console & Network ──────────────────────────────────────────────
    async browserConsoleLog(level, sinceMs, limit, paneId) {
      const isCdp = await ensureBrowserMode();
      if (isCdp && nativeHandlers) {
        return {
          ok: true,
          entries: await nativeHandlers.readConsole({ level, limit }),
        };
      }
      if (!opts.getConsoleLog)
        throw new Error("console log not available");
      return {
        ok: true,
        entries: opts.getConsoleLog(paneId, level, sinceMs, limit),
      };
    },
    async browserClearConsole() {
      const isCdp = await ensureBrowserMode();
      if (isCdp && opts.cdpClient) {
        opts.cdpClient.clearEvents();
        return { ok: true };
      }
      if (opts.clearBrowserLogs) opts.clearBrowserLogs();
      return { ok: true };
    },
    async browserNetworkLog(urlFilter, method, status, sinceMs, limit, paneId) {
      const isCdp = await ensureBrowserMode();
      if (isCdp && nativeHandlers) {
        return {
          ok: true,
          entries: await nativeHandlers.readNetwork({
            method,
            url_pattern: urlFilter,
            limit,
          }),
        };
      }
      if (!opts.getNetworkLog)
        throw new Error("network log not available");
      return {
        ok: true,
        entries: opts.getNetworkLog(
          paneId,
          urlFilter,
          method,
          status,
          sinceMs,
          limit
        ),
      };
    },
    async browserNetworkWait(pattern, method, timeoutMs) {
      const isCdp = await ensureBrowserMode();
      if (isCdp && nativeHandlers) {
        // CDP: poll network events
        const timeout = timeoutMs || 10000;
        const start = Date.now();
        return new Promise((resolve) => {
          const check = () => {
            const reqs = nativeHandlers.readNetwork({
              method,
              url_pattern: pattern,
            });
            if (reqs && reqs.length > 0) {
              resolve({ ok: true, entry: reqs[reqs.length - 1], timedOut: false });
              return;
            }
            if (Date.now() - start > timeout) {
              resolve({ ok: true, entry: null, timedOut: true });
              return;
            }
            setTimeout(check, 300);
          };
          check();
        });
      }
      // Webview mode
      if (!opts.sendBrowserCmd)
        throw new Error("browser control not available");
      const timeout = timeoutMs || 10000;
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          const entries = opts.getNetworkLog ? opts.getNetworkLog() : [];
          const found = entries.find((e) => {
            const urlMatch =
              e.url?.includes(pattern) || e.data?.includes(pattern);
            const methodMatch =
              !method || e.method === method.toUpperCase();
            return urlMatch && methodMatch;
          });
          if (found) {
            resolve({ ok: true, entry: found, timedOut: false });
            return;
          }
          if (Date.now() - start > timeout) {
            resolve({ ok: true, entry: null, timedOut: true });
            return;
          }
          setTimeout(check, 300);
        };
        check();
      });
    },
    async browserClearNetwork() {
      const isCdp = await ensureBrowserMode();
      if (isCdp && opts.cdpClient) {
        opts.cdpClient.clearEvents();
        return { ok: true };
      }
      if (opts.clearBrowserLogs) opts.clearBrowserLogs();
      return { ok: true };
    },

    // ── Fetch Interception (CDP Fetch domain) ───────────────────────────
    async browserInterceptRequests(urlPatterns, resourceTypes, handleAuthRequests) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_intercept_requests requires native Chrome (start Chrome with --remote-debugging-port=9222)" };
      }
      return nativeHandlers.interceptRequests({ urlPatterns, resourceTypes, handleAuthRequests });
    },
    async browserContinueRequest(requestId, overrides) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_continue_request requires native Chrome" };
      }
      return nativeHandlers.continueRequest(requestId, overrides);
    },
    async browserFulfillRequest(requestId, response) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_fulfill_request requires native Chrome" };
      }
      return nativeHandlers.fulfillRequest(requestId, response);
    },
    async browserFailRequest(requestId, reason) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_fail_request requires native Chrome" };
      }
      return nativeHandlers.failRequest(requestId, reason);
    },
    async browserContinueResponse(requestId, overrides) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_continue_response requires native Chrome" };
      }
      return nativeHandlers.continueResponse(requestId, overrides);
    },
    async browserStopIntercepting() {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_stop_intercepting requires native Chrome" };
      }
      return nativeHandlers.stopIntercepting();
    },
    async browserGetPausedRequests() {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_get_paused_requests requires native Chrome" };
      }
      return { ok: true, requests: await nativeHandlers.getPausedRequests() };
    },

    // ═══════════════════════════════════════════════════════════════════
    // NOVOS: Ferramentas exclusivas CDP
    // ═══════════════════════════════════════════════════════════════════

    async browserComputer(args) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return {
          ok: false,
          error:
            "browser_computer requires native Chrome (start Chrome with --remote-debugging-port=9222)",
        };
      }
      return nativeHandlers.computer(args);
    },

    async browserFindNaturalLanguage(query, role) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return {
          ok: false,
          error:
            "browser_find requires native Chrome (start Chrome with --remote-debugging-port=9222)",
        };
      }
      return { ok: true, elements: await nativeHandlers.find({ query, role }) };
    },

    async browserTabsList() {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return {
          ok: false,
          error:
            "browser_tabs_list requires native Chrome (start Chrome with --remote-debugging-port=9222)",
        };
      }
      return { ok: true, tabs: await nativeHandlers.tabsContext() };
    },

    async browserTabsCreate(url) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return {
          ok: false,
          error:
            "browser_tabs_create requires native Chrome (start Chrome with --remote-debugging-port=9222)",
        };
      }
      return nativeHandlers.tabsCreate(url);
    },

    async browserTabsClose(tabId) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return {
          ok: false,
          error:
            "browser_tabs_close requires native Chrome (start Chrome with --remote-debugging-port=9222)",
        };
      }
      return nativeHandlers.tabsClose(tabId);
    },

    async browserBatch(actions) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return {
          ok: false,
          error:
            "browser_batch requires native Chrome (start Chrome with --remote-debugging-port=9222)",
        };
      }
      return nativeHandlers.browserBatch(actions);
    },

    // ── Pane persistence (webview mode compat) ─────────────────────────
    async recordBrowserPane(paneId) {
      if (paneId) {
        setActiveBrowserPane(paneId);
        return { ok: true, paneId, message: "Browser pane recorded" };
      }
      return { ok: false, error: "Invalid paneId" };
    },

    async listBrowserPanes() {
      if (!opts.getAllBrowserPanes) return { ok: true, panes: [] };
      const panes = opts.getAllBrowserPanes();
      return { ok: true, panes, activePaneId: activeBrowserPaneId };
    },

    async clearBrowserPaneCache() {
      activeBrowserPaneId = null;
      return { ok: true, message: "Browser pane cache cleared" };
    },

    // ── Auto-launch Chrome ─────────────────────────────────────────────
    async browserLaunch({ url, port } = {}) {
      const cdpClient = opts.cdpClient;
      if (!cdpClient) return { ok: false, error: "CDP client not available" };

      // Use port 9223 by default — port 9222 is often used by Brave internally
      // and returns 404 on CDP endpoints (false negative).
      const result = await cdpClient.launch({ port: port || 9223 });
      if (!result.ok) return result;

      // Reset browser mode detection so next call re-checks CDP
      nativeMode = null;
      cdpCheckPromise = null;
      nativeHandlers = null;
      const connected = await ensureBrowserMode();

      if (url && url !== "about:blank" && connected && nativeHandlers) {
        try { await nativeHandlers.navigate(url); } catch {}
      }

      return { ...result, cdpConnected: connected };
    },

    // ── Form input via ref ─────────────────────────────────────────────
    async browserFormInput({ ref, value }) {
      await ensureBrowserMode();
      if (!nativeHandlers) {
        return { ok: false, error: "browser_form_input requires native Chrome (start with browser_launch first)" };
      }
      return nativeHandlers.formInput({ ref, value });
    },

    // ── Smart article extraction ───────────────────────────────────────
    async browserGetArticleText(maxChars, paneId) {
      const script = `(function() {
        const selectors = [
          'article', 'main', '[role="main"]',
          '[class*="articleBody"]', '[class*="article-body"]',
          '[class*="post-content"]', '[class*="entry-content"]',
          '[class*="content-body"]', '[class*="page-content"]',
          '#content', '.content', '#main', '.main'
        ];
        const maxLen = ${maxChars || 50000};
        let best = null;
        let bestLen = 0;
        for (const sel of selectors) {
          try {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              const txt = (el.innerText || el.textContent || '').trim();
              if (txt.length > bestLen) { bestLen = txt.length; best = el; }
            }
            if (best) break;
          } catch(e) {}
        }
        const source = best ? best : document.body;
        const text = (source.innerText || source.textContent || '').replace(/\\s+/g, ' ').trim();
        return {
          title: document.title,
          url: location.href,
          sourceElement: best ? (best.tagName.toLowerCase() + (best.id ? '#'+best.id : '') + (best.className ? '.'+best.className.split(' ')[0] : '')) : 'body',
          charCount: text.length,
          text: text.slice(0, maxLen)
        };
      })()`;

      return browserCmd("eval", { javascript: script, paneId });
    },
  };
}

module.exports = { createBrowserHandlers };
