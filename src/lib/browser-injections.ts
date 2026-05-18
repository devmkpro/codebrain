/**
 * browser-injections.ts
 *
 * JavaScript scripts injected into <webview> elements via executeJavaScript().
 * Each export is a function that returns a JS string to be evaluated in the
 * page context. These run in the webview's renderer, NOT in Electron's renderer.
 */

// ── Network Interceptor Hook ────────────────────────────────────────────────
// Intercepts fetch, XHR, and WebSocket at the JS level to capture everything
// the page does, including request bodies, response bodies, and WS messages.

export function networkInterceptorScript(): string {
  return `(function() {
    if (window.__codebrainNetworkCaptured) return;
    window.__codebrainNetworkCaptured = true;
    const entries = [];

    function send(entry) {
      try {
        window.postMessage({ __codebrain_network: true, entry }, '*');
      } catch {}
    }

    // ── Fetch interceptor ──
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const startTime = Date.now();
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
      const method = args[1]?.method || 'GET';
      const reqHeaders = args[1]?.headers || {};
      let reqBody = null;
      try { reqBody = args[1]?.body ? String(args[1].body).substring(0, 2000) : null; } catch {}

      try {
        const resp = await origFetch.apply(this, args);
        const duration = Date.now() - startTime;
        // Clone to read body without consuming
        const clone = resp.clone();
        let respBody = null;
        try { respBody = (await clone.text()).substring(0, 5000); } catch {}

        send({
          type: 'fetch',
          method,
          url,
          status: resp.status,
          statusText: resp.statusText,
          ok: resp.ok,
          durationMs: duration,
          requestHeaders: reqHeaders,
          requestBody: reqBody,
          responseHeaders: Object.fromEntries(resp.headers.entries()),
          responseBody: respBody,
          error: null,
          timestamp: startTime,
        });
        return resp;
      } catch (err) {
        send({
          type: 'fetch',
          method,
          url,
          status: 0,
          statusText: 'Error',
          ok: false,
          durationMs: Date.now() - startTime,
          requestHeaders: reqHeaders,
          requestBody: reqBody,
          responseHeaders: {},
          responseBody: null,
          error: err.message || String(err),
          timestamp: startTime,
        });
        throw err;
      }
    };

    // ── XHR interceptor ──
    const OrigXHR = window.XMLHttpRequest;
    function InterceptedXHR() {
      const xhr = new OrigXHR();
      const startTime = Date.now();
      let method = '', url = '';

      const origOpen = xhr.open.bind(xhr);
      xhr.open = function(m, u, ...rest) { method = m; url = u; return origOpen(m, u, ...rest); };

      const origSend = xhr.send.bind(xhr);
      xhr.send = function(body) {
        const reqBody = body ? String(body).substring(0, 2000) : null;
        xhr.addEventListener('load', () => {
          send({
            type: 'xhr',
            method,
            url,
            status: xhr.status,
            statusText: xhr.statusText,
            ok: xhr.status >= 200 && xhr.status < 400,
            durationMs: Date.now() - startTime,
            requestBody: reqBody,
            responseBody: (xhr.responseText || '').substring(0, 5000),
            error: null,
            timestamp: startTime,
          });
        });
        xhr.addEventListener('error', () => {
          send({
            type: 'xhr',
            method,
            url,
            status: 0,
            statusText: 'Error',
            ok: false,
            durationMs: Date.now() - startTime,
            requestBody: reqBody,
            responseBody: null,
            error: 'network error',
            timestamp: startTime,
          });
        });
        xhr.addEventListener('timeout', () => {
          send({
            type: 'xhr',
            method,
            url,
            status: 0,
            statusText: 'Timeout',
            ok: false,
            durationMs: Date.now() - startTime,
            requestBody: reqBody,
            responseBody: null,
            error: 'timeout',
            timestamp: startTime,
          });
        });
        return origSend(body);
      };
      return xhr;
    }
    window.XMLHttpRequest = InterceptedXHR;

    // ── WebSocket interceptor ──
    const OrigWS = window.WebSocket;
    function InterceptedWS(url, protocols) {
      const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
      const startTime = Date.now();
      const wsId = 'ws_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

      send({ type: 'ws_open', url, wsId, timestamp: startTime });

      const origSend = ws.send.bind(ws);
      ws.send = function(data) {
        send({ type: 'ws_send', url, wsId, data: String(data).substring(0, 2000), timestamp: Date.now() });
        return origSend(data);
      };

      ws.addEventListener('message', (e) => {
        send({ type: 'ws_message', url, wsId, data: String(e.data).substring(0, 2000), timestamp: Date.now() });
      });

      ws.addEventListener('close', (e) => {
        send({ type: 'ws_close', url, wsId, code: e.code, reason: e.reason, durationMs: Date.now() - startTime, timestamp: Date.now() });
      });

      ws.addEventListener('error', () => {
        send({ type: 'ws_error', url, wsId, durationMs: Date.now() - startTime, timestamp: Date.now() });
      });

      return ws;
    }
    window.WebSocket = InterceptedWS;
  })();`;
}

// ── Console Hook ─────────────────────────────────────────────────────────────
// Overrides console.log/warn/error/info/debug to post messages back to the
// Electron renderer via window.postMessage.

export function consoleHookScript(): string {
  return `(function() {
    if (window.__codebrainConsoleCaptured) return;
    window.__codebrainConsoleCaptured = true;
    const levels = ['log', 'warn', 'error', 'info', 'debug'];
    const orig = {};
    levels.forEach(l => { orig[l] = console[l]; });
    function send(level, args, extra) {
      try {
        const msg = Array.from(args).map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(' ');
        let source = extra?.source || '';
        if (!source) {
          try { throw new Error(); } catch(e) {
            const lines = e.stack?.split('\\n') || [];
            for (const line of lines) {
              if (line.includes('http') && !line.includes('browser-injections')) {
                source = line.trim(); break;
              }
            }
          }
        }
        window.postMessage({
          __codebrain_console: true, level, message: msg, source, timestamp: Date.now()
        }, '*');
      } catch {}
    }
    // Override console methods
    levels.forEach(l => {
      console[l] = function() { send(l, arguments); orig[l].apply(console, arguments); };
    });

    // Capture uncaught JS errors (window.onerror)
    window.addEventListener('error', function(e) {
      const msg = e.message + ' at ' + (e.filename || '?') + ':' + (e.lineno || '?') + ':' + (e.colno || '?');
      const source = e.filename ? e.filename + ':' + e.lineno : '';
      send('error', [msg], { source });
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', function(e) {
      const reason = e.reason;
      let msg;
      try { msg = typeof reason === 'string' ? reason : reason?.message || JSON.stringify(reason); }
      catch { msg = String(reason); }
      send('error', ['[Unhandled Promise] ' + msg]);
    });

    // Capture resource load failures (img, script, stylesheet, etc.)
    new MutationObserver(function(mutations) {
      // Not reliable for all resource errors; use window.onerror above instead
    }).observe(document, { childList: true, subtree: true });
  })();`;
}

// ── Accessibility Tree Builder ───────────────────────────────────────────────
// Walks the DOM and collects semantic info: roles, labels, values, bounds.

export function a11yTreeScript(maxDepth: number = 10, maxNodes: number = 300): string {
  return `(function() {
    var nodeCount = 0;
    var INTERACTIVE = new Set(['link','button','textbox','combobox','checkbox','radio','menuitem','tab','option','slider','spinbutton','switch','searchbox']);
    var SEMANTIC    = new Set(['heading','img','navigation','main','banner','contentinfo','form','dialog','table','row','cell','columnheader','list','listitem','progressbar','meter','alert','status','tooltip','grid','tree','treeitem']);
    function getRole(el) {
      const r = el.getAttribute('role');
      if (r) return r;
      const tag = el.tagName.toLowerCase();
      const map = { a:'link', button:'button', input:'textbox', select:'combobox', textarea:'textbox', h1:'heading', h2:'heading', h3:'heading', h4:'heading', h5:'heading', h6:'heading', img:'img', nav:'navigation', main:'main', header:'banner', footer:'contentinfo', table:'table', tr:'row', td:'cell', th:'columnheader', ul:'list', ol:'list', li:'listitem', form:'form', dialog:'dialog', progress:'progressbar', meter:'meter' };
      if (el.type === 'checkbox') return 'checkbox';
      if (el.type === 'radio') return 'radio';
      return map[tag] || 'generic';
    }
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05;
    }
    function walk(el, depth) {
      if (nodeCount >= maxNodes) return null;
      if (depth > ${maxDepth}) return null;
      if (!el || el.nodeType !== 1) return null;
      if (!isVisible(el)) return null;
      const role = getRole(el);
      const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '';
      const text  = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
                    ? (el.childNodes[0].textContent || '').trim().substring(0, 150) : '';
      const href  = el.tagName === 'A' ? (el.getAttribute('href') || undefined) : undefined;
      const children = [];
      for (const child of el.children) {
        const c = walk(child, depth + 1);
        if (c) children.push(c);
      }
      // Prune: skip generic containers with no content and no meaningful children
      const hasMeaning = role !== 'generic' || label || text || href || el.id;
      if (!hasMeaning && children.length === 0) return null;
      // Collapse transparent wrappers (generic + no own content, just passes through children)
      if (role === 'generic' && !label && !text && !href && !el.id && children.length > 0 && depth > 1) {
        return children.length === 1 ? children[0] : { tag:'g', role:'generic', children };
      }
      nodeCount++;
      const r = el.getBoundingClientRect();
      const isInteractive = INTERACTIVE.has(role);
      const node = { tag: el.tagName.toLowerCase(), role, label, text, children };
      if (href)  node.href = href;
      if (el.id) node.id   = el.id;
      if (isInteractive) {
        node.bounds   = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        node.disabled = el.disabled || false;
        if (el.checked  !== undefined) node.checked = el.checked;
        if (el.value    !== undefined) node.value   = String(el.value).substring(0, 100);
        if (document.activeElement === el) node.focused = true;
      }
      // Drop empty fields to reduce tokens
      if (!node.label)    delete node.label;
      if (!node.text)     delete node.text;
      if (!node.children.length) delete node.children;
      return node;
    }
    const tree = walk(document.body, 0) || { tag:'body', role:'generic' };
    return { tree, truncated: nodeCount >= maxNodes, nodeCount };
  })();`;
}

// ── Find By Text ─────────────────────────────────────────────────────────────
// TreeWalker to find elements whose visible text matches a query.

export function findByTextScript(text: string, role?: string, exact?: boolean): string {
  return `(function() {
    function getRole(el) {
      if (el.getAttribute('role')) return el.getAttribute('role');
      const tag = el.tagName.toLowerCase();
      const map = {
        a: 'link', button: 'button', input: 'textbox', select: 'combobox',
        textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading',
        img: 'img', nav: 'navigation'
      };
      if (el.type === 'checkbox') return 'checkbox';
      if (el.type === 'radio') return 'radio';
      return map[tag] || 'generic';
    }
    function getInfo(el) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        selector: el.id ? '#'+el.id : el.tagName.toLowerCase() + (el.className ? '.'+Array.from(el.classList).join('.') : ''),
        tag: el.tagName.toLowerCase(),
        role: getRole(el),
        text: el.textContent?.trim().substring(0, 500) || '',
        value: el.value !== undefined ? String(el.value) : undefined,
        href: el.href || undefined,
        id: el.id || undefined,
        classes: Array.from(el.classList).slice(0, 5),
        attributes: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value.substring(0,100)])),
        bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden',
        disabled: el.disabled || false,
        checked: el.checked !== undefined ? el.checked : undefined,
        focused: document.activeElement === el
      };
    }
    const text = ${JSON.stringify(text)};
    const role = ${JSON.stringify(role || '')};
    const exact = ${!!exact};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const results = [];
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const t = node.textContent?.trim() || '';
      if (!t) continue;
      const match = exact ? t === text : t.toLowerCase().includes(text.toLowerCase());
      if (!match) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      if (role && getRole(el) !== role) continue;
      seen.add(el);
      results.push(getInfo(el));
      if (results.length >= 20) break;
    }
    return results;
  })();`;
}

// ── Get Element Info ─────────────────────────────────────────────────────────
// Returns comprehensive info about a single element.

export function getElementInfoScript(selector: string): string {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    function getRole(e) {
      if (e.getAttribute('role')) return e.getAttribute('role');
      const tag = e.tagName.toLowerCase();
      const map = { a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox' };
      if (e.type === 'checkbox') return 'checkbox';
      if (e.type === 'radio') return 'radio';
      return map[tag] || 'generic';
    }
    return {
      selector: ${JSON.stringify(selector)},
      tag: el.tagName.toLowerCase(),
      role: getRole(el),
      text: el.textContent?.trim().substring(0, 500) || '',
      value: el.value !== undefined ? String(el.value) : undefined,
      href: el.href || undefined,
      id: el.id || undefined,
      classes: Array.from(el.classList).slice(0, 10),
      attributes: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value.substring(0,200)])),
      bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden',
      disabled: el.disabled || false,
      checked: el.checked !== undefined ? el.checked : undefined,
      focused: document.activeElement === el
    };
  })();`;
}

// ── Click ────────────────────────────────────────────────────────────────────
// Dispatches mousedown, mouseup, click events on the target element.
// Scrolls element into view first. Falls back to escaped selector if needed.

export function clickScript(selector: string): string {
  return `(function() {
    let el = document.querySelector(${JSON.stringify(selector)});
    // Fallback: try unescaping colons (CSS modules escape \\: in selectors)
    if (!el) {
      try { el = document.querySelector(${JSON.stringify(selector)}.replace(/\\\\:/g, ':')); } catch {}
    }
    // Fallback: try with escaped \\: replaced by just :
    if (!el) {
      try { el = document.querySelector(${JSON.stringify(selector)}.replace(/\\\\:/g, '\\\\:')); } catch {}
    }
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  })();`;
}

// ── Fill ─────────────────────────────────────────────────────────────────────
// Sets value on input/textarea and dispatches input/change events.

export function fillScript(selector: string, value: string, clearFirst?: boolean): string {
  return `(function() {
    let el = document.querySelector(${JSON.stringify(selector)});
    if (!el) {
      try { el = document.querySelector(${JSON.stringify(selector)}.replace(/\\\\:/g, ':')); } catch {}
    }
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    el.focus();
    if (${!!clearFirst}) {
      const nativeSet = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (nativeSet) nativeSet.call(el, '');
      else el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const nativeSet = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSet) nativeSet.call(el, ${JSON.stringify(value)});
    else el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })();`;
}

// ── Select ───────────────────────────────────────────────────────────────────
// Selects an option in a <select> by value or visible text.

export function selectScript(selector: string, valueOrText: string): string {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.tagName !== 'SELECT') throw new Error('select not found: ' + ${JSON.stringify(selector)});
    const target = ${JSON.stringify(valueOrText)};
    let matched = false;
    for (const opt of el.options) {
      if (opt.value === target || opt.textContent.trim() === target) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error('option not found: ' + target);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { selectedValue: el.value };
  })();`;
}

// ── Check/Uncheck ────────────────────────────────────────────────────────────
export function checkScript(selector: string, checked?: boolean): string {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    const target = ${checked === undefined ? 'undefined' : JSON.stringify(checked)};
    const newVal = target === undefined ? !el.checked : !!target;
    el.checked = newVal;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { isChecked: el.checked };
  })();`;
}

// ── Clear ────────────────────────────────────────────────────────────────────
export function clearScript(selector: string): string {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    el.focus();
    el.select && el.select();
    const nativeSet = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSet) nativeSet.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })();`;
}

// ── Focus ────────────────────────────────────────────────────────────────────
export function focusScript(selector: string): string {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    el.focus();
    return true;
  })();`;
}

// ── Hover ────────────────────────────────────────────────────────────────────
export function hoverScript(selector: string): string {
  return `(function() {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointermove', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    return { bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
  })();`;
}

// ── Mouse at Coordinates ─────────────────────────────────────────────────────
export function mouseAtScript(x: number, y: number, type: string, button?: string): string {
  const btnMap: Record<string, number> = { left: 0, middle: 1, right: 2 };
  return `(function() {
    const el = document.elementFromPoint(${x}, ${y}) || document.body;
    const btn = ${btnMap[button || 'left'] || 0};
    const opts = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: btn };
    if ('${type}' === 'click' || '${type}' === 'down') el.dispatchEvent(new PointerEvent('pointerdown', opts));
    if ('${type}' === 'click' || '${type}' === 'down') el.dispatchEvent(new MouseEvent('mousedown', opts));
    if ('${type}' === 'hover') { el.dispatchEvent(new PointerEvent('pointerover', opts)); el.dispatchEvent(new MouseEvent('mouseover', opts)); }
    el.dispatchEvent(new PointerEvent('pointermove', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    if ('${type}' === 'click' || '${type}' === 'up') el.dispatchEvent(new PointerEvent('pointerup', opts));
    if ('${type}' === 'click' || '${type}' === 'up') el.dispatchEvent(new MouseEvent('mouseup', opts));
    if ('${type}' === 'click') el.dispatchEvent(new MouseEvent('click', opts));
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      text: el.textContent?.trim().substring(0, 200) || '',
      bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    };
  })();`;
}

// ── Drag ─────────────────────────────────────────────────────────────────────
export function dragScript(x1: number, y1: number, x2: number, y2: number, steps?: number): string {
  return `(function() {
    const steps = ${steps || 10};
    const el1 = document.elementFromPoint(${x1}, ${y1}) || document.body;
    const opts1 = { bubbles: true, cancelable: true, clientX: ${x1}, clientY: ${y1}, button: 0 };
    el1.dispatchEvent(new PointerEvent('pointerdown', opts1));
    el1.dispatchEvent(new MouseEvent('mousedown', opts1));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = ${x1} + (${x2} - ${x1}) * t;
      const cy = ${y1} + (${y2} - ${y1}) * t;
      const el = document.elementFromPoint(cx, cy) || document.body;
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
      el.dispatchEvent(new PointerEvent('pointermove', opts));
      el.dispatchEvent(new MouseEvent('mousemove', opts));
    }
    const el2 = document.elementFromPoint(${x2}, ${y2}) || document.body;
    const opts2 = { bubbles: true, cancelable: true, clientX: ${x2}, clientY: ${y2}, button: 0 };
    el2.dispatchEvent(new PointerEvent('pointerup', opts2));
    el2.dispatchEvent(new MouseEvent('mouseup', opts2));
    el2.dispatchEvent(new MouseEvent('click', opts2));
    return true;
  })();`;
}

// ── Scroll ───────────────────────────────────────────────────────────────────
export function scrollScript(selector: string | undefined, direction: string, amount: number): string {
  return `(function() {
    const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.scrollingElement || document.documentElement'};
    if (!el) throw new Error('scroll target not found');
    const dir = ${JSON.stringify(direction)};
    const amt = ${amount};
    if (dir === 'down') el.scrollTop += amt;
    else if (dir === 'up') el.scrollTop -= amt;
    else if (dir === 'right') el.scrollLeft += amt;
    else if (dir === 'left') el.scrollLeft -= amt;
    return { scrollY: el.scrollTop, scrollX: el.scrollLeft };
  })();`;
}

// ── Type Text ────────────────────────────────────────────────────────────────
export function typeScript(text: string, delayMs?: number): string {
  return `(function() {
    const text = ${JSON.stringify(text)};
    const delay = ${delayMs || 0};
    const el = document.activeElement || document.body;
    return new Promise(resolve => {
      let i = 0;
      function typeNext() {
        if (i >= text.length) { resolve(true); return; }
        const ch = text[i];
        const opts = { key: ch, code: 'Key' + ch.toUpperCase(), charCode: ch.charCodeAt(0), keyCode: ch.charCodeAt(0), bubbles: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keypress', opts));
        if (el.value !== undefined) el.value += ch;
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
        i++;
        if (delay > 0) setTimeout(typeNext, delay);
        else typeNext();
      }
      typeNext();
    });
  })();`;
}

// ── Key Press ────────────────────────────────────────────────────────────────
export function keyScript(key: string): string {
  return `(function() {
    const el = document.activeElement || document.body;
    const key = ${JSON.stringify(key)};
    const codeMap = {
      Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
      Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
      F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
      F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12'
    };
    const opts = { key, code: codeMap[key] || key, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    return true;
  })();`;
}

// ── Keyboard Shortcut ────────────────────────────────────────────────────────
export function shortcutScript(keys: string): string {
  return `(function() {
    const combo = ${JSON.stringify(keys)};
    const parts = combo.split('+').map(s => s.trim().toLowerCase());
    const el = document.activeElement || document.body;
    const ctrl = parts.includes('ctrl') || parts.includes('control');
    const shift = parts.includes('shift');
    const alt = parts.includes('alt') || parts.includes('option');
    const meta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
    const key = parts.find(p => !['ctrl','control','shift','alt','option','meta','cmd','command'].includes(p)) || '';
    const opts = {
      key: key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1),
      code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
      ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta,
      bubbles: true, cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    return true;
  })();`;
}

// ── Wait For Selector ────────────────────────────────────────────────────────
export function waitForScript(selector: string, timeoutMs?: number): string {
  return `new Promise((resolve) => {
    const sel = ${JSON.stringify(selector)};
    const timeout = ${timeoutMs || 5000};
    const start = Date.now();
    function check() {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          resolve({ found: true, waitedMs: Date.now() - start });
          return;
        }
      }
      if (Date.now() - start > timeout) {
        resolve({ found: false, timedOut: true, waitedMs: Date.now() - start });
        return;
      }
      setTimeout(check, 200);
    }
    check();
  })();`;
}

// ── Wait For Text ────────────────────────────────────────────────────────────
export function waitForTextScript(text: string, selector?: string, timeoutMs?: number): string {
  return `new Promise((resolve) => {
    const text = ${JSON.stringify(text)};
    const sel = ${JSON.stringify(selector || '')};
    const timeout = ${timeoutMs || 5000};
    const start = Date.now();
    function check() {
      const root = sel ? document.querySelector(sel) : document.body;
      if (root && root.textContent.includes(text)) {
        resolve({ found: true, waitedMs: Date.now() - start });
        return;
      }
      if (Date.now() - start > timeout) {
        resolve({ found: false, timedOut: true, waitedMs: Date.now() - start });
        return;
      }
      setTimeout(check, 200);
    }
    check();
  })();`;
}

// ── Wait For URL ─────────────────────────────────────────────────────────────
export function waitForUrlScript(pattern: string, timeoutMs?: number): string {
  return `new Promise((resolve) => {
    const pattern = ${JSON.stringify(pattern)};
    const timeout = ${timeoutMs || 5000};
    const start = Date.now();
    function check() {
      const url = location.href;
      let matched = false;
      try { matched = new RegExp(pattern).test(url); } catch { matched = url.includes(pattern); }
      if (matched) {
        resolve({ matched: true, finalUrl: url, waitedMs: Date.now() - start });
        return;
      }
      if (Date.now() - start > timeout) {
        resolve({ matched: false, finalUrl: url, timedOut: true, waitedMs: Date.now() - start });
        return;
      }
      setTimeout(check, 300);
    }
    check();
  })();`;
}

// ── Wait For Load (network idle) ─────────────────────────────────────────────
export function waitForLoadScript(timeoutMs?: number): string {
  // Synchronous check — avoids Promise stuck when webview navigates mid-script
  return `(function() {
    const ready = document.readyState;
    return { ok: ready === 'complete' || ready === 'interactive', readyState: ready, url: location.href };
  })();`;
}

// ── Get HTML (smart scraping mode) ───────────────────────────────────────────
// By default returns only meaningful body content for scraping.
// Strips <script>, <style>, <link>, <meta>, <noscript>, comments, <svg> icons.
export function getHtmlScript(selector?: string): string {
  // Shared cleanup logic — clone, strip noise, return innerHTML
  const cleanupCode = `
    function cleanHTML(root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,link[rel="stylesheet"],meta,noscript,template').forEach(el => el.remove());
      clone.querySelectorAll('svg').forEach(svg => {
        const w = parseInt(svg.getAttribute('width')||'0',10);
        const h = parseInt(svg.getAttribute('height')||'0',10);
        if ((w > 0 && w <= 24) || (h > 0 && h <= 24) || (!w && !h && svg.closest('button,a,label'))) svg.remove();
      });
      const tw = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
      const comments = [];
      while (tw.nextNode()) comments.push(tw.currentNode);
      comments.forEach(c => c.remove());
      clone.querySelectorAll('[style]').forEach(el => {
        el.removeAttribute('style');
      });
      return (clone.innerHTML || '').replace(/\\s+/g, ' ').trim();
    }
  `;
  if (selector) {
    return `(function() {
      ${cleanupCode}
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
      const html = cleanHTML(el);
      return { html, lengthChars: html.length };
    })();`;
  }
  return `(function() {
    ${cleanupCode}
    const body = document.body;
    if (!body) return { html: '', lengthChars: 0 };
    const html = cleanHTML(body);
    return { html, lengthChars: html.length };
  })();`;
}

// ── Get Text ─────────────────────────────────────────────────────────────────
export function getTextScript(selector?: string): string {
  if (selector) {
    return `(function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
      return { text: el.innerText?.substring(0, 100000) || '' };
    })();`;
  }
  return `(function() {
    return { text: document.body?.innerText?.substring(0, 100000) || '' };
  })();`;
}

// ── Get URL ──────────────────────────────────────────────────────────────────
export function getUrlScript(): string {
  return `({ url: location.href, title: document.title })`;
}

// ── Click by Text (composite: find + scroll + click in one call) ────────────
export function clickByTextScript(text: string, role?: string): string {
  return `(function() {
    const text = ${JSON.stringify(text)};
    const role = ${JSON.stringify(role || '')};
    function getRole(el) {
      if (el.getAttribute('role')) return el.getAttribute('role');
      const tag = el.tagName.toLowerCase();
      const map = { a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox' };
      if (el.type === 'checkbox') return 'checkbox';
      if (el.type === 'radio') return 'radio';
      return map[tag] || 'generic';
    }
    // Also check clickable parents (a, button) of text nodes
    function findClickable(textNode) {
      let el = textNode.parentElement;
      for (let i = 0; i < 5 && el; i++) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button' || el.onclick) return el;
        el = el.parentElement;
      }
      return textNode.parentElement;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent?.trim() || '';
      if (!t.includes(text)) continue;
      const el = findClickable(walker.currentNode);
      if (!el) continue;
      if (role && getRole(el) !== role) continue;
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return { ok: true, tag: el.tagName.toLowerCase(), text: t.substring(0, 100), scrolled: true };
    }
    throw new Error('text not found: ' + text);
  })();`;
}

// ── Fill Form (composite: fill multiple fields in one call) ─────────────────
export function fillFormScript(fields: Array<{ selector: string; value: string }>): string {
  return `(function() {
    const fields = ${JSON.stringify(fields)};
    const results = [];
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    for (const f of fields) {
      const el = document.querySelector(f.selector);
      if (!el) { results.push({ selector: f.selector, ok: false, error: 'not found' }); continue; }
      el.focus();
      if (nativeSet) nativeSet.call(el, f.value);
      else el.value = f.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      results.push({ selector: f.selector, ok: true });
    }
    return results;
  })();`;
}

// ── Page Summary (composite: URL + title + key text in one call) ────────────
export function pageSummaryScript(): string {
  return `(function() {
    const url = location.href;
    const title = document.title;
    // Get visible text, truncated
    const body = document.body?.innerText?.substring(0, 3000) || '';
    // Get all links
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(a => ({
      text: a.textContent?.trim().substring(0, 100) || '',
      href: a.href
    }));
    // Get all inputs
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 20).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      placeholder: el.placeholder || '',
      value: el.value?.substring(0, 100) || ''
    }));
    // Get all buttons
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 20).map(el => ({
      text: el.textContent?.trim().substring(0, 100) || '',
      disabled: el.disabled || false
    }));
    return { url, title, body, links, inputs, buttons };
  })();`;
}
