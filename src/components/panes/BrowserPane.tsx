import React from "react";
import { ArrowLeft, ArrowRight, RotateCw, X$1 } from "../../stores/providers-store";
import { useBrowserStore } from "../../stores/browser-store";
import {
  consoleHookScript,
  a11yTreeScript,
  findByTextScript,
  getElementInfoScript,
  clickScript,
  fillScript,
  selectScript,
  checkScript,
  clearScript,
  focusScript,
  hoverScript,
  mouseAtScript,
  dragScript,
  scrollScript,
  typeScript,
  keyScript,
  shortcutScript,
  waitForScript,
  waitForTextScript,
  waitForUrlScript,
  waitForLoadScript,
  getHtmlScript,
  getTextScript,
  getUrlScript,
  clickByTextScript,
  fillFormScript,
  pageSummaryScript,
  networkInterceptorScript,
} from "../../lib/browser-injections";

// BrowserPane
import { usePanesStore } from "../../stores/panes-store";

// Command type → injection script mapping
function buildScript(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "navigate":        return `location.href = ${JSON.stringify(payload.url)}`;
    case "eval":            return String(payload.javascript);
    case "get-html":        return getHtmlScript(payload.selector as string | undefined);
    case "get-text":        return getTextScript(payload.selector as string | undefined);
    case "get-a11y-tree":   return a11yTreeScript((payload.maxDepth as number) || 10, (payload.maxNodes as number) || 300);
    case "find-by-text":    return findByTextScript(payload.text as string, payload.role as string | undefined, payload.exact as boolean | undefined);
    case "get-element":     return getElementInfoScript(payload.selector as string);
    case "get-url":         return getUrlScript();
    case "click":           return clickScript(payload.selector as string);
    case "fill":            return fillScript(payload.selector as string, payload.value as string, payload.clearFirst as boolean | undefined);
    case "select":          return selectScript(payload.selector as string, payload.valueOrText as string);
    case "check":           return checkScript(payload.selector as string, payload.checked as boolean | undefined);
    case "clear":           return clearScript(payload.selector as string);
    case "focus":           return focusScript(payload.selector as string);
    case "hover":           return hoverScript(payload.selector as string);
    case "click-at":        return mouseAtScript(payload.x as number, payload.y as number, "click", payload.button as string | undefined);
    case "hover-at":        return mouseAtScript(payload.x as number, payload.y as number, "hover");
    case "drag":            return dragScript(payload.x1 as number, payload.y1 as number, payload.x2 as number, payload.y2 as number, payload.steps as number | undefined);
    case "scroll":          return scrollScript(payload.selector as string | undefined, payload.direction as string, payload.amount as number);
    case "type":            return typeScript(payload.text as string, payload.delayMs as number | undefined);
    case "key":             return keyScript(payload.key as string);
    case "shortcut":        return shortcutScript(payload.keys as string);
    case "wait-for":        return waitForScript(payload.selector as string, payload.timeoutMs as number | undefined);
    case "wait-for-text":   return waitForTextScript(payload.text as string, payload.selector as string | undefined, payload.timeoutMs as number | undefined);
    case "wait-for-url":    return waitForUrlScript(payload.pattern as string, payload.timeoutMs as number | undefined);
    case "wait-for-load":   return waitForLoadScript(payload.timeoutMs as number | undefined);
    case "click-text":      return clickByTextScript(payload.text as string, payload.role as string | undefined);
    case "fill-form":       return fillFormScript(payload.fields as Array<{ selector: string; value: string }>);
    case "page-summary":    return pageSummaryScript();
    default:                throw new Error(`unknown command type: ${type}`);
  }
}

export function BrowserPane({
  pane,
  isActive,
  onClick
}) {
  const updatePane = usePanesStore(s => s.updatePane);
  const removePane = usePanesStore(s => s.removePane);
  const addConsoleEntry = useBrowserStore(s => s.addConsoleEntry);
  const initial = pane.url ?? "about:blank";
  const [input, setInput] = React.useState(initial);
  const [src, setSrc] = React.useState(initial);
  const webviewRef = React.useRef(null);
  const webviewReadyRef = React.useRef(false);
  const webviewReadyPromiseRef = React.useRef(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  // Initialize the readiness promise — resolved when dom-ready fires
  React.useEffect(() => {
    let resolve;
    webviewReadyPromiseRef.current = new Promise(r => { resolve = r; });
    webviewReadyPromiseRef.current._resolve = resolve;
  }, []);

  // Track webview readiness
  React.useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onDomReady = () => {
      webviewReadyRef.current = true;
      webviewReadyPromiseRef.current?._resolve?.();
    };
    wv.addEventListener("dom-ready", onDomReady);
    return () => wv.removeEventListener("dom-ready", onDomReady);
  }, []);

  // Command bus — handle commands from main process (MCP tools)
  React.useEffect(() => {
    const onCmd = async (event) => {
      const { requestId, paneId, type, ...payload } = event.detail;
      if (paneId !== pane.id) return;

      // Wait for webview to be ready (max 15s)
      if (!webviewReadyRef.current) {
        try {
          await Promise.race([
            webviewReadyPromiseRef.current,
            new Promise((_, rej) => setTimeout(() => rej(new Error("webview init timeout")), 15000))
          ]);
        } catch {
          window.dispatchEvent(new CustomEvent("codebrain:browser:result", {
            detail: { requestId, ok: false, error: "webview not ready" }
          }));
          return;
        }
      }

      const wv = webviewRef.current;
      if (!wv) {
        window.dispatchEvent(new CustomEvent("codebrain:browser:result", {
          detail: { requestId, ok: false, error: "no webview" }
        }));
        return;
      }
      if (typeof wv.executeJavaScript !== "function") {
        window.dispatchEvent(new CustomEvent("codebrain:browser:result", {
          detail: { requestId, ok: false, error: "webview executeJavaScript not available" }
        }));
        return;
      }

      try {
        let result;

        // Special cases that need main-process handling
        if (type === "navigate") {
          const url = payload.url;
          let target = url.trim();
          if (!target) throw new Error("empty url");
          if (!/^https?:\/\//i.test(target) && !target.startsWith("about:")) {
            target = "http://" + target;
          }
          // Wait for the webview to finish loading the new page
          const loadPromise = new Promise<void>((resolve) => {
            const onNav = () => {
              wv.removeEventListener("did-stop-loading", onNav);
              resolve();
            };
            wv.addEventListener("did-stop-loading", onNav);
            // Fallback timeout
            setTimeout(() => {
              wv.removeEventListener("did-stop-loading", onNav);
              resolve();
            }, 15000);
          });
          setSrc(target);
          updatePane(pane.id, { url: target });
          await loadPromise;
          try { result = { ok: true, finalUrl: wv.getURL(), title: wv.getTitle() }; } catch { result = { ok: true }; }
        } else if (type === "screenshot") {
          let rect;
          if (payload.fullPage) {
            const dims = await wv.executeJavaScript(
              "({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })"
            );
            if (dims && dims.width > 0 && dims.height > 0) {
              rect = { x: 0, y: 0, width: dims.width, height: dims.height };
            }
          }
          const nativeImage = await wv.capturePage(rect);
          const pngBuffer = nativeImage.toPNG();
          // Chunked encoding to avoid stack overflow on large screenshots
          let binary = "";
          for (let i = 0; i < pngBuffer.length; i++) binary += String.fromCharCode(pngBuffer[i]);
          const base64 = btoa(binary);
          result = { ok: true, dataUrl: `data:image/png;base64,${base64}`, size: pngBuffer.length };
        } else if (type === "screenshot-el") {
          // Get element bounds, then capture
          const info = await wv.executeJavaScript(getElementInfoScript(payload.selector));
          if (!info) throw new Error("element not found");
          const rect = { x: info.bounds.x, y: info.bounds.y, width: info.bounds.width, height: info.bounds.height };
          const nativeImage = await wv.capturePage(rect);
          const pngBuffer = nativeImage.toPNG();
          let binary = "";
          for (let i = 0; i < pngBuffer.length; i++) binary += String.fromCharCode(pngBuffer[i]);
          const base64 = btoa(binary);
          result = { ok: true, dataUrl: `data:image/png;base64,${base64}`, size: pngBuffer.length, bounds: info.bounds };
        } else if (type === "back") {
          wv.goBack();
          result = { ok: true };
        } else if (type === "forward") {
          wv.goForward();
          result = { ok: true };
        } else if (type === "reload") {
          if (payload.hard) wv.reloadIgnoringCache();
          else wv.reload();
          result = { ok: true };
        } else {
          // All other commands use injection scripts
          const script = buildScript(type, payload);
          // Retry executeJavaScript — webview may be in a transitional state
          let lastErr;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              result = await wv.executeJavaScript(script);
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
              if (attempt < 1) await new Promise(r => setTimeout(r, 150));
            }
          }
          if (lastErr) throw lastErr;
        }

        window.dispatchEvent(new CustomEvent("codebrain:browser:result", {
          detail: { requestId, ok: true, result }
        }));
      } catch (err) {
        window.dispatchEvent(new CustomEvent("codebrain:browser:result", {
          detail: { requestId, ok: false, error: String(err) }
        }));
      }
    };

    window.addEventListener("codebrain:browser:cmd", onCmd);
    return () => window.removeEventListener("codebrain:browser:cmd", onCmd);
  }, [pane.id, src, updatePane]);

  // Register this browser pane with main process so MCP tools can find it
  React.useEffect(() => {
    window.codeBrainApp?.browser?.registerPane?.(pane.id);
    return () => { window.codeBrainApp?.browser?.unregisterPane?.(pane.id); };
  }, [pane.id]);

  // Console capture — inject on every page load
  React.useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const injectScripts = () => {
      try { wv.executeJavaScript(consoleHookScript()).catch(() => {}); } catch {}
      try { wv.executeJavaScript(networkInterceptorScript()).catch(() => {}); } catch {}
    };

    const onDomReady = injectScripts;
    wv.addEventListener("dom-ready", onDomReady);
    // Also re-inject on navigation
    const onNav = injectScripts;
    wv.addEventListener("did-navigate", onNav);
    wv.addEventListener("did-navigate-in-page", onNav);
    return () => {
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-navigate", onNav);
      wv.removeEventListener("did-navigate-in-page", onNav);
    };
  }, []);

  // Listen for console messages from webview via postMessage
  React.useEffect(() => {
    const onConsoleMsg = (event) => {
      if (event.data?.__codebrain_console) {
        const entry = {
          id: `console_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: event.data.timestamp || Date.now(),
          level: event.data.level,
          message: event.data.message,
          source: event.data.source
        };
        addConsoleEntry(pane.id, entry);
        // Forward to main process for MCP tool access
        try { window.codeBrainApp?.browser?.reportConsoleEntry?.(entry); } catch {}
      }
      // Network entries from JS-level interceptor (fetch/XHR/WebSocket)
      if (event.data?.__codebrain_network) {
        const raw = event.data.entry;
        const entry = {
          id: `jsnet_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: raw.timestamp || Date.now(),
          durationMs: raw.durationMs || 0,
          method: raw.method || 'GET',
          url: raw.url || '',
          type: raw.type || 'fetch',
          status: raw.status || 0,
          statusText: raw.statusText || '',
          ok: raw.ok ?? false,
          requestHeaders: raw.requestHeaders || {},
          responseHeaders: raw.responseHeaders || {},
          requestBody: raw.requestBody || null,
          responseBody: raw.responseBody || null,
          error: raw.error || null,
          wsId: raw.wsId || undefined,
          wsData: raw.wsData || undefined,
          source: 'js-interceptor',
        };
        useBrowserStore.getState().addNetworkEntry(pane.id, entry);
        // Forward to main process for MCP tool access
        try { window.codeBrainApp?.browser?.reportNetworkEntry?.(entry); } catch {}
      }
    };
    window.addEventListener("message", onConsoleMsg);
    return () => window.removeEventListener("message", onConsoleMsg);
  }, [pane.id, addConsoleEntry]);

  // Network entries from main process (forwarded by preload bridge as DOM events)
  React.useEffect(() => {
    const onNetEntry = (event) => {
      const entry = event.detail;
      if (entry) useBrowserStore.getState().addNetworkEntry(pane.id, entry);
    };
    window.addEventListener("codebrain:browser:network-entry", onNetEntry);
    return () => window.removeEventListener("codebrain:browser:network-entry", onNetEntry);
  }, [pane.id]);

  React.useEffect(() => {
    if (pane.url && pane.url !== src) {
      setInput(pane.url);
      setSrc(pane.url);
    }
  }, [pane.url, src]);

  React.useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onStart = () => {
      setLoading(true);
      setError(null);
    };
    const onStop = () => setLoading(false);
    const onFail = e => {
      if (e.errorCode === -3) return;
      setError(`${e.errorCode} ${e.errorDescription} — ${e.validatedURL}`);
      setLoading(false);
    };
    const onCrash = () => setError("webview crashed");
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-fail-load", onFail);
    wv.addEventListener("crashed", onCrash);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-fail-load", onFail);
      wv.removeEventListener("crashed", onCrash);
    };
  }, []);

  React.useEffect(() => {
    const onReload = event => {
      const detail = event.detail;
      if (detail?.paneId !== pane.id) return;
      webviewRef.current?.reload();
    };
    window.addEventListener("codebrain:browser-reload", onReload);
    return () => window.removeEventListener("codebrain:browser-reload", onReload);
  }, [pane.id]);

  const navigate = url => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target) && !target.startsWith("about:")) {
      target = "http://" + target;
    }
    setSrc(target);
    updatePane(pane.id, { url: target });
  };

  return <div onClick={onClick} className={`h-full flex flex-col bg-black rounded overflow-hidden border cursor-pointer ${isActive ? "border-indigo-500/40" : "border-white/5 hover:border-white/10"}`}>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5 shrink-0 bg-black cursor-grab active:cursor-grabbing" draggable onDragStart={e => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-codebrain-pane", pane.id);
    }}>
        <span className="font-mono text-[9px] text-indigo-500/60 uppercase tracking-widest mr-1">
          www
        </span>
        <button onClick={e => {
        e.stopPropagation();
        webviewRef.current?.goBack();
      }} className="text-gray-600 hover:text-gray-300 px-1" title="Back">
          <ArrowLeft size={14} strokeWidth={1.5} />
        </button>
        <button onClick={e => {
        e.stopPropagation();
        webviewRef.current?.goForward();
      }} className="text-gray-600 hover:text-gray-300 px-1" title="Forward">
          <ArrowRight size={14} strokeWidth={1.5} />
        </button>
        <button onClick={e => {
        e.stopPropagation();
        webviewRef.current?.reload();
      }} className="text-gray-600 hover:text-gray-300 px-1" title="Reload">
          <RotateCw size={14} strokeWidth={1.5} />
        </button>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {
        if (e.key === "Enter") navigate(input);
      }} onClick={e => e.stopPropagation()} className="flex-1 min-w-0 bg-black border border-white/10 rounded px-1.5 py-0.5 font-mono text-[10px] text-gray-300 focus:outline-none focus:border-indigo-500/40" spellCheck={false} />
        <button onClick={e => {
        e.stopPropagation();
        removePane(pane.id);
      }} className="text-gray-700 hover:text-rose-400 px-1" title="Close">
          <X$1 size={14} strokeWidth={1.5} />
        </button>
      </div>
      {error && <div className="px-2 py-1 bg-indigo-500/10 border-b border-indigo-500/20 font-mono text-[10px] text-red-400 truncate" title={error}>
          {error}
        </div>}
      {loading && <div className="px-2 py-0.5 font-mono text-[9px] text-gray-600">loading…</div>}
      <webview ref={el => {
      webviewRef.current = el;
    }} src={src} style={{
      flex: 1,
      width: "100%",
      display: "inline-flex",
      backgroundColor: "#fff"
    }} allowpopups="true" partition="persist:codebrain-browser" />
    </div>;
}
