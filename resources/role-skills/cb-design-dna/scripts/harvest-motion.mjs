#!/usr/bin/env node
/*
 * harvest-motion.mjs — MOTION + EFFECT live capture for cb-design-dna.   [CB-DESIGN-MOTION]
 *
 * Usage:  node harvest-motion.mjs <url> <outdir> [--no-strips] [--timeout=60000]
 *
 * A SEPARATE PASS from harvest.mjs, on purpose. harvest.mjs freezes the page
 * (`animation-duration:0s`, `transition:none`, force-show `[class*="reveal"]`)
 * so it can photograph a settled final state — which makes it structurally
 * blind to motion. This script measures exactly what that freeze destroys, and
 * runs BEFORE any freeze.
 *
 * The three capture tricks that make it see what CSS scraping cannot:
 *   1. INIT HOOKS (installed before any page script runs) — wraps
 *      `HTMLCanvasElement.prototype.getContext`, `IntersectionObserver` and
 *      `Element.prototype.animate`. That records the real reveal thresholds and
 *      JS-driven (Framer/GSAP) motion, neither of which exists in the CSS.
 *   2. KEYFRAME BODIES — walks `document.styleSheets` for `CSSKeyframesRule` and
 *      emits every offset with its properties. A cross-origin sheet throws on
 *      `.cssRules`; its href is re-fetched over HTTP and regex-parsed instead of
 *      being silently dropped.
 *   3. FRAME-STRIP — restarts each animated element, pauses it, pins
 *      `currentTime` at t=0/.25/.5/.75/1 and screenshots each point. Motion
 *      becomes deterministic, diffable evidence instead of prose.
 *
 * Emits:  <outdir>/source/motion.json
 *         <outdir>/screenshots/motion/<name>-t{000,025,050,075,100}.png
 *
 * Every measured value is { value, confidence, source, hits } — the same
 * Open-Design confidence model harvest.json v1 uses. Nothing is invented: a
 * slot with no evidence is omitted and named under `risks`.
 *
 * Zero deps beyond Playwright (resolved from cwd / skill dir / repo root).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..");

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const [url, outdir] = positional;
const timeoutArg = argv.find((a) => a.startsWith("--timeout="));
const NAV_TIMEOUT = timeoutArg ? Number(timeoutArg.split("=")[1]) : 60000;
const WANT_STRIPS = !flags.has("--no-strips");

if (!url || !outdir) {
  console.error("usage: node harvest-motion.mjs <url> <outdir> [--no-strips] [--timeout=ms]");
  process.exit(2);
}

const OUT = resolve(process.cwd(), outdir);
const SOURCE_DIR = join(OUT, "source");
const STRIP_DIR = join(OUT, "screenshots", "motion");
mkdirSync(SOURCE_DIR, { recursive: true });
if (WANT_STRIPS) mkdirSync(STRIP_DIR, { recursive: true });

const log = (...a) => console.log("[motion]", ...a);
const risks = [];
const risk = (m) => {
  if (!risks.includes(m)) risks.push(m);
};

// ── playwright resolution (no install step required) ──────────────────────
async function loadPlaywright() {
  const candidates = [
    "playwright",
    join(process.cwd(), "node_modules", "playwright", "index.js"),
    join(SKILL_DIR, "node_modules", "playwright", "index.js"),
    join(SKILL_DIR, "..", "..", "..", "..", "..", "..", "node_modules", "playwright", "index.js"),
  ];
  for (const c of candidates) {
    try {
      return await import(c.startsWith("/") ? pathToFileURL(c).href : c);
    } catch {
      /* next */
    }
  }
  console.error(
    "[motion] playwright not resolvable. Run `pnpm add -D playwright` at the repo root, or run this script from a dir that has it."
  );
  process.exit(2);
}

// ── the init hooks, stringified into the page before any site script ──────
const INIT_HOOKS = `
(() => {
  const S = (window.__cbMotion = {
    canvasContexts: [],
    observers: [],
    waapi: [],
    rafPeak: 0,
  });

  // Shared helpers live on window instead of being eval()'d inside each
  // page.evaluate: a site whose CSP omits 'unsafe-eval' (most modern hosts)
  // kills eval and would take the whole capture down with it.
  window.__cbUtil = {
    cssPath: function (el) {
      if (!el || el.nodeType !== 1) return null;
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        if (node.id) { parts.unshift(part + '#' + node.id); break; }
        const cls = (typeof node.className === 'string' && node.className.trim())
          ? node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
        if (cls.length) part += '.' + cls.join('.');
        const parent = node.parentElement;
        if (parent) {
          const sibs = Array.prototype.filter.call(parent.children, function (c) {
            return c.tagName === node.tagName;
          });
          if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    },
    msOf: function (v) {
      if (!v) return 0;
      const s = String(v).trim();
      if (s.endsWith('ms')) return parseFloat(s);
      if (s.endsWith('s')) return parseFloat(s) * 1000;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    },
  };

  // 1. canvas contexts — records WHAT the site asked for, without us probing
  //    (probing getContext ourselves would mutate canvas state).
  try {
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      try { if (!S.canvasContexts.includes(type)) S.canvasContexts.push(type); } catch (e) {}
      return gc.call(this, type, ...rest);
    };
  } catch (e) {}

  // 2. IntersectionObserver — the REAL reveal trigger: threshold + rootMargin.
  try {
    const IO = window.IntersectionObserver;
    if (IO) {
      window.IntersectionObserver = function (cb, opts) {
        try {
          S.observers.push({
            threshold: (opts && opts.threshold) !== undefined ? opts.threshold : null,
            rootMargin: (opts && opts.rootMargin) || null,
          });
        } catch (e) {}
        return new IO(cb, opts);
      };
      window.IntersectionObserver.prototype = IO.prototype;
    }
  } catch (e) {}

  // 3. Element.animate — catches JS-driven motion (Framer Motion, GSAP via
  //    WAAPI, hand-rolled). None of this is visible in the stylesheet.
  try {
    const an = Element.prototype.animate;
    if (an) {
      Element.prototype.animate = function (keyframes, options) {
        try {
          S.waapi.push({
            tag: this.tagName ? this.tagName.toLowerCase() : null,
            cls: typeof this.className === 'string' ? this.className.slice(0, 120) : null,
            keyframes: JSON.parse(JSON.stringify(keyframes || null)),
            options: (options && typeof options === 'object')
              ? JSON.parse(JSON.stringify(options))
              : options || null,
          });
        } catch (e) {}
        return an.call(this, keyframes, options);
      };
    }
  } catch (e) {}
})();
`;

// ── bot-wall detection ────────────────────────────────────────────────────
// A capture is worthless — worse, actively misleading — if what got
// photographed was a Cloudflare interstitial. x.ai serves exactly that to
// headless Chromium: 48 elements, title "Attention Required!". Without this
// guard the run "succeeds" and emits a design system of the block page, every
// value stamped `observed`. Honest failure beats confident garbage.
const BLOCK_SIGNATURES = [
  /attention required/i,
  /just a moment/i,
  /sorry, you have been blocked/i,
  /checking your browser/i,
  /verify (you are|you're) human/i,
  /access denied/i,
  /unusual traffic/i,
  /enable javascript and cookies to continue/i,
];

async function pageDiag(pg) {
  return pg.evaluate(() => ({
    title: document.title || "",
    text: document.body ? document.body.innerText.slice(0, 500) : "",
    els: document.querySelectorAll("*").length,
    sheets: document.styleSheets.length,
  }));
}

function blockReason(d) {
  const hay = `${d.title}\n${d.text}`;
  const sig = BLOCK_SIGNATURES.find((re) => re.test(hay));
  if (sig) return `bot wall matched ${sig}`;
  // A real landing page is never this thin. 48 elements was the Cloudflare page.
  if (d.els < 60) return `page has only ${d.els} elements — almost certainly an interstitial, not the site`;
  return null;
}

// Real-browser fingerprint. Headless Chromium announces itself three ways:
// the UA string, navigator.webdriver, and the AutomationControlled blink
// feature. All three get corrected before the site's first script runs.
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const STEALTH_INIT = `
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch (e) {}
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    }
  } catch (e) {}
  try {
    const gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Apple Inc.';
      if (p === 37446) return 'Apple GPU';
      return gp.call(this, p);
    };
  } catch (e) {}
`;

// ── main — escalating launch: cheapest mode first, headed real Chrome last ─
const { chromium } = await loadPlaywright();
const LAUNCH_MODES = [
  { name: "stealth-headless", headless: true, channel: null },
  { name: "headed-chrome", headless: false, channel: "chrome" },
  { name: "headed-chromium", headless: false, channel: null },
];
if (flags.has("--headed")) LAUNCH_MODES.shift(); // skip straight to a visible browser

let browser = null;
let context = null;
let page = null;
let usedMode = null;
const launchLog = [];

for (const mode of LAUNCH_MODES) {
  let b = null;
  try {
    b = await chromium.launch({
      headless: mode.headless,
      ...(mode.channel ? { channel: mode.channel } : {}),
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const ctx = await b.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: "no-preference",
      userAgent: REAL_UA.replace(/Headless/gi, ""),
      locale: "en-US",
      timezoneId: "America/Sao_Paulo",
    });
    await ctx.addInitScript(STEALTH_INIT);
    await ctx.addInitScript(INIT_HOOKS);
    const pg = await ctx.newPage();

    log(`navigating (${mode.name})`, url);
    try {
      await pg.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    } catch {
      await pg.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      risk(`networkidle never settled within ${NAV_TIMEOUT}ms (${mode.name}) — late-mounted motion may be missing`);
    }
    await pg.waitForTimeout(2500); // give a challenge time to resolve itself

    let diag = await pageDiag(pg);
    let reason = blockReason(diag);
    if (reason) {
      // Cloudflare's JS challenge clears on its own after a few seconds.
      await pg.waitForTimeout(6000);
      diag = await pageDiag(pg);
      reason = blockReason(diag);
    }
    if (reason) {
      launchLog.push(`${mode.name}: ${reason}`);
      log(`blocked in ${mode.name} — ${reason}`);
      await b.close();
      continue;
    }

    browser = b;
    context = ctx;
    page = pg;
    usedMode = mode.name;
    launchLog.push(`${mode.name}: passed (${diag.els} elements, ${diag.sheets} stylesheets)`);
    log(`through as ${mode.name} — ${diag.els} elements, ${diag.sheets} stylesheets`);
    break;
  } catch (e) {
    launchLog.push(`${mode.name}: launch/nav failed — ${e.message.split("\n")[0]}`);
    log(`${mode.name} unavailable — ${e.message.split("\n")[0]}`);
    try {
      if (b) await b.close();
    } catch {}
  }
}

if (!page) {
  console.error("[motion] ABORTED — never reached the real page. No motion.json written (a design system of a block page is worse than none):");
  launchLog.forEach((l) => console.error("  ·", l));
  console.error("[motion] try: --headed, or capture a logged-in/allowlisted context manually.");
  process.exit(1);
}

if (usedMode !== "stealth-headless") risk(`headless was blocked; captured via ${usedMode}`);

try {
  await page.evaluate(() => document.fonts && document.fonts.ready);
} catch {
  /* non-fatal */
}
await page.waitForTimeout(1200); // let entrance animations mount

// ── 1. keyframe bodies (+ cross-origin sheet hrefs for the HTTP fallback) ─
log("collecting @keyframes bodies");
const kfResult = await page.evaluate(() => {
  const out = [];
  const unreadable = [];
  const seen = new Set();
  const walk = (rules) => {
    for (const rule of Array.from(rules || [])) {
      const isKeyframes =
        rule.type === 7 || (rule.constructor && rule.constructor.name === "CSSKeyframesRule");
      if (isKeyframes) {
        if (seen.has(rule.name)) continue;
        seen.add(rule.name);
        const offsets = Array.from(rule.cssRules || []).map((kf) => {
          const props = {};
          const st = kf.style;
          for (let i = 0; i < st.length; i++) {
            const p = st[i];
            props[p] = st.getPropertyValue(p);
          }
          return { offset: kf.keyText, props };
        });
        out.push({ name: rule.name, offsets });
      } else if (rule.cssRules) {
        walk(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href) unreadable.push(sheet.href);
      continue;
    }
    walk(rules);
  }
  return { keyframes: out, unreadable };
});

// cross-origin sheets: re-fetch and regex-parse rather than dropping them
let keyframes = kfResult.keyframes;
if (kfResult.unreadable.length) {
  risk(
    `${kfResult.unreadable.length} stylesheet(s) unreadable from the DOM (cross-origin) — re-fetched over HTTP and regex-parsed`
  );
  for (const href of kfResult.unreadable) {
    try {
      const res = await context.request.get(href, { timeout: 15000 });
      if (!res.ok()) continue;
      const css = await res.text();
      const re = /@(?:-webkit-)?keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
      let m;
      while ((m = re.exec(css))) {
        const name = m[1];
        if (keyframes.some((k) => k.name === name)) continue;
        // brace-match the block body
        let depth = 1;
        let i = re.lastIndex;
        while (i < css.length && depth > 0) {
          if (css[i] === "{") depth++;
          else if (css[i] === "}") depth--;
          i++;
        }
        const body = css.slice(re.lastIndex, i - 1);
        const offsets = [];
        const stepRe = /([0-9.]+%|from|to)\s*\{([^}]*)\}/g;
        let s;
        while ((s = stepRe.exec(body))) {
          const props = {};
          s[2]
            .split(";")
            .map((d) => d.trim())
            .filter(Boolean)
            .forEach((d) => {
              const idx = d.indexOf(":");
              if (idx > 0) props[d.slice(0, idx).trim()] = d.slice(idx + 1).trim();
            });
          offsets.push({ offset: s[1], props });
        }
        keyframes.push({ name, offsets, viaHttpFallback: true });
      }
    } catch {
      risk(`stylesheet could not be re-fetched: ${new URL(href).pathname}`);
    }
  }
}

// ── 2. reveals: measure the trigger by stepping the scroll ────────────────
log("measuring scroll reveals");
const reveals = await page.evaluate(
  async () => {
    const U = window.__cbUtil || { cssPath: () => null, msOf: () => 0 };
    const cssPath = U.cssPath;
    const candidates = Array.from(document.querySelectorAll("*")).filter((el) => {
      const cs = getComputedStyle(el);
      const hidden = parseFloat(cs.opacity) < 0.9 || (cs.transform && cs.transform !== "none");
      const movable =
        (cs.animationName && cs.animationName !== "none") ||
        (cs.transitionDuration && cs.transitionDuration !== "0s");
      const r = el.getBoundingClientRect();
      return hidden && movable && r.width > 40 && r.height > 20;
    });
    const tracked = candidates.slice(0, 120).map((el) => ({
      el,
      selector: cssPath(el),
      startOpacity: parseFloat(getComputedStyle(el).opacity),
      startTransform: getComputedStyle(el).transform,
      fired: null,
    }));
    const H = window.innerHeight;
    const total = document.body.scrollHeight;
    for (let y = 0; y <= total; y += Math.round(H / 3)) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 160));
      for (const t of tracked) {
        if (t.fired) continue;
        const cs = getComputedStyle(t.el);
        const now = parseFloat(cs.opacity);
        const movedIn = now >= 0.9 && t.startOpacity < 0.9;
        const untransformed = cs.transform === "none" && t.startTransform !== "none";
        if (movedIn || untransformed) {
          const r = t.el.getBoundingClientRect();
          const visible = Math.max(0, Math.min(H, r.bottom) - Math.max(0, r.top));
          t.fired = {
            scrollY: y,
            triggerRatio: r.height > 0 ? Number((visible / r.height).toFixed(3)) : null,
            property: movedIn ? "opacity" : "transform",
            from: movedIn ? t.startOpacity : t.startTransform,
            to: movedIn ? now : cs.transform,
          };
        }
      }
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    return tracked.filter((t) => t.fired).map((t) => ({ selector: t.selector, ...t.fired }));
  }
);

// ── 3. effects, transitions, stagger, reduced-motion, canvas, hooks ───────
log("collecting effects / transitions / stagger");
const bulk = await page.evaluate(
  () => {
    const U = window.__cbUtil || { cssPath: () => null, msOf: () => 0 };
    const cssPath = U.cssPath;
    const msOf = U.msOf;
    const rank = (o) =>
      Object.entries(o)
        .map(([value, hits]) => ({ value, hits }))
        .sort((a, b) => b.hits - a.hits);

    const backdrop = {};
    const filters = {};
    const blends = {};
    const glows = {};
    const maskClip = {};
    const animatedGradients = {};
    const durations = {};
    const easings = {};
    const delays = {};
    const transitions = {};
    const animatedEls = [];
    const withBackdrop = [];
    const withFilter = [];

    const els = Array.from(document.querySelectorAll("*"));
    for (const el of els) {
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== "none") {
        backdrop[bf] = (backdrop[bf] || 0) + 1;
        if (withBackdrop.length < 25) withBackdrop.push({ value: bf, selector: cssPath(el) });
      }
      if (cs.filter && cs.filter !== "none") {
        filters[cs.filter] = (filters[cs.filter] || 0) + 1;
        if (withFilter.length < 25) withFilter.push({ value: cs.filter, selector: cssPath(el) });
      }
      if (cs.mixBlendMode && cs.mixBlendMode !== "normal")
        blends[cs.mixBlendMode] = (blends[cs.mixBlendMode] || 0) + 1;
      // a glow reads as a shadow with no offset and a real blur
      if (cs.boxShadow && cs.boxShadow !== "none") {
        const noOffset = /(^|\s)0px\s+0px\s+([1-9]\d*)px/.test(cs.boxShadow);
        if (noOffset) glows[cs.boxShadow] = (glows[cs.boxShadow] || 0) + 1;
      }
      if (cs.clipPath && cs.clipPath !== "none")
        maskClip[`clip-path: ${cs.clipPath}`] = (maskClip[`clip-path: ${cs.clipPath}`] || 0) + 1;
      if (cs.maskImage && cs.maskImage !== "none")
        maskClip[`mask-image: ${cs.maskImage}`] = (maskClip[`mask-image: ${cs.maskImage}`] || 0) + 1;

      const aName = cs.animationName;
      if (aName && aName !== "none") {
        const dur = msOf(cs.animationDuration);
        const del = msOf(cs.animationDelay);
        if (dur) durations[cs.animationDuration] = (durations[cs.animationDuration] || 0) + 1;
        if (cs.animationTimingFunction)
          easings[cs.animationTimingFunction] = (easings[cs.animationTimingFunction] || 0) + 1;
        if (del) delays[cs.animationDelay] = (delays[cs.animationDelay] || 0) + 1;
        if ((cs.backgroundImage || "").includes("gradient")) {
          const k = `${aName} on ${cs.backgroundImage.slice(0, 90)}`;
          animatedGradients[k] = (animatedGradients[k] || 0) + 1;
        }
        if (animatedEls.length < 60)
          animatedEls.push({
            selector: cssPath(el),
            name: aName,
            durationMs: dur,
            delayMs: del,
            easing: cs.animationTimingFunction,
            iterations: cs.animationIterationCount,
            direction: cs.animationDirection,
            fill: cs.animationFillMode,
          });
      }

      const td = cs.transitionDuration;
      if (td && td !== "0s") {
        const props = (cs.transitionProperty || "all").split(",").map((s) => s.trim());
        const durs = td.split(",").map((s) => s.trim());
        const eases = (cs.transitionTimingFunction || "").split(/,(?![^(]*\))/).map((s) => s.trim());
        const dels = (cs.transitionDelay || "").split(",").map((s) => s.trim());
        props.forEach((p, i) => {
          const d = durs[i] || durs[0];
          if (!d || d === "0s") return;
          const key = `${p}|${d}|${eases[i] || eases[0] || ""}|${dels[i] || dels[0] || "0s"}`;
          transitions[key] = (transitions[key] || 0) + 1;
          durations[d] = (durations[d] || 0) + 1;
          const e = eases[i] || eases[0];
          if (e) easings[e] = (easings[e] || 0) + 1;
        });
      }
    }

    // stagger: siblings whose animation/transition delay climbs in a constant step
    const stagger = [];
    const parents = new Set(
      els.filter((e) => {
        const cs = getComputedStyle(e);
        return msOf(cs.animationDelay) > 0 || msOf(cs.transitionDelay) > 0;
      }).map((e) => e.parentElement)
    );
    for (const parent of parents) {
      if (!parent) continue;
      const kids = Array.from(parent.children);
      if (kids.length < 3) continue;
      const ds = kids.map((k) => {
        const cs = getComputedStyle(k);
        return msOf(cs.animationDelay) || msOf(cs.transitionDelay);
      });
      const steps = ds.slice(1).map((d, i) => d - ds[i]);
      const positive = steps.filter((s) => s > 0);
      if (positive.length < 2) continue;
      const step = positive[0];
      const consistent = positive.every((s) => Math.abs(s - step) <= Math.max(8, step * 0.25));
      if (consistent)
        stagger.push({ selector: cssPath(parent), stepMs: step, count: kids.length, delaysMs: ds });
    }

    // prefers-reduced-motion rules the site actually declares
    let rmRules = 0;
    const rmDecls = [];
    const walkRm = (rules) => {
      for (const rule of Array.from(rules || [])) {
        if (rule.media && /prefers-reduced-motion/.test(rule.conditionText || rule.media.mediaText || "")) {
          const inner = Array.from(rule.cssRules || []);
          rmRules += inner.length;
          inner.slice(0, 8).forEach((r) => rmDecls.push(r.cssText.slice(0, 160)));
        } else if (rule.cssRules) walkRm(rule.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walkRm(sheet.cssRules);
      } catch {
        /* cross-origin — already recorded as a risk */
      }
    }

    // canvas + motion libs
    const hooks = window.__cbMotion || { canvasContexts: [], observers: [], waapi: [] };
    const canvases = Array.from(document.querySelectorAll("canvas")).map((c) => ({
      selector: cssPath(c),
      width: c.width,
      height: c.height,
    }));
    const libs = [];
    const probe = {
      three: !!window.THREE,
      gsap: !!window.gsap,
      ScrollTrigger: !!(window.ScrollTrigger || (window.gsap && window.gsap.ScrollTrigger)),
      lenis: !!(window.Lenis || window.lenis),
      framerMotion: !!(window.Motion || document.querySelector("[data-framer-name]")),
      lottie: !!(window.lottie || window.bodymovin),
    };
    Object.entries(probe).forEach(([k, v]) => {
      if (v) libs.push(k);
    });
    Array.from(document.scripts).forEach((s) => {
      const m = (s.src || "").match(/(three|ogl|regl|gsap|lenis|framer-motion|motion|lottie|anime)[.@/-]/i);
      if (m && !libs.includes(m[1].toLowerCase())) libs.push(m[1].toLowerCase());
    });

    return {
      effects: {
        backdropFilter: rank(backdrop),
        backdropFilterWhere: withBackdrop,
        filter: rank(filters),
        filterWhere: withFilter,
        mixBlendMode: rank(blends),
        glowShadows: rank(glows),
        maskClip: rank(maskClip),
        animatedGradients: rank(animatedGradients),
      },
      transitions: rank(transitions).map(({ value, hits }) => {
        const [property, duration, easing, delay] = value.split("|");
        return { property, duration, easing, delay, hits };
      }),
      animatedEls,
      stagger,
      durations: rank(durations),
      easings: rank(easings),
      delays: rank(delays),
      reducedMotion: { ruleCount: rmRules, sample: rmDecls },
      canvas: { count: canvases.length, elements: canvases, contexts: hooks.canvasContexts, libs },
      hooks: {
        intersectionObservers: hooks.observers.slice(0, 30),
        waapiCalls: hooks.waapi.slice(0, 40),
        waapiTotal: hooks.waapi.length,
      },
    };
  }
);

// ── 4. frame-strips — pin currentTime and photograph each point ───────────
const frameStrips = [];
if (WANT_STRIPS) {
  log("shooting frame-strips");
  const picked = await page.evaluate(
    () => {
      const U = window.__cbUtil || { cssPath: () => null, msOf: () => 0 };
      const cssPath = U.cssPath;
      const msOf = U.msOf;
      const out = [];
      const els = Array.from(document.querySelectorAll("*")).filter((el) => {
        const cs = getComputedStyle(el);
        if (!cs.animationName || cs.animationName === "none") return false;
        const r = el.getBoundingClientRect();
        return r.width > 60 && r.height > 24;
      });
      els.slice(0, 8).forEach((el, i) => {
        el.setAttribute("data-cb-anim", String(i));
        const cs = getComputedStyle(el);
        out.push({
          i,
          name: cs.animationName.split(",")[0].trim(),
          selector: cssPath(el),
          durationMs: msOf(cs.animationDuration),
        });
      });
      return out;
    }
  );

  if (!picked.length) risk("no CSS-animated element large enough to frame-strip was found");

  const STOPS = [0, 0.25, 0.5, 0.75, 1];
  for (const p of picked) {
    const frames = [];
    for (const t of STOPS) {
      const ok = await page.evaluate(
        ({ i, t }) => {
          const el = document.querySelector(`[data-cb-anim="${i}"]`);
          if (!el) return false;
          try {
            el.scrollIntoView({ block: "center" });
          } catch {}
          // restart the CSS animation so a finished one is scrubbable again
          try {
            const prev = el.style.animation;
            el.style.animation = "none";
            void el.offsetWidth;
            el.style.animation = prev;
          } catch {}
          const anims = el.getAnimations ? el.getAnimations() : [];
          if (!anims.length) return false;
          let pinned = 0;
          for (const a of anims) {
            try {
              a.pause();
              const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
              const d = timing && typeof timing.duration === "number" ? timing.duration : null;
              if (d && d > 0) {
                a.currentTime = d * t;
                pinned++;
              }
            } catch {}
          }
          return pinned > 0;
        },
        { i: p.i, t }
      );
      if (!ok) continue;
      await page.waitForTimeout(60);
      const label = String(Math.round(t * 100)).padStart(3, "0");
      const safe = p.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const file = join(STRIP_DIR, `${safe}-t${label}.png`);
      try {
        await page.locator(`[data-cb-anim="${p.i}"]`).first().screenshot({ path: file, timeout: 8000 });
        frames.push(`screenshots/motion/${safe}-t${label}.png`);
      } catch {
        /* element may be off-layout at this scrub point */
      }
    }
    if (frames.length) {
      // the gate that matters: are the frames actually DIFFERENT?
      const hashes = frames.map((f) => {
        try {
          return createHash("sha1").update(readFileSync(join(OUT, f))).digest("hex");
        } catch {
          return Math.random().toString();
        }
      });
      const distinct = new Set(hashes).size;
      frameStrips.push({
        name: p.name,
        selector: p.selector,
        durationMs: p.durationMs,
        frames,
        distinctFrames: distinct,
        proofOfMotion: distinct > 1,
      });
      if (distinct <= 1)
        risk(`frame-strip for "${p.name}" produced identical frames — the animation may be paused, off-screen or non-visual`);
    } else {
      risk(`frame-strip for "${p.name}" produced no shootable frame`);
    }
  }
}

await browser.close();

// ── 5. emit motion.json with the confidence model ─────────────────────────
const obs = (value, source, hits) => ({ value, confidence: "observed", source, hits: hits ?? 1 });
const SRC = `${url} (harvest-motion.mjs)`;

if (!keyframes.length) risk("no @keyframes found — the site's motion may be entirely JS-driven or transition-only");
if (!bulk.effects.backdropFilter.length && !bulk.effects.filter.length)
  risk("no backdrop-filter / filter observed — no glass or blur layer on this page");
if (bulk.canvas.count > 0 && !bulk.canvas.contexts.length)
  risk("a <canvas> exists but no getContext call was captured — it may be created in a worker or after capture");

const motion = {
  $schema: "cb-design-dna/motion.json@v1",
  card: "CB-DESIGN-MOTION",
  source: {
    url,
    capturedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    stripsRequested: WANT_STRIPS,
    captureMode: usedMode,
    launchLog,
  },
  keyframes: keyframes.map((k) => ({
    name: k.name,
    offsets: k.offsets,
    confidence: "observed",
    source: k.viaHttpFallback ? `${SRC} — cross-origin sheet re-fetched over HTTP` : SRC,
    hits: k.offsets.length,
  })),
  animations: bulk.animatedEls.map((a) => ({ ...a, confidence: "observed", source: SRC })),
  transitions: bulk.transitions.map((t) => ({ ...t, confidence: "observed", source: SRC })),
  effects: {
    backdropFilter: bulk.effects.backdropFilter.map((e) => obs(e.value, SRC, e.hits)),
    backdropFilterWhere: bulk.effects.backdropFilterWhere,
    filter: bulk.effects.filter.map((e) => obs(e.value, SRC, e.hits)),
    filterWhere: bulk.effects.filterWhere,
    mixBlendMode: bulk.effects.mixBlendMode.map((e) => obs(e.value, SRC, e.hits)),
    glowShadows: bulk.effects.glowShadows.map((e) => obs(e.value, SRC, e.hits)),
    maskClip: bulk.effects.maskClip.map((e) => obs(e.value, SRC, e.hits)),
    animatedGradients: bulk.effects.animatedGradients.map((e) => obs(e.value, SRC, e.hits)),
  },
  reveals: reveals.map((r) => ({ ...r, confidence: "observed", source: `${SRC} — stepped scroll` })),
  stagger: bulk.stagger.map((s) => ({ ...s, confidence: "observed", source: SRC })),
  scale: {
    durations: bulk.durations,
    easings: bulk.easings,
    delays: bulk.delays,
  },
  reducedMotion: {
    ruleCount: bulk.reducedMotion.ruleCount,
    sample: bulk.reducedMotion.sample,
    confidence: "observed",
    source: SRC,
    respected: bulk.reducedMotion.ruleCount > 0,
  },
  canvas: {
    present: bulk.canvas.count > 0,
    count: bulk.canvas.count,
    elements: bulk.canvas.elements,
    contexts: bulk.canvas.contexts,
    libs: bulk.canvas.libs,
    confidence: "observed",
    source: `${SRC} — getContext hook installed before page scripts`,
    note: bulk.canvas.count === 0 ? "no <canvas> on this page" : undefined,
  },
  jsDriven: {
    waapiCallCount: bulk.hooks.waapiTotal,
    waapiSample: bulk.hooks.waapiCalls,
    intersectionObservers: bulk.hooks.intersectionObservers,
    confidence: "observed",
    source: `${SRC} — Element.animate + IntersectionObserver hooks`,
  },
  frameStrips,
  risks,
};

const outFile = join(SOURCE_DIR, "motion.json");
writeFileSync(outFile, JSON.stringify(motion, null, 2));

// ── summary (human-readable, no secrets) ──────────────────────────────────
const stripCount = frameStrips.length;
const provenStrips = frameStrips.filter((s) => s.proofOfMotion).length;
log("─".repeat(60));
log(`keyframes:      ${motion.keyframes.length} (with bodies)`);
log(`animations:     ${motion.animations.length} animated elements`);
log(`transitions:    ${motion.transitions.length} distinct`);
log(`backdrop-filter:${bulk.effects.backdropFilter.length} distinct   filter: ${bulk.effects.filter.length}`);
log(`glow shadows:   ${bulk.effects.glowShadows.length}   blends: ${bulk.effects.mixBlendMode.length}   animated gradients: ${bulk.effects.animatedGradients.length}`);
log(`reveals:        ${motion.reveals.length} measured   stagger groups: ${motion.stagger.length}`);
log(`reduced-motion: ${motion.reducedMotion.ruleCount} rules`);
log(`canvas:         ${motion.canvas.present ? `${motion.canvas.count} (${motion.canvas.contexts.join(", ") || "context unknown"})` : "none"}   libs: ${motion.canvas.libs.join(", ") || "none detected"}`);
log(`JS-driven:      ${motion.jsDriven.waapiCallCount} Element.animate calls, ${motion.jsDriven.intersectionObservers.length} IntersectionObservers`);
log(`frame-strips:   ${stripCount} (${provenStrips} proved motion with distinct frames)`);
log(`risks:          ${risks.length}`);
log("─".repeat(60));
log("wrote", outFile);
if (WANT_STRIPS && existsSync(STRIP_DIR)) log("frames in", STRIP_DIR, `(${readdirSync(STRIP_DIR).length} files)`);
