"use strict";

/**
 * Native Chrome Browser Handlers via CDP
 *
 * Maps Codebrain browser commands to Chrome DevTools Protocol calls.
 * Used when native Chrome is detected with --remote-debugging-port.
 *
 * Portado e adaptado do mcp-browser-bridge/src/tools.js.
 */

function createNativeChromeHandlers(cdpClient) {
  if (!cdpClient) throw new Error("CDPClient required");

  /**
   * Helper: evaluate JS and return parsed result.
   */
  async function evalJS(expression, returnByValue) {
    if (returnByValue === undefined) returnByValue = true;
    const result = await cdpClient.send("Runtime.evaluate", {
      expression,
      returnByValue,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text ||
          result.exceptionDetails.exception?.description ||
          "JS eval error"
      );
    }
    const val = result.result.value;
    return val !== undefined ? val : result.result.description;
  }

  /**
   * Helper: encode a string to base64 and produce a JS expression that
   * decodes it back to the original UTF-8 string in the browser.
   *
   * The old pattern `decodeURIComponent(atob(b64))` BREAKS multi-byte
   * UTF-8 chars (accents, emojis) because atob() returns Latin-1 bytes
   * and decodeURIComponent expects percent-encoded sequences.
   *
   * Fix: percent-encode each byte before calling decodeURIComponent.
   */
  function _safeEncodeForJS(value) {
    const b64 = Buffer.from(String(value ?? ''), 'utf8').toString('base64');
    // Build JS that does: atob(b64) → raw latin1 string → percent-encode each byte → decodeURIComponent
    return `(function(s){var r='';for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);r+='%'+('0'+c.toString(16)).slice(-2)}return decodeURIComponent(r)})("${b64}")`;
  }

  /**
   * Helper: evaluate JS and parse JSON result.
   */
  async function evalJSON(expression) {
    const result = await cdpClient.send("Runtime.evaluate", {
      expression: `JSON.stringify(${expression})`,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "JS eval error");
    }
    try {
      return JSON.parse(result.result.value);
    } catch {
      return result.result.value;
    }
  }

  // ── Phantom Cursor Animation ──────────────────────────────────────────────
  // Inspired by Claude in Chrome's agent-visual-indicator.js
  // Shows a visible cursor that animates to the target element before acting.

  const CURSOR_SVG_PATH = "M0 0 L0 18 L4.5 14 L7.5 21.5 L11 20 L8 13 L14 13 Z";
  const CURSOR_COLOR_STROKE = "#7c3aed"; // Codebrain purple
  const CURSOR_COLOR_FILL = "#ffffff";
  const CURSOR_GLOW = "drop-shadow(0 0 4px rgba(124,58,237,0.9)) drop-shadow(0 0 10px rgba(124,58,237,0.45))";
  const CURSOR_TRANSITION_MS = 180;
  const CURSOR_SETTLE_MS = 50;

  /**
   * Inject the phantom cursor SVG into the page (idempotent).
   * If already present, no-op.
   */
  async function _injectCursor() {
    await evalJS(`(() => {
      if (document.getElementById('codebrain-phantom-cursor')) return;
      const container = document.createElement('div');
      container.id = 'codebrain-phantom-cursor';
      container.setAttribute('aria-hidden', 'true');
      container.style.cssText = \`
        position: fixed;
        top: 0; left: 0;
        pointer-events: none;
        z-index: 2147483646;
        transform: translate3d(-100px, -100px, 0);
        transition: transform ${CURSOR_TRANSITION_MS}ms cubic-bezier(0.2, 0, 0, 1);
        will-change: transform;
      \`;
      const ns = 'http://www.w3.org/2000/svg';
      const makePath = (attrs) => {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', '${CURSOR_SVG_PATH}');
        for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
        return p;
      };
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '26');
      svg.setAttribute('viewBox', '0 0 20 26');
      svg.style.cssText = 'position:absolute; top:0; left:0; overflow:visible; filter: ${CURSOR_GLOW};';
      svg.appendChild(makePath({ stroke: '${CURSOR_COLOR_STROKE}', 'stroke-width': '3', 'stroke-linejoin': 'round', fill: '${CURSOR_COLOR_STROKE}' }));
      svg.appendChild(makePath({ fill: '${CURSOR_COLOR_FILL}' }));
      container.appendChild(svg);
      document.body.appendChild(container);
    })()`);
  }

  /**
   * Move the phantom cursor to (x, y) and wait for the CSS transition.
   */
  async function _moveCursorTo(x, y) {
    await evalJS(`(() => {
      const el = document.getElementById('codebrain-phantom-cursor');
      if (!el) return;
      el.style.transform = 'translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)';
    })()`);
    // Wait for transition to complete
    await new Promise(r => setTimeout(r, CURSOR_TRANSITION_MS + CURSOR_SETTLE_MS));
  }

  /**
   * Remove the phantom cursor from the page.
   */
  async function _removeCursor() {
    await evalJS(`(() => {
      const el = document.getElementById('codebrain-phantom-cursor');
      if (el) el.remove();
    })()`);
  }

  return {
    // ─── Navigation ────────────────────────────────────────────────────
    async navigate(url) {
      await cdpClient.send("Page.navigate", { url });
      // Wait for load
      await new Promise((r) => setTimeout(r, 1500));
      const info = await cdpClient.getCurrentUrl();
      return { ok: true, url: info.url, title: info.title };
    },

    async back() {
      await evalJS("window.history.back()");
      await new Promise((r) => setTimeout(r, 500));
      const info = await cdpClient.getCurrentUrl();
      return { ok: true, url: info.url, title: info.title };
    },

    async forward() {
      await evalJS("window.history.forward()");
      await new Promise((r) => setTimeout(r, 500));
      const info = await cdpClient.getCurrentUrl();
      return { ok: true, url: info.url, title: info.title };
    },

    async reload(hard) {
      await evalJS(hard ? "location.reload(true)" : "location.reload()");
      await new Promise((r) => setTimeout(r, 1000));
      return { ok: true };
    },

    // ─── DOM Reading ───────────────────────────────────────────────────

    async getHtml(selector) {
      if (selector) {
        const html = await evalJS(
          `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ""`
        );
        return { ok: true, html };
      }
      // Clean body HTML (strip script/style/meta/comments)
      const html = await evalJS(`(() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script,style,meta,link,noscript,svg[class*="icon"]').forEach(el => el.remove());
        // Remove comments
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
        const comments = [];
        while (walker.nextNode()) comments.push(walker.currentNode);
        comments.forEach(c => c.remove());
        return clone.innerHTML;
      })()`);
      return { ok: true, html };
    },

    async getText(selector) {
      const text = selector
        ? await evalJS(
            `document.querySelector(${JSON.stringify(selector)})?.innerText || ""`
          )
        : await evalJS("document.body.innerText");
      return { ok: true, text };
    },

    async getUrl() {
      const info = await cdpClient.getCurrentUrl();
      return { ok: true, ...info };
    },

    async getA11yTree(maxDepth, maxNodes) {
      maxDepth = maxDepth || 10;
      maxNodes = maxNodes || 300;
      // Build ref map FIRST so __codebrainRef is set before JSON.stringify runs
      await this._buildRefMap();
      const tree = await evalJSON(`(() => {
        const maxDepth = ${maxDepth};
        const maxNodes = ${maxNodes};
        let nodeCount = 0;
        const getTree = (el, depth) => {
          if (depth > maxDepth || nodeCount > maxNodes) return null;
          nodeCount++;
          const rect = el.getBoundingClientRect();
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.textContent?.substring(0, 100) || '';
          const node = {
            role,
            label: (label || '').trim().substring(0, 200),
            bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            tag: el.tagName,
          };
          if (el.__codebrainRef) node.ref = el.__codebrainRef;
          if (el.disabled) node.disabled = true;
          if (el.checked !== undefined) node.checked = el.checked;
          if (el === document.activeElement) node.focused = true;
          const children = [];
          for (const child of el.children) {
            const c = getTree(child, depth + 1);
            if (c) children.push(c);
          }
          if (children.length) node.children = children;
          return node;
        };
        return getTree(document.body, 0);
      })()`);
      return { ok: true, tree, note: "Interactive elements have ref_N IDs — use browser_form_input to set values by ref." };
    },

    /**
     * _buildRefMap — Inject window.__claudeElementMap into the page.
     * Maps ref_N strings to DOM elements for stable references across calls.
     */
    async _buildRefMap() {
      const mapScript = `
        (function() {
          window.__claudeElementMap = window.__claudeElementMap || {};
          let refCount = Object.keys(window.__claudeElementMap).length;
          const all = document.querySelectorAll('button, a, input, select, textarea, [role]');
          all.forEach(el => {
            if (!el.__codebrainRef) {
              el.__codebrainRef = 'ref_' + (++refCount);
              window.__claudeElementMap[el.__codebrainRef] = new WeakRef(el);
            }
          });
          return refCount;
        })()
      `;
      await evalJS(mapScript);
    },

    /**
     * formInput — Set value on a form element identified by its ref_N reference.
     * Handles all input types correctly with proper DOM events.
     */
    async formInput({ ref, value }) {
      const encodedExpr = _safeEncodeForJS(value);
      const script = `
        (function() {
          if (!window.__claudeElementMap || !window.__claudeElementMap[${JSON.stringify(ref)}]) {
            return { error: 'Element ref not found: ' + ${JSON.stringify(ref)} + '. Call browser_get_accessibility_tree first.' };
          }
          const el = window.__claudeElementMap[${JSON.stringify(ref)}].deref();
          if (!el || !document.contains(el)) {
            delete window.__claudeElementMap[${JSON.stringify(ref)}];
            return { error: 'Element ' + ${JSON.stringify(ref)} + ' is no longer in the DOM.' };
          }
          if (el.disabled) return { error: 'Element ' + ${JSON.stringify(ref)} + ' is disabled.' };
          if (el.readOnly) return { error: 'Element ' + ${JSON.stringify(ref)} + ' is readonly.' };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var v = ${encodedExpr};
          if (el instanceof HTMLSelectElement) {
            const opts = Array.from(el.options);
            const idx = opts.findIndex(o => o.value === String(v) || o.text === String(v));
            if (idx < 0) return { error: 'Option not found: ' + v + '. Available: ' + opts.map(o => o.text).join(', ') };
            el.selectedIndex = idx;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, type: 'select', value: el.value };
          }
          if (el instanceof HTMLInputElement) {
            if (el.type === 'checkbox' || el.type === 'radio') {
              var falsy = ['', 'false', '0', 'no', 'off'];
              var checked = falsy.indexOf(String(v).toLowerCase().trim()) < 0;
              if (el.checked !== checked) { el.click(); }
              return { ok: true, type: el.type, checked: el.checked };
            }
            if (el.type === 'range' || el.type === 'number') {
              el.value = String(v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true, type: el.type, value: el.value };
            }
            el.focus();
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.value = String(v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, type: el.type, value: el.value };
          }
          if (el instanceof HTMLTextAreaElement) {
            el.focus();
            el.value = String(v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, type: 'textarea', value: el.value };
          }
          el.textContent = String(v);
          return { ok: true, type: 'other', tagName: el.tagName };
        })()
      `;
      return evalJSON(script);
    },

    async findByText(text, role, exact) {
      const results = await evalJSON(`(() => {
        const query = ${JSON.stringify(text)};
        const roleFilter = ${JSON.stringify(role || null)};
        const exact = ${!!exact};
        const allElements = document.querySelectorAll('*');
        const results = [];
        for (const el of allElements) {
          const elText = (el.textContent || '').trim();
          const ariaLabel = (el.getAttribute('aria-label') || '').trim();
          const placeholder = (el.getAttribute('placeholder') || '').trim();
          const matchesText = exact
            ? elText === query || ariaLabel === query || placeholder === query
            : elText.toLowerCase().includes(query.toLowerCase()) || ariaLabel.toLowerCase().includes(query.toLowerCase());
          const elRole = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName.toLowerCase());
          const matchesRole = !roleFilter || elRole === roleFilter || el.tagName.toLowerCase() === roleFilter;
          if (matchesText && matchesRole) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({
                tag: el.tagName,
                role: elRole,
                text: elText.substring(0, 200),
                selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : ''),
                bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                center: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)],
              });
            }
          }
        }
        return results.slice(0, 20);
      })()`);
      return { ok: true, elements: results };
    },

    /**
     * clickByText — Find element by visible text and click it.
     * Picks the most specific (deepest/leaf) match to avoid clicking parent containers.
     */
    async clickByText(text, role) {
      // Find matching elements
      const found = await this.findByText(text, role, false);
      if (!found.ok || !found.elements || found.elements.length === 0) {
        throw new Error('Element not found with text: ' + text);
      }
      // Pick the most specific element (smallest area = most specific)
      const best = found.elements.reduce((a, b) => {
        const areaA = a.bounds.w * a.bounds.h;
        const areaB = b.bounds.w * b.bounds.h;
        return areaA <= areaB ? a : b;
      });
      // Click using CDP Input domain (native, fast, works with SPAs)
      const cx = best.center[0];
      const cy = best.center[1];
      await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
      await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
      return { ok: true, clicked: best };
    },

    async getElement(selector) {
      const info = await evalJSON(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          text: (el.textContent || '').substring(0, 200).trim(),
          bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          disabled: el.disabled || false,
          checked: el.checked,
          value: el.value,
          href: el.href,
          src: el.src,
        };
      })()`);
      return info
        ? { ok: true, element: info }
        : { ok: false, error: "Element not found" };
    },

    // ─── DOM Interaction ───────────────────────────────────────────────

    async click(selector) {
      // Get coordinates via single Runtime.evaluate
      const coords = await evalJSON(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        return { cx: Math.round(rect.x + rect.width / 2), cy: Math.round(rect.y + rect.height / 2) };
      })()`);
      // Use CDP Input domain (native, works with React SPAs, no synthetic events)
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: coords.cx, y: coords.cy, button: "left", clickCount: 1,
      });
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: coords.cx, y: coords.cy, button: "left", clickCount: 1,
      });
      return { ok: true, x: coords.cx, y: coords.cy };
    },

    async fill(selector, value, clearFirst) {
      // Single Runtime.evaluate: scroll + focus + set value + dispatch events
      const encodedExpr = _safeEncodeForJS(value);
      const result = await evalJSON(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
        if (el.disabled) return { ok: false, error: 'Element is disabled: ' + ${JSON.stringify(selector)} };
        if (el.readOnly) return { ok: false, error: 'Element is readonly: ' + ${JSON.stringify(selector)} };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        if (${!!clearFirst}) { el.value = ''; }
        el.value = ${encodedExpr};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`);
      if (result && result.ok === false) throw new Error(result.error);
      return { ok: true };
    },

    async select(selector, valueOrText) {
      await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Select not found');
        const opts = Array.from(el.options);
        const match = opts.find(o => o.value === ${JSON.stringify(valueOrText)}) || opts.find(o => o.textContent.trim() === ${JSON.stringify(valueOrText)});
        if (!match) throw new Error('Option not found');
        el.value = match.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      return { ok: true };
    },

    async check(selector, checked) {
      const result = await evalJSON(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'Checkbox not found: ' + ${JSON.stringify(selector)} };
        if (el.disabled) return { ok: false, error: 'Checkbox is disabled: ' + ${JSON.stringify(selector)} };
        const shouldBeChecked = ${checked === undefined ? "!el.checked" : JSON.stringify(!!checked)};
        el.checked = shouldBeChecked;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, checked: el.checked };
      })()`);
      if (result && result.ok === false) throw new Error(result.error);
      return { ok: true };
    },

    async clear(selector) {
      await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found');
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      return { ok: true };
    },

    async focus(selector) {
      await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found');
        el.focus();
      })()`);
      return { ok: true };
    },

    async hover(selector) {
      const coords = await evalJSON(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = el.getBoundingClientRect();
        return { cx: Math.round(rect.x + rect.width / 2), cy: Math.round(rect.y + rect.height / 2) };
      })()`);
      // Use CDP Input domain (native mouseMoved, triggers real hover states)
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: coords.cx, y: coords.cy,
      });
      return { ok: true, x: coords.cx, y: coords.cy };
    },

    // ─── Coordinate Interaction ────────────────────────────────────────

    async clickAt(x, y, button) {
      const btn = button === "right" ? 2 : button === "middle" ? 1 : 0;
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: ["left", "middle", "right"][btn],
        clickCount: 1,
      });
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: ["left", "middle", "right"][btn],
        clickCount: 1,
      });
      return { ok: true, x, y, button: button || "left" };
    },

    async hoverAt(x, y) {
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });
      return { ok: true, x, y };
    },

    async drag(x1, y1, x2, y2, steps) {
      steps = steps || 10;
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: x1,
        y: y1,
        button: "left",
        clickCount: 1,
      });
      for (let i = 1; i <= steps; i++) {
        const cx = x1 + ((x2 - x1) * i) / steps;
        const cy = y1 + ((y2 - y1) * i) / steps;
        await cdpClient.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(cx),
          y: Math.round(cy),
        });
      }
      await cdpClient.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: x2,
        y: y2,
        button: "left",
        clickCount: 1,
      });
      return { ok: true, from: [x1, y1], to: [x2, y2] };
    },

    async scroll(selector, direction, amount) {
      if (selector) {
        await evalJS(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found');
          const dir = ${JSON.stringify(direction)};
          const amt = ${amount || 100};
          if (dir === 'down') el.scrollBy(0, amt);
          else if (dir === 'up') el.scrollBy(0, -amt);
          else if (dir === 'right') el.scrollBy(amt, 0);
          else if (dir === 'left') el.scrollBy(-amt, 0);
        })()`);
      } else {
        const deltaY =
          direction === "up"
            ? -(amount || 100)
            : direction === "down"
              ? amount || 100
              : 0;
        const deltaX =
          direction === "left"
            ? -(amount || 100)
            : direction === "right"
              ? amount || 100
              : 0;
        await cdpClient.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: 0,
          y: 0,
          deltaX,
          deltaY,
        });
      }
      return { ok: true, direction, amount: amount || 100 };
    },

    // ─── Keyboard ──────────────────────────────────────────────────────

    async type(text, delayMs) {
      if (delayMs && delayMs > 0) {
        for (const char of text) {
          await cdpClient.send("Input.insertText", { text: char });
          await new Promise((r) => setTimeout(r, delayMs));
        }
      } else {
        await cdpClient.send("Input.insertText", { text });
      }
      return { ok: true };
    },

    async key(key) {
      await cdpClient.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
      });
      await cdpClient.send("Input.dispatchKeyEvent", { type: "keyUp", key });
      return { ok: true, key };
    },

    async shortcut(keys) {
      // Parse "Ctrl+Shift+A" style shortcuts
      const parts = keys.split("+").map((k) => k.trim());
      const key = parts[parts.length - 1];
      const modifiers = parts.slice(0, -1);

      const modFlags = {
        ctrl: 2,
        control: 2,
        shift: 1,
        alt: 4,
        meta: 8,
        command: 8,
        cmd: 8,
      };
      let modBitmask = 0;
      for (const mod of modifiers) {
        modBitmask |= modFlags[mod.toLowerCase()] || 0;
      }

      // Key down with modifiers
      await cdpClient.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        modifiers: modBitmask,
      });
      // Key press (char) for printable keys
      if (key.length === 1) {
        await cdpClient.send("Input.dispatchKeyEvent", {
          type: "char",
          text: modifiers.some((m) => m.toLowerCase().startsWith("shift"))
            ? key.toUpperCase()
            : key.toLowerCase(),
          modifiers: modBitmask,
        });
      }
      // Key up
      await cdpClient.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        modifiers: modBitmask,
      });
      return { ok: true, keys };
    },

    // ─── Wait ──────────────────────────────────────────────────────────

    async waitFor(selector, timeoutMs) {
      timeoutMs = timeoutMs || 5000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evalJS(
          `!!document.querySelector(${JSON.stringify(selector)})`
        );
        if (found) return { ok: true, found: true };
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: true, found: false, timedOut: true };
    },

    async waitForText(text, selector, timeoutMs) {
      timeoutMs = timeoutMs || 5000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const scope = selector
          ? `document.querySelector(${JSON.stringify(selector)})?.innerText || ''`
          : "document.body.innerText";
        const bodyText = await evalJS(scope);
        if (bodyText && bodyText.includes(text))
          return { ok: true, found: true };
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: true, found: false, timedOut: true };
    },

    async waitForUrl(pattern, timeoutMs) {
      timeoutMs = timeoutMs || 5000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const url = await evalJS("location.href");
        if (url && url.includes(pattern))
          return { ok: true, url, matched: true };
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: true, matched: false, timedOut: true };
    },

    async waitForLoad(timeoutMs) {
      timeoutMs = timeoutMs || 10000;
      // Wait for Page.loadEventFired via polling document.readyState
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const state = await evalJS("document.readyState");
        if (state === "complete") return { ok: true, state: "complete" };
        await new Promise((r) => setTimeout(r, 300));
      }
      return { ok: true, timedOut: true };
    },

    // ─── Screenshot ────────────────────────────────────────────────────

    async screenshot(fullPage) {
      const opts = { format: "png" };
      if (fullPage) {
        // Get full page dimensions
        const dims = await evalJSON(`(() => ({
          width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
          height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        }))()`);
        // Cap at 8192px
        const width = Math.min(dims.width || 1280, 8192);
        const height = Math.min(dims.height || 720, 8192);
        // Set viewport to full page
        await cdpClient.send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        const result = await cdpClient.send("Page.captureScreenshot", opts);
        // Reset viewport
        await cdpClient.send("Emulation.clearDeviceMetricsOverride");
        return {
          ok: true,
          data: result.data,
          format: "png",
          width,
          height,
          mode: "full-page",
          note: "Base64 encoded PNG screenshot",
        };
      }
      const result = await cdpClient.send("Page.captureScreenshot", opts);
      return {
        ok: true,
        data: result.data,
        format: "png",
        mode: "viewport",
        note: "Base64 encoded PNG screenshot",
      };
    },

    // ─── Eval ──────────────────────────────────────────────────────────

    async evalJs(javascript) {
      const result = await evalJS(javascript);
      return { ok: true, result };
    },

    // ─── Page Summary ──────────────────────────────────────────────────

    async pageSummary() {
      const summary = await evalJSON(`(() => {
        const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({ text: a.textContent.trim().substring(0, 100), href: a.href }));
        const inputs = Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 20).map(el => ({ type: el.type, name: el.name, id: el.id, placeholder: el.placeholder }));
        const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]')).slice(0, 20).map(el => ({ text: el.textContent.trim().substring(0, 100), id: el.id }));
        return {
          url: location.href,
          title: document.title,
          text: document.body.innerText.substring(0, 5000),
          links,
          inputs,
          buttons,
        };
      })()`);
      return { ok: true, ...summary };
    },

    // ─── Console / Network ─────────────────────────────────────────────

    async readConsole(opts) {
      return cdpClient.getConsoleMessages(opts || {});
    },

    async readNetwork(opts) {
      return cdpClient.getNetworkRequests(opts || {});
    },

    // ═══════════════════════════════════════════════════════════════════
    // NOVOS: Ferramentas exclusivas CDP (sem fallback webview)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * computer — Mouse/keyboard/screen actions via CDP Input domain.
     * Portado do mcp-browser-bridge/src/tools.js _computer().
     */
    async computer(args) {
      const { action, coordinate, text, start_coordinate, scroll_direction, scroll_amount, wait_ms } = args;

      switch (action) {
        case "left_click": {
          if (!coordinate) throw new Error("coordinate required for left_click");
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 1 });
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 1 });
          return { success: true, action: "left_click", coordinate };
        }
        case "right_click": {
          if (!coordinate) throw new Error("coordinate required for right_click");
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coordinate[0], y: coordinate[1], button: "right", clickCount: 1 });
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coordinate[0], y: coordinate[1], button: "right", clickCount: 1 });
          return { success: true, action: "right_click", coordinate };
        }
        case "double_click": {
          if (!coordinate) throw new Error("coordinate required for double_click");
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 1 });
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 1 });
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 2 });
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 2 });
          return { success: true, action: "double_click", coordinate };
        }
        case "triple_click": {
          if (!coordinate) throw new Error("coordinate required for triple_click");
          for (let i = 0; i < 3; i++) {
            await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coordinate[0], y: coordinate[1], button: "left", clickCount: i + 1 });
            await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coordinate[0], y: coordinate[1], button: "left", clickCount: i + 1 });
          }
          return { success: true, action: "triple_click", coordinate };
        }
        case "left_click_drag": {
          if (!coordinate || !start_coordinate) throw new Error("coordinate and start_coordinate required");
          const steps = 10;
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start_coordinate[0], y: start_coordinate[1], button: "left", clickCount: 1 });
          for (let i = 1; i <= steps; i++) {
            const cx = start_coordinate[0] + ((coordinate[0] - start_coordinate[0]) * i) / steps;
            const cy = start_coordinate[1] + ((coordinate[1] - start_coordinate[1]) * i) / steps;
            await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(cx), y: Math.round(cy) });
          }
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coordinate[0], y: coordinate[1], button: "left", clickCount: 1 });
          return { success: true, action: "left_click_drag", from: start_coordinate, to: coordinate };
        }
        case "type": {
          if (!text) throw new Error("text required for type");
          await cdpClient.send("Input.insertText", { text });
          return { success: true, action: "type", text };
        }
        case "key": {
          if (!text) throw new Error("text required for key");
          await cdpClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: text });
          await cdpClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: text });
          return { success: true, action: "key", key: text };
        }
        case "screenshot": {
          const result = await cdpClient.send("Page.captureScreenshot", { format: "png" });
          return { data: result.data, format: "png" };
        }
        case "wait": {
          await new Promise((r) => setTimeout(r, wait_ms || 1000));
          return { success: true, action: "wait", ms: wait_ms || 1000 };
        }
        case "scroll": {
          const deltaY = scroll_direction === "up" ? -(scroll_amount || 100) : scroll_direction === "down" ? (scroll_amount || 100) : 0;
          const deltaX = scroll_direction === "left" ? -(scroll_amount || 100) : scroll_direction === "right" ? (scroll_amount || 100) : 0;
          await cdpClient.send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: coordinate?.[0] || 0,
            y: coordinate?.[1] || 0,
            deltaX,
            deltaY,
          });
          return { success: true, action: "scroll", direction: scroll_direction };
        }
        case "scroll_to": {
          if (!coordinate) throw new Error("coordinate required for scroll_to");
          await evalJS(`window.scrollTo(${coordinate[0]}, ${coordinate[1]})`);
          return { success: true, action: "scroll_to", coordinate };
        }
        case "hover": {
          if (!coordinate) throw new Error("coordinate required for hover");
          await cdpClient.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coordinate[0], y: coordinate[1] });
          return { success: true, action: "hover", coordinate };
        }
        case "zoom": {
          // Zoom via CSS transform emulation
          await evalJS(`document.body.style.zoom = '${args.zoom_level || "100%"}'`);
          return { success: true, action: "zoom" };
        }
        default:
          throw new Error(`Unknown computer action: ${action}`);
      }
    },

    /**
     * find — Find elements by natural language query.
     * Portado do mcp-browser-bridge/src/tools.js _find().
     */
    async find(args) {
      const results = await evalJSON(`(() => {
        const query = ${JSON.stringify(args.query)};
        const role = ${JSON.stringify(args.role || null)};
        const queryWords = query.toLowerCase().split(/\\s+/).filter(Boolean);
        const skipTags = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT']);
        const allElements = document.querySelectorAll('*');
        const candidates = [];
        for (const el of allElements) {
          if (skipTags.has(el.tagName)) continue;
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent)
            .join(' ')
            .toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const textContent = (el.textContent || '').toLowerCase();
          // Prefer own text and attributes over recursive textContent
          const directSearchable = ownText + ' ' + ariaLabel + ' ' + placeholder + ' ' + title;
          const fullSearchable = directSearchable + ' ' + textContent;
          // Match: words must appear in direct text OR (fallback) full text for elements with few children
          const childCount = el.children.length;
          const searchable = childCount <= 3 ? fullSearchable : directSearchable;
          const matchesText = queryWords.every(w => searchable.includes(w));
          const matchesRole = !role || el.tagName.toLowerCase() === role.toLowerCase() || (el.getAttribute('role') || '') === role;
          if (matchesText && matchesRole) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              candidates.push({
                tag: el.tagName,
                role: el.getAttribute('role') || el.tagName.toLowerCase(),
                text: (el.textContent || '').substring(0, 200).trim(),
                childCount: childCount,
                area: Math.round(rect.width * rect.height),
                bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                center: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)],
              });
            }
          }
        }
        // Sort by specificity: fewer children first, smaller area first
        candidates.sort((a, b) => (a.childCount - b.childCount) || (a.area - b.area));
        return candidates.slice(0, 20).map(({childCount, area, ...rest}) => rest);
      })()`);
      return results;
    },

    /**
     * tabsContext — List all open Chrome tabs.
     */
    async tabsContext() {
      const port = cdpClient.activePort || 9222;
      const targets = await cdpClient.discoverTargets(port);
      const tabs = (targets || [])
        .filter((t) => t.type === "page")
        .map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          active: t.attached || false,
        }));
      return { ok: true, tabs };
    },

    /**
     * tabsCreate — Create a new Chrome tab.
     * CRITICAL: Reconnects CDP WebSocket to the new tab so console/network
     * events from the new page are captured.
     */
    async tabsCreate(url) {
      const target = await cdpClient.send("Target.createTarget", {
        url: url || "about:blank",
      });
      const tabId = target.targetId;

      // Reconnect CDP to the new tab so events (console, network) are captured
      try {
        const port = cdpClient.activePort || 9223;
        const targets = await cdpClient.discoverTargets(port);
        const newTabTarget = targets.find(t => t.id === tabId && t.webSocketDebuggerUrl);
        if (newTabTarget) {
          // Close old WebSocket and connect to new tab via direct WS URL
          if (cdpClient.ws) {
            try { cdpClient.ws.close(); } catch {}
            cdpClient.ws = null;
            cdpClient.connected = false;
          }
          cdpClient._captureEnabled = false;
          await cdpClient.connect(port, newTabTarget.webSocketDebuggerUrl);
        }
      } catch (err) {
        // Non-fatal: tab created but events may not be captured
        if (this._debug) console.log('[CDP] tabsCreate reconnect warning:', err.message);
      }

      return { ok: true, tabId };
    },

    /**
     * tabsClose — Close a Chrome tab.
     */
    async tabsClose(tabId) {
      if (tabId) {
        await cdpClient.send("Target.closeTarget", { targetId: tabId });
      }
      return { ok: true };
    },

    /**
     * browserBatch — Execute multiple tool calls sequentially.
     */
    async browserBatch(actions) {
      const results = [];
      for (const action of actions) {
        try {
          const handler = action.tool;
          const handlerFn = this[handler] || this[handler.replace("browser_", "")];
          if (!handlerFn) {
            results.push({ tool: handler, success: false, error: `Unknown tool: ${handler}` });
            continue;
          }
          const result = await handlerFn.call(this, action.input || {});
          results.push({ tool: handler, success: true, result });
        } catch (err) {
          results.push({ tool: action.tool, success: false, error: err.message });
        }
      }
      return results;
    },

    /**
     * browserMode — Return current browser mode info.
     */
    async getMode() {
      return {
        mode: cdpClient.isConnected() ? "cdp" : "webview",
        port: cdpClient.activePort,
        connected: cdpClient.isConnected(),
      };
    },

    // ═══════════════════════════════════════════════════════════════════
    // Fetch Interception (CDP Fetch domain)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * interceptRequests — Enable request interception via CDP Fetch domain.
     * Pauses matching requests so they can be modified, blocked, or mocked.
     *
     * @param {Object} opts
     * @param {string[]} opts.urlPatterns - URL patterns to intercept (e.g. ["*api*", "*.js"])
     *   Each pattern supports wildcards: * = any chars, ? = single char
     * @param {string[]} opts.resourceTypes - Resource types to intercept
     *   (Document, Stylesheet, Image, Media, Font, Script, Texttrack, XHR, Fetch, EventSource, WebSocket, Manifest, SignedExchange, Ping, CSPViolationReport, Preflight, Other)
     * @param {boolean} opts.handleAuthRequests - Whether to handle auth challenges
     */
    async interceptRequests(opts) {
      const { urlPatterns, resourceTypes, handleAuthRequests } = opts || {};
      const patterns = (urlPatterns || ["*"]).map((p) => ({
        urlPattern: p,
        resourceType: resourceTypes ? undefined : undefined,
      }));

      const fetchOpts = {
        patterns: (urlPatterns || ["*"]).map((p) => ({
          urlPattern: p,
          requestStage: "Request",
        })),
      };
      if (handleAuthRequests) {
        fetchOpts.handleAuthRequests = true;
      }

      await cdpClient.send("Fetch.enable", fetchOpts);

      // Listen for Fetch.requestPaused events
      const pausedRequests = [];
      cdpClient._fetchPaused = pausedRequests;
      cdpClient._fetchEnabled = true;

      // Register handler for Fetch.requestPaused
      const origHandler = cdpClient._onCdpEvent;
      cdpClient._onCdpEvent = function (msg) {
        if (msg.method === "Fetch.requestPaused") {
          pausedRequests.push({
            requestId: msg.params.requestId,
            request: {
              url: msg.params.request.url,
              method: msg.params.request.method,
              headers: msg.params.request.headers,
              postData: msg.params.request.postData,
            },
            resourceType: msg.params.resourceType,
            responseStatusCode: msg.params.responseStatusCode,
            responseHeaders: msg.params.responseHeaders,
            frameId: msg.params.frameId,
            timestamp: Date.now(),
          });
        }
        if (origHandler) origHandler.call(this, msg);
      };

      return { ok: true, message: "Request interception enabled", patterns: urlPatterns || ["*"] };
    },

    /**
     * continueRequest — Continue an intercepted request (optionally modifying it).
     * Use this to let a paused request proceed, optionally changing URL, method, headers, or body.
     *
     * @param {string} requestId - The paused request ID
     * @param {Object} overrides - Optional modifications
     * @param {string} overrides.url - Override the request URL
     * @param {string} overrides.method - Override the HTTP method
     * @param {Object} overrides.headers - Override headers (key-value pairs)
     * @param {string} overrides.postData - Override POST body
     */
    async continueRequest(requestId, overrides) {
      const params = { requestId };
      if (overrides) {
        if (overrides.url) params.url = overrides.url;
        if (overrides.method) params.method = overrides.method;
        if (overrides.headers) {
          params.headers = Object.entries(overrides.headers).map(([name, value]) => ({ name, value }));
        }
        if (overrides.postData !== undefined) params.postData = overrides.postData;
      }
      await cdpClient.send("Fetch.continueRequest", params);
      return { ok: true, requestId, action: "continued" };
    },

    /**
     * fulfillRequest — Fulfill an intercepted request with a custom response.
     * Mock the server response entirely — return whatever you want.
     *
     * @param {string} requestId - The paused request ID
     * @param {Object} response - The mock response
     * @param {number} response.statusCode - HTTP status code (default: 200)
     * @param {Object} response.headers - Response headers (key-value pairs)
     * @param {string} response.body - Response body (text or base64)
     * @param {boolean} response.isBase64 - If true, body is base64-encoded
     */
    async fulfillRequest(requestId, response) {
      const { statusCode, headers, body, isBase64 } = response || {};
      const params = {
        requestId,
        responseCode: statusCode || 200,
        responseHeaders: headers
          ? Object.entries(headers).map(([name, value]) => ({ name, value }))
          : [],
        body: body ? (isBase64 ? body : Buffer.from(body).toString("base64")) : undefined,
      };
      await cdpClient.send("Fetch.fulfillRequest", params);
      return { ok: true, requestId, action: "fulfilled" };
    },

    /**
     * failRequest — Block/fail an intercepted request with an error reason.
     *
     * @param {string} requestId - The paused request ID
     * @param {string} reason - Error reason:
     *   Failed, Aborted, TimedOut, AccessDenied, ConnectionClosed, ConnectionReset,
     *   ConnectionRefused, ConnectionAborted, ConnectionFailed, NameNotResolved,
     *   InternetDisconnected, AddressUnreachable, BlockedByClient, BlockedByResponse
     */
    async failRequest(requestId, reason) {
      await cdpClient.send("Fetch.failRequest", {
        requestId,
        errorReason: reason || "BlockedByClient",
      });
      return { ok: true, requestId, action: "failed", reason: reason || "BlockedByClient" };
    },

    /**
     * continueResponse — Continue an intercepted response (after headers received).
     * Use this to modify response headers or body after the server has responded.
     *
     * @param {string} requestId - The paused request ID
     * @param {Object} overrides - Optional modifications
     * @param {string[]} overrides.headers - Modified response headers
     * @param {string} overrides.body - Modified response body (base64)
     */
    async continueResponse(requestId, overrides) {
      const params = { requestId };
      if (overrides) {
        if (overrides.headers) {
          params.responseHeaders = Object.entries(overrides.headers).map(([name, value]) => ({ name, value }));
        }
        if (overrides.body) params.binaryResponseHeaders = overrides.body;
      }
      await cdpClient.send("Fetch.continueResponse", params);
      return { ok: true, requestId, action: "response_continued" };
    },

    /**
     * stopIntercepting — Disable request interception.
     */
    async stopIntercepting() {
      await cdpClient.send("Fetch.disable");
      cdpClient._fetchEnabled = false;
      cdpClient._fetchPaused = [];
      return { ok: true, message: "Request interception disabled" };
    },

    /**
     * getPausedRequests — Get all paused (intercepted) requests.
     * Returns requests that were paused by interceptRequests() and haven't been
     * continued/fulfilled/failed yet.
     */
    async getPausedRequests() {
      return cdpClient._fetchPaused || [];
    },

    // ============================================================
    // FEATURES PORTED FROM CLAUDE IN CHROME (v1.0.75)
    // ============================================================

    /**
     * uploadFile — Upload files to a file input element.
     * Uses base64-encoded content to create File objects and set them on the input.
     *
     * @param {Object} args
     * @param {string} args.selector - CSS selector for the file input element
     * @param {Array<{name: string, content: string, mimeType: string}>} args.files - Files to upload (content is base64)
     */
    async uploadFile(args) {
      const { selector, files } = args;
      if (!selector) throw new Error("selector required");
      if (!files || !files.length) throw new Error("files array required");

      const result = await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ error: "Element not found: ${selector}" });
        if (el.tagName !== 'INPUT' || el.type !== 'file') return JSON.stringify({ error: "Element is not a file input" });

        const filesData = ${JSON.stringify(files)};
        const dt = new DataTransfer();

        for (const f of filesData) {
          const binaryStr = atob(f.content);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const file = new File([bytes], f.name, { type: f.mimeType || 'application/octet-stream' });
          dt.items.add(file);
        }

        el.files = dt.files;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ ok: true, filesSet: filesData.length, fileName: filesData.map(f => f.name) });
      })()`);
      return JSON.parse(result);
    },

    /**
     * uploadImage — Upload an image to an element (e.g., for image input in chat interfaces).
     * Creates a File object from base64 data and dispatches drag/drop or input events.
     *
     * @param {Object} args
     * @param {string} args.selector - Target element selector (drop zone or file input)
     * @param {string} args.image_data - Base64 encoded image data
     * @param {string} [args.mime_type] - MIME type (default: image/png)
     */
    async uploadImage(args) {
      const { selector, image_data, mime_type } = args;
      if (!selector) throw new Error("selector required");
      if (!image_data) throw new Error("image_data required");

      const mime = mime_type || "image/png";
      const result = await evalJS(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ error: "Element not found: ${selector}" });

        const b64 = ${JSON.stringify(image_data)};
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const file = new File([bytes], 'image.png', { type: ${JSON.stringify(mime)} });
        const dt = new DataTransfer();
        dt.items.add(file);

        // If it's a file input, set files directly
        if (el.tagName === 'INPUT' && el.type === 'file') {
          el.files = dt.files;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return JSON.stringify({ ok: true, method: 'file_input', fileName: 'image.png' });
        }

        // Otherwise, simulate drag-and-drop
        const dragEnter = new DragEvent('dragenter', { bubbles: true, dataTransfer: dt });
        const dragOver = new DragEvent('dragover', { bubbles: true, dataTransfer: dt });
        const drop = new DragEvent('drop', { bubbles: true, dataTransfer: dt });
        el.dispatchEvent(dragEnter);
        el.dispatchEvent(dragOver);
        el.dispatchEvent(drop);
        return JSON.stringify({ ok: true, method: 'drag_drop', fileName: 'image.png' });
      })()`);
      return JSON.parse(result);
    },

    /**
     * resizeWindow — Resize the browser window.
     * Uses CDP Browser domain to change window dimensions.
     *
     * @param {Object} args
     * @param {number} args.width - New width in pixels
     * @param {number} args.height - New height in pixels
     */
    async resizeWindow(args) {
      const { width, height } = args;
      if (!width || !height) throw new Error("width and height required");

      const { windowId } = await cdpClient.send("Browser.getWindowForTarget");
      await cdpClient.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width, height },
      });
      return { ok: true, width, height };
    },

    /**
     * screenshotElement — Capture screenshot of a specific element via CDP.
     * Uses DOM.querySelector to find the element, gets its bounding box,
     * then captures with clip parameter.
     *
     * @param {string} selector - CSS selector for the target element
     */
    async screenshotElement(selector) {
      if (!selector) throw new Error("selector required");

      // Get element bounding box via JS
      const bounds = await evalJSON(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: el.textContent?.substring(0, 500) };
      })()`);

      if (!bounds) throw new Error(`Element not found: ${selector}`);
      if (bounds.width === 0 || bounds.height === 0) throw new Error(`Element has zero dimensions: ${selector}`);

      // Capture screenshot with clip to element bounds
      const result = await cdpClient.send("Page.captureScreenshot", {
        format: "png",
        clip: {
          x: Math.max(0, bounds.x),
          y: Math.max(0, bounds.y),
          width: Math.min(bounds.width, 4096),
          height: Math.min(bounds.height, 4096),
          scale: 1,
        },
      });

      // Save to file
      const fs = require("node:fs");
      const path = require("node:path");
      const screenshotsDir = path.join(process.cwd(), ".codebrain", "screenshots");
      if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
      const filename = `element-${Date.now()}.png`;
      const filepath = path.join(screenshotsDir, filename);
      fs.writeFileSync(filepath, Buffer.from(result.data, "base64"));

      return {
        ok: true,
        path: filepath,
        filename,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        text: bounds.text,
      };
    },

    /**
     * gifCreator — GIF recording stub.
     * Full GIF recording requires the Chrome extension's offscreen document.
     */
    async gifCreator(args) {
      return {
        ok: false,
        note: "GIF recording requires the Claude Chrome extension's offscreen document. Use browser_screenshot for static captures.",
        action: args?.action || "unknown",
      };
    },

    /**
     * shortcutsList — Shortcuts stub.
     * Full shortcuts require the Chrome extension's bookmark system.
     */
    async shortcutsList() {
      return {
        shortcuts: [],
        note: "Shortcuts require the Claude Chrome extension. Use browser_navigate for direct URL navigation.",
      };
    },

    /**
     * shortcutsExecute — Shortcuts execution stub.
     */
    async shortcutsExecute(args) {
      return {
        ok: false,
        note: "Shortcuts require the Claude Chrome extension. Use browser_navigate instead.",
        shortcut_id: args?.shortcut_id,
      };
    },
  };
}

module.exports = { createNativeChromeHandlers };
