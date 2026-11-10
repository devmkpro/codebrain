#!/usr/bin/env node
/*
 * harvest-components.mjs — COMPONENT DISCOVERY for cb-design-dna.       [CB-DESIGN-COMPONENTS]
 *
 * Usage:  node harvest-components.mjs <url> <outdir> [--no-states] [--timeout=60000]
 *         [--no-fixtures] [--include=label::selector] [--record=pattern] [--record-ms=9000]
 *
 * harvest.mjs looks for seven archetypes it already knows: buttons (capped at
 * 6), cards (capped at 4), one nav, one input, one footer — deduplicated by
 * `backgroundColor|borderRadius|boxShadow`. Two structurally different things
 * that share a background and a radius collapse into one entry, and everything
 * that makes a site *that* site (a chat transcript, a recording bar, an agent
 * cursor, a beam border) is unreachable by construction.
 *
 * This pass asks the opposite question: not "where are the buttons" but
 * "what does this site repeat?". Components are discovered from STRUCTURE.
 *
 *   1. Class signatures are normalized — CSS-module hashes and Tailwind
 *      utilities are noise; semantic names (baby-grok-bot-transcript) are the
 *      signal. data-slot / data-framer-name count as names too.
 *   2. Elements are clustered by tag + semantic classes + child-tag skeleton.
 *      A cluster seen N>=2 times is a component the site repeats on purpose.
 *   3. Variants come from class-set differences INSIDE a cluster.
 *   4. States are probed by real interaction (hover / focus / active) and only
 *      recorded when a computed property ACTUALLY changed. A state that changes
 *      nothing is not declared — inventing "has hover" is the failure mode.
 *
 * Emits <outdir>/source/components.discovered.json
 *       <outdir>/screenshots/components/<slug>[-state].png
 *       <outdir>/components/<slug>.html (portable captured DOM + native motion)
 *       <outdir>/preview/components-discovered.html (live fixture + source evidence)
 *       <outdir>/source/components.capture.json (raw fixture/recording provenance)
 *
 * Additive: harvest.mjs / gen-components.mjs keep working untouched.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { exportComponentFixtures } from "./component-fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, "..");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [url, outdir] = argv.filter((a) => !a.startsWith("--"));
const timeoutArg = argv.find((a) => a.startsWith("--timeout="));
const NAV_TIMEOUT = timeoutArg ? Number(timeoutArg.split("=")[1]) : 60000;
const WANT_STATES = !flags.has("--no-states");
const WANT_FIXTURES = !flags.has("--no-fixtures");
const includes = argv.filter((a) => a.startsWith("--include=")).map((a) => {
  const value = a.slice("--include=".length), at = value.indexOf("::");
  return at < 0 ? { label: value, selector: value } : { label: value.slice(0,at), selector: value.slice(at+2) };
});
const recordArg = argv.find((a) => a.startsWith("--record="));
const recordPattern = recordArg ? new RegExp(recordArg.slice("--record=".length), "i") : null;
const recordMs = Math.min(20000, Math.max(1000, Number(argv.find((a) => a.startsWith("--record-ms="))?.split("=")[1] || 9000)));
if (!Number.isFinite(recordMs)) {
  console.error("--record-ms must be a finite number of milliseconds.");
  process.exit(2);
}

if (!url || !outdir) {
  console.error("usage: node harvest-components.mjs <url> <outdir> [--no-states] [--timeout=ms]");
  process.exit(2);
}

const OUT = resolve(process.cwd(), outdir);
const SOURCE_DIR = join(OUT, "source");
const SHOT_DIR = join(OUT, "screenshots", "components");
mkdirSync(SOURCE_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const log = (...a) => console.log("[components]", ...a);
const risks = [];
const risk = (m) => {
  if (!risks.includes(m)) risks.push(m);
};

async function loadPlaywright() {
  const candidates = [
    "playwright",
    join(process.cwd(), "node_modules", "playwright", "index.js"),
    join(SKILL_DIR, "node_modules", "playwright", "index.js"),
  ];
  for (const c of candidates) {
    try {
      return await import(c.startsWith("/") ? pathToFileURL(c).href : c);
    } catch {}
  }
  console.error("[components] playwright not resolvable — run from a dir that has it.");
  process.exit(2);
}

// ── bot wall (same guard as harvest-motion: a capture of an interstitial is
//    worse than no capture, because it looks like a result) ─────────────────
const BLOCK_SIGNATURES = [
  /attention required/i,
  /just a moment/i,
  /sorry, you have been blocked/i,
  /checking your browser/i,
  /verify (you are|you're) human/i,
  /access denied/i,
  /unusual traffic/i,
];
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const STEALTH_INIT = `
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] }); } catch (e) {}
`;

const DISCOVER = (requested = []) => {
  // ── what counts as noise ────────────────────────────────────────────────
  const HASHED = [
    /-module__[A-Za-z0-9_]+/, // CSS modules: foo-module__Z2Vbha__variable
    /^[a-z0-9]+_[a-f0-9]{6,}/i, // next/font: geistmono_157ca88a
    /^css-[a-z0-9]{5,}$/i, // emotion / styled
    /^[a-z]{1,3}-[a-f0-9]{6,}$/i,
  ];
  const UTIL_HEAD = new RegExp(
    "^(?:p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|min|max|size|gap|space|text|bg|border|rounded|shadow|opacity|z|top|left|right|bottom|inset|translate|rotate|scale|skew|origin|duration|delay|ease|transition|animate|font|leading|tracking|indent|align|items|justify|content|self|place|order|col|row|auto|overflow|object|cursor|select|pointer|ring|outline|divide|from|via|to|backdrop|blur|brightness|contrast|grayscale|saturate|filter|aspect|basis|grow|shrink|flex|grid|whitespace|break|truncate|uppercase|lowercase|capitalize|normal|italic|underline|decoration|list|table|sr|not|will|isolate|mix|bnt)(?:-|$)",
    "i"
  );
  const UTIL_EXACT = new Set(
    ("flex grid block inline inline-block inline-flex hidden contents absolute relative fixed sticky static " +
      "antialiased subpixel-antialiased visible invisible collapse group peer dark light container mx-auto " +
      "overflow-hidden overflow-auto pointer-events-none pointer-events-auto " +
      // single-word utilities: these carry no structure, and letting them
      // through made `truncate` (22 instances) and `underline` (5) rank as the
      // site's top two "components" on the first run.
      "truncate underline overline italic uppercase lowercase capitalize normal-case line-through " +
      "no-underline sr-only not-sr-only isolate isolation-auto transform-none resize resize-none " +
      "appearance-none list-none align-middle align-top align-bottom border-collapse border-separate " +
      "shadow ring outline rounded border blur grayscale invert sepia filter backdrop-blur " +
      "animate-none transition-none uppercase-first wrap nowrap")
      .split(" ")
  );
  const isNoise = (c) => {
    if (!c) return true;
    if (HASHED.some((re) => re.test(c))) return true;
    if (c.includes(":")) return true; // hover:, md:, dark: — utility variants
    if (c.includes("/")) return true; // bg-background/85 — utility with opacity
    if (UTIL_EXACT.has(c)) return true;
    if (UTIL_HEAD.test(c) && /[-0-9]/.test(c)) return true;
    if (/^[a-z]+-\[/.test(c)) return true; // arbitrary value: w-[32px]
    if (c.length <= 2) return true;
    return false;
  };

  const semanticClasses = (el) => {
    const raw = typeof el.className === "string" ? el.className.trim().split(/\s+/) : [];
    return raw.filter((c) => c && !isNoise(c));
  };
  const semanticData = (el) => {
    const out = [];
    for (const a of Array.from(el.attributes || [])) {
      if (!a.name.startsWith("data-")) continue;
      // names, not payloads: data-slot="trigger" is a component name,
      // data-state="open" is a state, data-index="4" is noise
      if (/^data-(slot|framer-name|component|testid|test-id|part|variant|role|kind|type)$/.test(a.name)) {
        out.push(`${a.name}=${a.value}`);
      }
    }
    return out;
  };

  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(part + "#" + node.id);
        break;
      }
      const sem = semanticClasses(node).slice(0, 2);
      if (sem.length) part += "." + sem.map((c) => c.replace(/([^a-zA-Z0-9_-])/g, "\\$1")).join(".");
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.02;
  };

  const STYLE_KEYS = [
    "backgroundColor", "backgroundImage", "color", "borderRadius", "borderTopWidth", "borderTopColor",
    "borderStyle", "boxShadow", "padding", "fontFamily", "fontSize", "fontWeight", "lineHeight",
    "letterSpacing", "display", "flexDirection", "gap", "opacity", "transform", "transition",
    "backdropFilter", "filter", "mixBlendMode", "animationName", "overflow", "position", "gridTemplateColumns",
  ];
  const styleOf = (el) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const k of STYLE_KEYS) {
      const v = cs[k];
      if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px") o[k] = v;
    }
    return o;
  };

  // ── cluster ─────────────────────────────────────────────────────────────
  const all = Array.from(document.querySelectorAll("body *")).filter(visible).slice(0, 8000);
  const clusters = new Map();
  const requestedNodes = new Map(), missingRequests = [];
  for (const request of requested) {
    try {
      const matches = [...document.querySelectorAll(request.selector)].filter(visible);
      if (!matches.length) missingRequests.push(request.label);
      for (const el of matches) requestedNodes.set(el, request.label);
    } catch { missingRequests.push(request.label); }
  }

  for (const el of all) {
    const sem = semanticClasses(el);
    const data = semanticData(el);
    const requestedLabel = requestedNodes.get(el);
    if (!sem.length && !data.length && !requestedLabel) continue; // unnamed wrapper — not a component

    const childSkeleton = Array.prototype.map
      .call(el.children, (c) => c.tagName.toLowerCase())
      .slice(0, 6)
      .join(",");
    const sig = `${el.tagName.toLowerCase()}|${[...sem].sort().join(".")}|${[...data].sort().join(",")}|${childSkeleton}${requestedLabel ? "|provided:" + requestedLabel : ""}`;

    if (!clusters.has(sig)) clusters.set(sig, { sig, tag: el.tagName.toLowerCase(), sem, data, childSkeleton, requestedLabel, els: [] });
    clusters.get(sig).els.push(el);
  }

  // ── shape the result ────────────────────────────────────────────────────
  const out = [];
  for (const c of clusters.values()) {
    const first = c.els[0];
    const r = first.getBoundingClientRect();
    const area = Math.round(r.width * r.height);

    // variants: class sets that differ across instances of the same structure
    const variantSets = new Map();
    for (const el of c.els.slice(0, 40)) {
      const key = semanticClasses(el).sort().join(".");
      if (!variantSets.has(key)) variantSets.set(key, 0);
      variantSets.set(key, variantSets.get(key) + 1);
    }

    // a name the site chose for itself, longest-first (most specific)
    const name = c.requestedLabel || [...c.sem].sort((a, b) => b.length - a.length)[0] || c.data[0] || c.tag;

    out.push({
      name,
      ...(c.requestedLabel ? { requested: true, labelConfidence: "provided" } : {}),
      tag: c.tag,
      signature: c.sig,
      semanticClasses: c.sem,
      dataNames: c.data,
      childSkeleton: c.childSkeleton,
      instances: c.els.length,
      variants: [...variantSets.entries()].map(([classes, count]) => ({ classes, count })),
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      area,
      style: styleOf(first),
      selector: cssPath(first),
      text: (first.innerText || "").trim().slice(0, 90) || null,
      hasAnimation: getComputedStyle(first).animationName !== "none",
      // `closest()` made every span inside a button report focusable=true.
      // The artifact then claimed a <span> takes keyboard focus, which is
      // false. Self and ancestor are different facts, so they are two fields.
      focusable:
        ["a", "button", "input", "select", "textarea"].includes(c.tag) ||
        first.hasAttribute("tabindex") ||
        ["button", "link", "menuitem", "tab", "checkbox", "switch"].includes(first.getAttribute("role") || ""),
      insideInteractive: !!first.parentElement?.closest("a,button,input,select,textarea,[tabindex]"),
      // a div with cursor:pointer is interactive even though no tag says so —
      // this is what tells the state probe where to spend its 15 attempts
      pointer: getComputedStyle(first).cursor === "pointer",
    });
  }

  // repeated structure first, then visual weight — the site's own vocabulary
  out.sort((a, b) => b.instances * Math.log10(b.area + 10) - a.instances * Math.log10(a.area + 10));

  return {
    components: out,
    missingRequests,
    totals: {
      elementsScanned: all.length,
      clusters: clusters.size,
      repeated: out.filter((c) => c.instances >= 2).length,
      named: out.length,
    },
  };
};

// ── main ──────────────────────────────────────────────────────────────────
const { chromium } = await loadPlaywright();
const MODES = [
  { name: "stealth-headless", headless: true, channel: null },
  { name: "headed-chrome", headless: false, channel: "chrome" },
];
if (flags.has("--headed")) MODES.shift();

let browser = null;
let page = null;
let usedMode = null;
const launchLog = [];

for (const mode of MODES) {
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
      userAgent: REAL_UA,
      locale: "en-US",
    });
    await ctx.addInitScript(STEALTH_INIT);
    const pg = await ctx.newPage();
    log(`navigating (${mode.name})`, url);
    try {
      await pg.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    } catch {
      await pg.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      risk(`networkidle never settled (${mode.name})`);
    }
    await pg.waitForTimeout(2500);

    const diag = await pg.evaluate(() => ({
      title: document.title || "",
      text: document.body ? document.body.innerText.slice(0, 400) : "",
      els: document.querySelectorAll("*").length,
    }));
    const wall = BLOCK_SIGNATURES.find((re) => re.test(`${diag.title}\n${diag.text}`)) || diag.els < 60;
    if (wall) {
      launchLog.push(`${mode.name}: bot wall / thin page (${diag.els} els)`);
      log(`blocked in ${mode.name}`);
      await b.close();
      continue;
    }
    browser = b;
    page = pg;
    usedMode = mode.name;
    launchLog.push(`${mode.name}: passed (${diag.els} els)`);
    log(`through as ${mode.name} — ${diag.els} elements`);
    break;
  } catch (e) {
    launchLog.push(`${mode.name}: ${e.message.split("\n")[0]}`);
    try {
      if (b) await b.close();
    } catch {}
  }
}

if (!page) {
  console.error("[components] ABORTED — never reached the real page. Nothing written:");
  launchLog.forEach((l) => console.error("  ·", l));
  process.exit(1);
}
if (usedMode !== "stealth-headless") risk(`headless was blocked; captured via ${usedMode}`);

// let lazy sections mount, then return to the top
await page.evaluate(async () => {
  const H = window.innerHeight;
  const total = document.body.scrollHeight;
  for (let y = 0; y <= total; y += Math.round(H / 2)) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 140));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 250));
});

log("clustering by structure");
const found = await page.evaluate(DISCOVER, includes);
for (const label of found.missingRequests) risk(`requested component did not resolve: ${label}`);
log(`scanned ${found.totals.elementsScanned} visible elements → ${found.totals.named} named clusters (${found.totals.repeated} repeated)`);

// ── screenshots + real state probing ──────────────────────────────────────
const slugOf = (s, i) => `${String(i).padStart(2, "0")}-${String(s).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 44)}`;
const STATE_KEYS = [
  "backgroundColor", "color", "borderColor", "boxShadow", "transform", "opacity",
  "backdropFilter", "filter", "textDecorationLine", "outlineColor", "outlineWidth", "letterSpacing",
];

// Diffing only the hovered element itself reported "1 of 15 components have a
// hover state" on a site where almost everything responds. In a composed
// component the container is inert and the CHILD moves — the arrow slides, the
// avatar lifts, the label changes colour. So the snapshot covers the element
// plus its first descendants, and the diff says WHICH node moved.
const SNAP_FN = (el, keys) => {
  const nodes = [el, ...Array.from(el.querySelectorAll("*")).slice(0, 10)];
  return nodes.map((n, i) => {
    const cs = getComputedStyle(n);
    const o = {
      __i: i,
      __tag: n.tagName.toLowerCase(),
      __cls: (typeof n.className === "string" ? n.className : "").trim().split(/\s+/)[0] || "",
    };
    keys.forEach((k) => (o[k] = cs[k]));
    return o;
  });
};

const diffSnaps = (a, b, unstable) => {
  const out = {};
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    for (const k of STATE_KEYS) {
      if (a[i][k] === b[i][k]) continue;
      const id = `${i}|${k}`;
      if (unstable && unstable.has(id)) continue; // moves on its own — not my doing
      const label = i === 0 ? "self" : `${b[i].__tag}${b[i].__cls ? "." + b[i].__cls : ""}[${i}]`;
      out[`${label} › ${k}`] = { from: a[i][k], to: b[i][k] };
    }
  }
  return out;
};

// A component whose child is mid-animation reports phantom states: sampling
// `opacity: 0.966 -> 1` across two moments is the animation settling, not a
// hover. So the baseline is measured TWICE and anything that drifted without
// any interaction is disqualified from every later diff. This separates
// "changed because I interacted" from "changed because time passed" —
// without it the artifact claims hover states the site does not have.
const unstableKeys = (s1, s2) => {
  const bad = new Set();
  const n = Math.min(s1.length, s2.length);
  for (let i = 0; i < n; i++) {
    for (const k of STATE_KEYS) if (s1[i][k] !== s2[i][k]) bad.add(`${i}|${k}`);
  }
  return bad;
};

const TOP = [...new Set([...found.components.filter((c) => c.requested), ...found.components.slice(0, 40)])];

// Two failed attempts taught the shape of this. Probing the 15 highest-RANKED
// components spent 13 probes on inert containers. Probing only the interactive
// ones then LOST a real finding: `li.avatar-row__pill` has no cursor:pointer
// and takes no focus, yet its children slide and fade on hover. Interactivity
// does not predict having a state, so the fix is to probe WIDER, ordered:
// everything interactive first, then fill with the highest-ranked rest.
const PROBE_BUDGET = 25;
const interactive = TOP.filter((c) => c.focusable || c.pointer);
const rest = TOP.filter((c) => !c.focusable && !c.pointer);
const PROBE = new Set(
  [...interactive, ...rest].slice(0, PROBE_BUDGET).map((c) => c.signature)
);
const shotOf = (p) => {
  try {
    return createHash("sha1").update(readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
};

for (let i = 0; i < TOP.length; i++) {
  const c = TOP[i];
  const slug = slugOf(c.name, i);
  c.slug = slug;
  c.states = [];
  let loc;
  try {
    loc = page.locator(c.selector).first();
    if (!(await loc.count())) {
      risk(`selector did not resolve back: ${c.name}`);
      continue;
    }
    await loc.scrollIntoViewIfNeeded({ timeout: 4000 });
    await page.waitForTimeout(150);
    const base = join(SHOT_DIR, `${slug}.png`);
    await loc.screenshot({ path: base, timeout: 8000 });
    c.screenshot = `screenshots/components/${slug}.png`;
    var baseHash = shotOf(base);
  } catch {
    risk(`could not shoot ${c.name}`);
    continue;
  }

  if (!WANT_STATES || !PROBE.has(c.signature)) continue;

  // two baselines, 320ms apart: whatever moves between them is animation, and
  // is disqualified from counting as an interaction state
  const baseline1 = await loc.evaluate(SNAP_FN, STATE_KEYS);
  await page.waitForTimeout(320);
  const before = await loc.evaluate(SNAP_FN, STATE_KEYS);
  const drifting = unstableKeys(baseline1, before);
  if (drifting.size) c.selfAnimatingProps = drifting.size;

  // hover — and only believe it if something moved
  try {
    await loc.hover({ timeout: 4000 });
    await page.waitForTimeout(320); // let the transition land
    const after = await loc.evaluate(SNAP_FN, STATE_KEYS);
    const diff = diffSnaps(before, after, drifting);
    if (Object.keys(diff).length) {
      const p = join(SHOT_DIR, `${slug}-hover.png`);
      await loc.screenshot({ path: p, timeout: 8000 });
      c.states.push({
        state: "hover",
        diff,
        screenshot: `screenshots/components/${slug}-hover.png`,
        visuallyDistinct: shotOf(p) !== baseHash,
        confidence: "observed",
      });
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
  } catch {}

  // focus-visible — keyboard focus, not a click
  if (c.focusable) {
    try {
      await loc.evaluate((el) => {
        const t = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)
          ? el
          : el.closest("a,button,input,select,textarea,[tabindex]");
        if (t) t.focus();
      });
      await page.waitForTimeout(280);
      const after = await loc.evaluate(SNAP_FN, STATE_KEYS);
      const diff = diffSnaps(before, after, drifting);
      if (Object.keys(diff).length) {
        const p = join(SHOT_DIR, `${slug}-focus.png`);
        await loc.screenshot({ path: p, timeout: 8000 });
        c.states.push({
          state: "focus",
          diff,
          screenshot: `screenshots/components/${slug}-focus.png`,
          visuallyDistinct: shotOf(p) !== baseHash,
          confidence: "observed",
        });
      }
      await loc.evaluate(() => document.activeElement && document.activeElement.blur());
    } catch {}
  }
}

// Additive: validated discovery/state fields above stay authoritative. Fixture
// snapshots never create state claims or replace the discovered inventory.
let fixtures = null;
try {
  fixtures = WANT_FIXTURES ? await exportComponentFixtures({ page, components: TOP, outdir: OUT, recordPattern, recordMs, log }) : null;
} finally {
  // Flush the context's asset requests before shutting down the headed process.
  try { await page.context().close(); } finally { await browser.close(); }
}

// ── emit ──────────────────────────────────────────────────────────────────
const withStates = TOP.filter((c) => (c.states || []).length).length;
const repeated = found.components.filter((c) => c.instances >= 2);

const payload = {
  $schema: "cb-design-dna/components.discovered.json@v1",
  card: "CB-DESIGN-COMPONENTS",
  source: { url, capturedAt: new Date().toISOString(), captureMode: usedMode, launchLog },
  method:
    "structural clustering — tag + semantic classes (CSS-module hashes and Tailwind utilities stripped) + child-tag skeleton; states probed by real interaction and kept only when a computed property changed",
  totals: {
    ...found.totals,
    shotted: TOP.filter((c) => c.screenshot).length,
    interactiveFound: TOP.filter((c) => c.focusable || c.pointer).length,
    stateProbed: PROBE.size,
    withRealStates: withStates,
  },
  // the comparison that justifies this pass existing
  versusFixedTaxonomy: {
    oldCeiling: "6 buttons + 4 cards + 1 nav + 1 input + 1 footer = 13 max, deduped by backgroundColor|borderRadius|boxShadow",
    discovered: found.totals.named,
    repeatedStructures: repeated.length,
  },
  components: found.components.map((c) => ({ ...c, confidence: "observed", source: `${url} (harvest-components.mjs)` })),
  ...(fixtures ? { fixtures } : {}),
  risks,
};
const outFile = join(SOURCE_DIR, "components.discovered.json");
writeFileSync(outFile, JSON.stringify(payload, null, 2));

log("─".repeat(60));
log(`named clusters:   ${found.totals.named}   (old path caps at 13)`);
log(`repeated (N>=2):  ${repeated.length}`);
log(`screenshots:      ${payload.totals.shotted}`);
log(`interactive:      ${payload.totals.interactiveFound} of ${TOP.length} top components`);
log(`real states:      ${withStates} of ${payload.totals.stateProbed} interactive probes had an actual computed diff`);
log(`risks:            ${risks.length}`);
log("─".repeat(60));
log("top of the site's own vocabulary:");
found.components.slice(0, 12).forEach((c) => log(`  ${String(c.instances).padStart(3)}×  ${c.tag}  ${c.name}`));
log("wrote", outFile);
