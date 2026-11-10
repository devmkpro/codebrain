#!/usr/bin/env node
/*
 * harvest.mjs — DETERMINISTIC live capture for cb-design-dna.
 *
 * Usage:  node harvest.mjs <url> <outdir>
 *
 * Playwright headless. Applies the MANDATORY capture protocol from SKILL.md
 * (navigate → networkidle → autoscroll top→bottom → freeze animation to final
 * state → fonts.ready → fullPage → density auto-check + retry). Extracts and
 * CLASSIFIES the design DNA, downloads fonts + assets, and emits the single
 * source of truth:  <outdir>/source/harvest.json  + the binary evidence.
 *
 * ── harvest.json SCHEMA (v1) — THE CONTRACT the generators consume ──────────
 * Every classified value is an object: { value, confidence, source, hits }.
 *   confidence ∈ "observed" | "provided" | "inferred"   (Open Design model)
 *   source     = provenance string (URL + method) or "inferred: <reason>"
 *   hits       = occurrence count in the live DOM (0 for inferred)
 *
 * {
 *   "$schema": "cb-design-dna/harvest.json@v1",
 *   "source":   { url, capturedAt, viewport, deviceScaleFactor, userAgent },
 *   "meta":     { title, lang, description, og:{...} },
 *   "palette":  {                       // CLASSIFIED color roles
 *      bg, fg, accent, accentHover,     // each = {value,confidence,source,hits}
 *      fgMuted, fgSubtle,
 *      surfaces:[…], borders:[…],       // arrays of {value,confidence,source,hits}
 *      semantic:{ success, danger, warning },
 *      gradients:[ {value,confidence,source,hits} ]  // trust-gradients filtered out
 *   },
 *   "colorsObserved": [ {value,hits} ], // raw ranked distinct colors (provenance)
 *   "type": {
 *      families: [ {value, role:"display|body|mono", hits, confidence,source} ],
 *      sizesPx:  [ {px, rem, hits} ],   // ranked observed font-sizes
 *      headings: { h1:{…}, h2:{…}, h3:{…}, h4:{…} },  // per-tag computed type
 *      body:     {family,sizePx,weight,lineHeight,tracking,color},
 *      weights:  [ {value, hits} ]
 *   },
 *   "spacingPx": [ {px, hits} ],        // ranked observed paddings/margins
 *   "radius":    [ {value, px, hits} ],
 *   "shadow":    [ {value, hits} ],
 *   "motion":    { durations:[{value,hits}], easings:[{value,hits}] },
 *   "components": { buttons:[…], link, nav, input, cards:[…], footer, hoverStyle },
 *   "assets":     { logo:"assets/logo.svg"|null, images:[…paths] },
 *   "fonts":      [ {family, files:[…], faces:[{file,weight,format}], weights, roles, source, confidence} ],
 *   "fontGaps":   [ {family, role, reason} ],   // known family in stack, no file
 *   "screenshots":[ "full.png", "hero.png", "mobile.png", … ],
 *   "a11y":       {…},
 *   "rootVars":   {…}                   // any :root custom props the site declared
 * }
 *
 * Zero deps beyond Playwright (resolved from cwd/node_modules as fallback).
 */

import { writeFileSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, ".."); // …/cb-design-dna

// ── args ────────────────────────────────────────────────────────────────
const URL_ARG = process.argv[2];
const OUT_ARG = process.argv[3];
if (!URL_ARG || !OUT_ARG) {
  console.error("usage: node harvest.mjs <url> <outdir>");
  process.exit(2);
}
const URL = URL_ARG;
const OUT = resolve(process.cwd(), OUT_ARG);
const SHOTS = join(OUT, "screenshots");
const SRC = join(OUT, "source");
const FONTS = join(OUT, "fonts");
const ASSETS = join(OUT, "assets");
for (const d of [OUT, SHOTS, SRC, FONTS, ASSETS]) mkdirSync(d, { recursive: true });

const log = (...a) => console.log("[harvest]", ...a);
const t0 = Date.now();

// ── resolve Playwright ────────────────────────────────────────────────────
// Resolution order: (1) normal import (global / cwd hoist), (2) the SKILL's OWN
// node_modules, (3) cwd node_modules, (4) lazy-bootstrap install INTO the skill
// folder (never the user's repo) + `npx playwright install chromium` (idempotent,
// global browser cache). This makes the skill self-sufficient on any target repo.
let chromium;
async function reqFrom(fromDir) {
  const { createRequire } = await import("node:module");
  const req = createRequire(join(fromDir, "noop.cjs"));
  return req("playwright").chromium;
}
try {
  ({ chromium } = await import("playwright"));
} catch {
  for (const dir of [SKILL_DIR, process.cwd()]) {
    try { chromium = await reqFrom(dir); break; } catch {}
  }
  if (!chromium) {
    if (process.env.CB_DESIGN_ALLOW_INSTALL !== "1") {
      console.error("Playwright unavailable. Install the declared dependency/browser only with user approval, or explicitly opt in with CB_DESIGN_ALLOW_INSTALL=1. Nothing was installed.");
      process.exit(2);
    }
    log("playwright not found — bootstrapping into skill folder (one-time):", SKILL_DIR);
    try {
      const { execSync } = await import("node:child_process");
      // install into the SKILL dir, NOT the cwd → never pollutes the user's repo
      execSync("npm i playwright --silent --no-audit --no-fund", { cwd: SKILL_DIR, stdio: "inherit" });
      execSync("npx playwright install chromium", { cwd: SKILL_DIR, stdio: "inherit" });
      chromium = await reqFrom(SKILL_DIR);
    } catch (e) {
      console.error("error: cannot resolve nor bootstrap 'playwright'.");
      console.error(e.message);
      process.exit(2);
    }
  }
}

// ── color helpers (Node-side classification) ─────────────────────────────
function parseColor(c) {
  if (!c) return null;
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 }; }
  m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(",").map((s) => s.trim());
    return { r: +p[0], g: +p[1], b: +p[2], a: p[3] === undefined ? 1 : +p[3] };
  }
  return null;
}
const toHex = (o) => o ? "#" + [o.r, o.g, o.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("") : null;
function lum(o) { // relative luminance 0..1
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(o.r) + 0.7152 * f(o.g) + 0.0722 * f(o.b);
}
function sat(o) { // HSL saturation 0..1
  const r = o.r / 255, g = o.g / 255, b = o.b / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return 0;
  const d = mx - mn;
  return l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
}
function hue(o) {
  const r = o.r / 255, g = o.g / 255, b = o.b / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return h;
}
const isGray = (o) => sat(o) < 0.12;
const SRC_OBSERVED = `${URL} (getComputedStyle, ${new Date(t0).toISOString().slice(0, 10)})`;
const obs = (value, hits) => ({ value, confidence: "observed", source: SRC_OBSERVED, hits });
const inf = (value, reason) => ({ value, confidence: "inferred", source: `inferred: ${reason}`, hits: 0 });

// ── launch ───────────────────────────────────────────────────────────────
const VIEWPORT = { width: 1440, height: 900 };
const DSF = 2;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF, userAgent: UA });
const page = await ctx.newPage();

// network capture: fonts + images.
// FONT SNIFFING is the robust path — it captures EVERY font the browser actually
// downloaded regardless of delivery method (next/font hashed, Google gstatic,
// self-host woff2, @font-face cross-origin). We grab the response BODY directly
// (not a re-fetch) so auth/hashed/CORS-restricted URLs still land on disk.
const fontResponses = []; // { url, ct, bodyP:Promise<Buffer|null> }
const seenFontUrl = new Set();
const imageUrls = new Set();
page.on("response", (r) => {
  const u = r.url();
  const ct = r.headers()["content-type"] || "";
  if (/font\//i.test(ct) || /\.(woff2?|ttf|otf)(\?|$)/i.test(u)) {
    if (!seenFontUrl.has(u)) { seenFontUrl.add(u); fontResponses.push({ url: u, ct, bodyP: r.body().catch(() => null) }); }
  }
  if (/\.(svg|png|jpe?g|webp|avif)(\?|$)/i.test(u)) imageUrls.add(u);
});

// ── capture protocol step a — navigate + wait ────────────────────────────
log("goto", URL);
// domcontentloaded + short settle, NOT networkidle — sites with long-poll /
// analytics beacons (e.g. stripe.com) never reach networkidle and waste ~60s.
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log("goto warn", e.message));
await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

// dismiss cookie/consent banners (they cover the page / block reveal)
for (const sel of ['button:has-text("Accept")', 'button:has-text("Agree")', '[data-testid*="accept"]', 'button:has-text("OK")', 'button:has-text("Got it")']) {
  try { const el = page.locator(sel).first(); if (await el.count()) { await el.click({ timeout: 1500 }); log("dismissed", sel); break; } } catch {}
}
await page.waitForTimeout(500);

// ── capture protocol step b — autoscroll top → bottom ────────────────────
async function autoscroll(pg) {
  const vh = await pg.evaluate(() => window.innerHeight);
  const total = await pg.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < total; y += vh) {
    await pg.evaluate((pos) => window.scrollTo(0, pos), y);
    await pg.waitForTimeout(160);
  }
  await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await pg.waitForTimeout(200);
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(200);
}
await autoscroll(page);

// ── capture protocol step c — freeze animation to final state ────────────
async function freeze(pg, aggressive = false) {
  await pg.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;}" });
  await pg.evaluate((aggr) => {
    const force = (el) => { el.style.opacity = "1"; el.style.transform = "none"; el.style.visibility = "visible"; };
    document.querySelectorAll(
      '[style*="opacity: 0"],[style*="opacity:0"],[class*="reveal"],[class*="fade-in"],[class*="fade-out"],[class*="animate"],[data-animate],[data-aos],[data-sal]'
    ).forEach(force);
    if (aggr) {
      document.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el);
        if (parseFloat(cs.opacity) < 0.5) force(el);
      });
    }
  }, aggressive);
}
await freeze(page, false);

// ── capture protocol step d — fonts ready + settle ───────────────────────
await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await page.waitForTimeout(300);

// ── capture protocol step e+f — capture full.png with density retry ──────
function pngDensity(fpath) {
  const fsize = statSync(fpath).size;
  if (fsize < 24) return { bpp: 0, width: 0, height: 0, fsize };
  const header = Buffer.alloc(24);
  const fd = openSync(fpath, "r"); readSync(fd, header, 0, 24, 0); closeSync(fd);
  if (header[0] !== 0x89 || header[1] !== 0x50) return { bpp: Infinity, width: 0, height: 0, fsize };
  const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
  if (!width || !height) return { bpp: 0, width, height, fsize };
  return { bpp: fsize / (width * height), width, height, fsize };
}
const DENSITY_THRESHOLD = 0.008;
const fullPath = join(SHOTS, "full.png");
let ok = false;
for (let attempt = 0; attempt <= 2; attempt++) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: fullPath, fullPage: true });
  const d = pngDensity(fullPath);
  log(`full.png attempt ${attempt}: ${d.bpp.toFixed(5)} B/px (${d.width}×${d.height})`);
  if (d.bpp >= DENSITY_THRESHOLD) { ok = true; break; }
  log("density below threshold — re-freezing aggressively + retry");
  await freeze(page, true);
  await autoscroll(page);
  await page.waitForTimeout(200);
}
if (!ok) {
  console.error("FATAL: full.png stays below density threshold after retries — blank/partial capture. Aborting (no done handoff).");
  await browser.close();
  process.exit(3);
}
log("shot full");
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(150);
await page.screenshot({ path: join(SHOTS, "hero.png") });
log("shot hero");

// ── extract + classify (in-page) ─────────────────────────────────────────
const raw = await page.evaluate(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05; };
  const pick = (cs, props) => { const o = {}; for (const p of props) o[p] = cs.getPropertyValue(p); return o; };
  const sample = (el, props) => el ? { tag: el.tagName.toLowerCase(), cls: (el.className && el.className.toString ? el.className.toString() : "").slice(0, 120), text: (el.innerText || "").slice(0, 60).replace(/\s+/g, " "), styles: pick(getComputedStyle(el), props) } : null;

  const TYPO = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "text-transform"];
  const BOX = ["background-color", "background-image", "color", "border", "border-color", "border-radius", "box-shadow", "padding", "margin", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "transition", "opacity"];

  // meta / OG
  const meta = {};
  document.querySelectorAll("meta").forEach((m) => { const k = m.getAttribute("property") || m.getAttribute("name"); if (k) meta[k] = m.getAttribute("content"); });

  // :root vars
  const rootCS = getComputedStyle(document.documentElement);
  const rootVars = {};
  for (let i = 0; i < rootCS.length; i++) { const p = rootCS[i]; if (p.startsWith("--")) rootVars[p] = rootCS.getPropertyValue(p).trim(); }
  const bodyCS = getComputedStyle(document.body);

  const all = [...document.querySelectorAll("*")].filter(visible).slice(0, 6000);

  // color tallies — separate fg (text) from bg (surface) signals
  const textColor = {}, bgColor = {}, borderColor = {};
  const bump = (m, c) => { if (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent") return; m[c] = (m[c] || 0) + 1; };
  for (const el of all) {
    const cs = getComputedStyle(el);
    bump(textColor, cs.color);
    bump(bgColor, cs.backgroundColor);
    if (cs.borderTopWidth !== "0px" && cs.borderTopStyle !== "none") bump(borderColor, cs.borderTopColor);
  }
  const rank = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]);

  // gradients / shadows / radii / families / sizes / weights / spacing / motion
  const gradients = {}, shadows = {}, radii = {}, families = {}, sizes = {}, weights = {}, spacing = {}, durations = {}, easings = {};
  for (const el of all) {
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage; if (bi && bi.includes("gradient")) gradients[bi.slice(0, 400)] = (gradients[bi.slice(0, 400)] || 0) + 1;
    const sh = cs.boxShadow; if (sh && sh !== "none") shadows[sh.slice(0, 300)] = (shadows[sh.slice(0, 300)] || 0) + 1;
    const rr = cs.borderRadius; if (rr && rr !== "0px") radii[rr] = (radii[rr] || 0) + 1;
    const f = cs.fontFamily; if (f) families[f] = (families[f] || 0) + 1;
    const s = cs.fontSize; if (s) sizes[s] = (sizes[s] || 0) + 1;
    const w = cs.fontWeight; if (w) weights[w] = (weights[w] || 0) + 1;
    for (const pad of [cs.paddingTop, cs.paddingLeft, cs.marginTop]) { if (pad && pad !== "0px" && /px$/.test(pad)) spacing[pad] = (spacing[pad] || 0) + 1; }
    const tr = cs.transitionDuration; if (tr && tr !== "0s") tr.split(",").forEach((d) => { d = d.trim(); if (d !== "0s") durations[d] = (durations[d] || 0) + 1; });
    const tf = cs.transitionTimingFunction; if (tf && tf !== "linear" && /cubic-bezier|ease/.test(tf)) tf.split(/,(?![^(]*\))/).forEach((e) => { e = e.trim(); easings[e] = (easings[e] || 0) + 1; });
  }

  // headings + body + link
  const headings = {};
  for (const tag of ["h1", "h2", "h3", "h4"]) { const el = [...document.querySelectorAll(tag)].find(visible); if (el) headings[tag] = sample(el, TYPO); }
  const para = [...document.querySelectorAll("p")].find((p) => visible(p) && p.innerText.length > 40);
  const paragraph = para ? sample(para, TYPO) : null;
  const linkEl = [...document.querySelectorAll("a")].find((a) => visible(a) && a.innerText.length > 2 && a.innerText.length < 40);
  const link = linkEl ? sample(linkEl, [...TYPO, "text-decoration-line"]) : null;

  // buttons (distinct by bg|color|radius)
  const btnEls = [...document.querySelectorAll("a,button")].filter((b) => {
    if (!visible(b)) return false;
    const t = (b.innerText || "").trim(); const cs = getComputedStyle(b);
    return t.length > 1 && t.length < 30 && (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderStyle !== "none") && b.getBoundingClientRect().height > 24;
  });
  const seenBtn = new Set(); const buttons = [];
  for (const b of btnEls) {
    const cs = getComputedStyle(b); const key = cs.backgroundColor + "|" + cs.color + "|" + cs.borderRadius;
    if (seenBtn.has(key)) continue; seenBtn.add(key);
    const r = b.getBoundingClientRect();
    buttons.push({ ...sample(b, BOX), rect: { w: Math.round(r.width), h: Math.round(r.height) } });
    if (buttons.length >= 6) break;
  }

  const nav = document.querySelector("nav, header [role=navigation], header");
  const input = [...document.querySelectorAll("input[type=text],input[type=email],input:not([type]),input[type=search]")].find(visible);
  const footer = document.querySelector("footer");

  // cards
  const cardEls = [...document.querySelectorAll("div,article,section")].filter((d) => {
    if (!visible(d)) return false; const cs = getComputedStyle(d); const r = d.getBoundingClientRect();
    return cs.borderRadius !== "0px" && parseFloat(cs.borderRadius) >= 6 && (cs.boxShadow !== "none" || cs.borderStyle !== "none") && r.width > 180 && r.width < 560 && r.height > 120 && r.height < 560;
  });
  const seenCard = new Set(); const cards = [];
  for (const c of cardEls) { const cs = getComputedStyle(c); const key = cs.backgroundColor + "|" + cs.borderRadius + "|" + cs.boxShadow; if (seenCard.has(key)) continue; seenCard.add(key); cards.push(sample(c, BOX)); if (cards.length >= 4) break; }

  // a11y
  const a11y = {
    lang: document.documentElement.lang, title: document.title,
    landmarks: { nav: document.querySelectorAll("nav").length, main: document.querySelectorAll("main").length, footer: document.querySelectorAll("footer").length, header: document.querySelectorAll("header").length },
    h1count: document.querySelectorAll("h1").length,
    imgsTotal: document.querySelectorAll("img").length,
    imgsAlt: [...document.querySelectorAll("img")].filter((i) => i.hasAttribute("alt")).length,
    ariaLabels: document.querySelectorAll("[aria-label]").length,
    buttonsTotal: document.querySelectorAll("button").length,
    skipLink: !!document.querySelector('a[href="#main"],a[href="#content"],a.skip-link'),
  };

  const logo = document.querySelector('header svg, nav svg, [class*=logo] svg, a[href="/"] svg, header img[class*=logo], nav img[class*=logo]');
  const logoHTML = logo && logo.tagName.toLowerCase() === "svg" ? logo.outerHTML.slice(0, 6000) : null;

  return {
    meta, title: document.title, lang: document.documentElement.lang,
    rootVars,
    body: { fontFamily: bodyCS.fontFamily, color: bodyCS.color, bg: bodyCS.backgroundColor, fontSize: bodyCS.fontSize, lineHeight: bodyCS.lineHeight, fontWeight: bodyCS.fontWeight, letterSpacing: bodyCS.letterSpacing },
    textColor: rank(textColor), bgColor: rank(bgColor), borderColor: rank(borderColor),
    gradients: rank(gradients), shadows: rank(shadows).slice(0, 24), radii: rank(radii),
    families: rank(families), sizes: rank(sizes), weights: rank(weights), spacing: rank(spacing),
    durations: rank(durations), easings: rank(easings),
    headings, paragraph, link, buttons, nav: nav ? sample(nav, BOX) : null, input: input ? sample(input, BOX) : null, cards, footer: footer ? sample(footer, BOX) : null,
    a11y, logoHTML,
  };
});

// ── per-component screenshots + hover style ─────────────────────────────
async function shotSel(name, selector) {
  try { const el = page.locator(selector).first(); if (await el.count()) { await el.scrollIntoViewIfNeeded({ timeout: 3000 }); await page.waitForTimeout(250); await el.screenshot({ path: join(SHOTS, `${name}.png`) }); log("shot", name); return true; } } catch (e) { log("shot fail", name, e.message); }
  return false;
}
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
await shotSel("nav", "nav, header");
await shotSel("hero-section", "main section, section");

let hoverStyle = null;
const primaryBtn = page.locator("a,button").filter({ hasText: /sign up|start|contact|get started|try|buy|subscribe|join/i }).first();
try {
  if (await primaryBtn.count()) {
    await primaryBtn.scrollIntoViewIfNeeded({ timeout: 3000 }); await page.waitForTimeout(250);
    await primaryBtn.screenshot({ path: join(SHOTS, "btn-default.png") }); log("shot btn-default");
    await primaryBtn.hover(); await page.waitForTimeout(350);
    await primaryBtn.screenshot({ path: join(SHOTS, "btn-hover.png") }); log("shot btn-hover");
    hoverStyle = await primaryBtn.evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color, transform: cs.transform, boxShadow: cs.boxShadow, transition: cs.transition }; });
  }
} catch (e) { log("btn states fail", e.message); }
try {
  const inp = page.locator("input[type=text],input[type=email],input[type=search],input:not([type])").first();
  if (await inp.count()) { await inp.scrollIntoViewIfNeeded({ timeout: 3000 }); await page.waitForTimeout(250); await inp.screenshot({ path: join(SHOTS, "input-default.png") }); await inp.focus(); await page.waitForTimeout(250); await inp.screenshot({ path: join(SHOTS, "input-focus.png") }); log("shot input states"); }
} catch (e) { log("input fail", e.message); }
await shotSel("footer", "footer");

// ── mobile capture (with protocol) ──────────────────────────────────────
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => log("mob goto warn", e.message));
await mob.waitForTimeout(1200);
await autoscroll(mob); await freeze(mob, false);
await mob.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
await mob.waitForTimeout(250);
await mob.evaluate(() => window.scrollTo(0, 0)); await mob.waitForTimeout(150);
await mob.screenshot({ path: join(SHOTS, "mobile.png") }); log("shot mobile");

// ── @font-face enumeration (complements network sniffing) ─────────────────
// Read CSSFontFaceRule from every readable stylesheet (family→src→weight).
// Cross-origin sheets (e.g. fonts.googleapis.com) throw on .cssRules — we
// collect their href and FETCH the CSS text below to recover the mapping.
const sheetData = await page.evaluate(() => {
  const rules = [], hrefs = [];
  for (const sheet of document.styleSheets) {
    let cr;
    try { cr = sheet.cssRules; }
    catch { if (sheet.href) hrefs.push(sheet.href); continue; }
    if (!cr) continue;
    for (const rule of cr) {
      if (rule.type === 5 /* CSSFontFaceRule */) {
        const s = rule.style;
        rules.push({
          family: (s.getPropertyValue("font-family") || "").replace(/["']/g, "").trim(),
          src: s.getPropertyValue("src") || "",
          weight: (s.getPropertyValue("font-weight") || "").trim(),
          style: (s.getPropertyValue("font-style") || "").trim(),
          base: sheet.href || document.baseURI,
        });
      }
    }
  }
  return { rules, hrefs: [...new Set(hrefs)] };
});

// recover @font-face from cross-origin stylesheets (Google Fonts etc.)
function parseFontFaceCss(text, baseUrl) {
  const out = [];
  const re = /@font-face\s*\{([^}]*)\}/gi; let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const family = (b.match(/font-family:\s*([^;]+);?/i) || [])[1]?.replace(/["']/g, "").trim() || "";
    const weight = (b.match(/font-weight:\s*([^;]+);?/i) || [])[1]?.trim() || "";
    const src = (b.match(/src:\s*([^;]+);?/i) || [])[1] || "";
    if (family) out.push({ family, src, weight, base: baseUrl });
  }
  return out;
}
const faceRules = [...sheetData.rules];
for (const href of sheetData.hrefs) {
  try {
    const res = await fetch(href, { headers: { "user-agent": UA } });
    if (!res.ok) continue;
    faceRules.push(...parseFontFaceCss(await res.text(), href));
  } catch (e) { log("sheet fetch fail", href, e.message); }
}

// ── download every sniffed font (from the response BODY) ──────────────────
const extOf = (url, ct) => {
  const m = url.match(/\.(woff2|woff|ttf|otf)(\?|$)/i);
  if (m) return m[1].toLowerCase();
  if (/woff2/i.test(ct)) return "woff2";
  if (/woff/i.test(ct)) return "woff";
  if (/ttf|truetype/i.test(ct)) return "ttf";
  if (/otf|opentype/i.test(ct)) return "otf";
  return "woff2";
};
const downloaded = []; // { url, file:"fonts/x.woff2", ext, bytes }
for (const fr of fontResponses.slice(0, 24)) {
  let buf = await fr.bodyP;
  if (!buf || buf.length < 64) {
    try { const res = await fetch(fr.url, { headers: { "user-agent": UA } }); if (res.ok) buf = Buffer.from(await res.arrayBuffer()); } catch {}
  }
  if (!buf || buf.length < 64) continue;
  const ext = extOf(fr.url, fr.ct);
  let base = (fr.url.split("/").pop() || "font").split("?")[0].replace(/[^\w.-]/g, "_");
  if (!new RegExp("\\." + ext + "$", "i").test(base)) base = base.replace(/\.[^.]*$/, "") + "." + ext;
  if (!/\./.test(base)) base += "." + ext;
  try { writeFileSync(join(FONTS, base), buf); downloaded.push({ url: fr.url, file: `fonts/${base}`, ext, bytes: buf.length }); }
  catch (e) { log("font write fail", base, e.message); }
}

// ── map family → files → weights (the contract) ───────────────────────────
// next/font hashed name → human family:  __Inter_e8ce0c → "Inter"
function cleanFamily(rawStack) {
  if (!rawStack) return "";
  let f = String(rawStack).split(",")[0].replace(/["']/g, "").trim();
  const m = f.match(/^__(.+?)(?:_Fallback)?_[0-9a-f]{4,}$/i);
  if (m) f = m[1].replace(/_/g, " ").trim();
  return f;
}
const findFile = (url) => {
  if (!url) return null;
  const hit = downloaded.find((d) => d.url === url) ||
    downloaded.find((d) => (d.url.split("?")[0]).endsWith(url.split("/").pop().split("?")[0]));
  return hit || null;
};
// the three role stacks (raw computed) used to attach hashed faces to a human name
const roleStacks = {
  display: (raw.headings.h1 || raw.headings.h2 || {}).styles ? (raw.headings.h1 || raw.headings.h2).styles["font-family"] : raw.body.fontFamily,
  body: raw.body.fontFamily,
  mono: (raw.families.find(([f]) => /mono|code|consolas|menlo|courier/i.test(f)) || [])[0] || "",
};
const fmtOf = (ext) => ({ woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" }[ext] || "woff2");

const famMap = new Map(); // key: displayFamily.toLowerCase() → entry
for (const rule of faceRules) {
  const urls = [...rule.src.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)].map((u) => {
    try { return new URL(u[2], rule.base).href; } catch { return u[2]; }
  });
  const faces = urls.map(findFile).filter(Boolean);
  if (!faces.length) continue; // only keep faces the browser actually downloaded

  // resolve a human display name + role by matching the rule family into a role stack
  let displayFam = cleanFamily(rule.family), role = null;
  for (const [rn, stack] of Object.entries(roleStacks)) {
    if (stack && rule.family && stack.toLowerCase().includes(rule.family.toLowerCase())) { role = rn; displayFam = cleanFamily(stack); break; }
  }
  if (!displayFam) continue;
  const key = displayFam.toLowerCase();
  if (!famMap.has(key)) famMap.set(key, { family: displayFam, faces: [], roles: new Set(), source: "font-face+network" });
  const entry = famMap.get(key);
  if (role) entry.roles.add(role);
  for (const f of faces) {
    if (entry.faces.some((x) => x.file === f.file && x.weight === (rule.weight || ""))) continue;
    entry.faces.push({ file: f.file, weight: rule.weight || "", format: fmtOf(f.ext) });
  }
}

// leftover downloaded files not matched by any readable face rule → attach to an
// unbacked role by filename token, else keep as a standalone observed family.
const usedFiles = new Set([...famMap.values()].flatMap((e) => e.faces.map((f) => f.file)));
for (const d of downloaded) {
  if (usedFiles.has(d.file)) continue;
  const fnameGuess = cleanFamily(d.file.replace(/^fonts\//, "").replace(/\.[^.]+$/, "").replace(/[-_](var|regular|normal|italic|\d{3}|web|latin\w*|v\d+|wght).*$/i, "").replace(/[-_]/g, " ").trim());
  // try to bind to a role whose primary name appears in the filename
  let displayFam = fnameGuess, role = null;
  for (const [rn, stack] of Object.entries(roleStacks)) {
    const prim = cleanFamily(stack);
    if (prim && d.file.toLowerCase().includes(prim.toLowerCase().replace(/\s+/g, ""))) { role = rn; displayFam = prim; break; }
  }
  if (!displayFam) displayFam = "Brand";
  const key = displayFam.toLowerCase();
  if (!famMap.has(key)) famMap.set(key, { family: displayFam, faces: [], roles: new Set(), source: "network" });
  const entry = famMap.get(key);
  if (role) entry.roles.add(role);
  entry.faces.push({ file: d.file, weight: "", format: fmtOf(d.ext) });
}

const fonts = [...famMap.values()].map((e) => ({
  family: e.family,
  files: [...new Set(e.faces.map((f) => f.file))],
  faces: e.faces,
  weights: [...new Set(e.faces.map((f) => f.weight).filter(Boolean))],
  roles: [...e.roles],
  source: e.source,
  confidence: "observed",
}));

// gaps: a known/role family present in the live stacks but with NO downloaded file
const backedFams = new Set(fonts.map((f) => f.family.toLowerCase()));
const KNOWN = /^(inter|jetbrains mono|roboto|roboto mono|geist|geist mono|open sans|lato|montserrat|poppins|source sans|source code|ibm plex|space grotesk|space mono|dm sans|dm mono|work sans|nunito|raleway|playfair|merriweather|fira code|fira sans|manrope|outfit|sora|figtree|plus jakarta)/i;
const fontGaps = [];
for (const [role, stack] of Object.entries(roleStacks)) {
  const prim = cleanFamily(stack);
  if (!prim) continue;
  if (backedFams.has(prim.toLowerCase())) continue;
  const isSystem = /system-ui|-apple-system|segoe|roboto$|helvetica|arial|sans-serif|serif|ui-monospace|monospace|menlo|consolas|courier/i.test(prim) && !KNOWN.test(prim);
  if (isSystem) continue;
  fontGaps.push({ family: prim, role, reason: "family present in live stack but no webfont file downloaded (browser served it by a method the sniffer didn't catch, or it is a system font)" });
}
log("fonts mapped", fonts.length, "families ·", downloaded.length, "files ·", fontGaps.length, "gap(s)");

// ── download a few key assets (logo raster + first images) ──────────────
const assetImages = [];
if (raw.logoHTML) { writeFileSync(join(ASSETS, "logo.svg"), raw.logoHTML); }
const uniqImgs = [...imageUrls].filter((u) => /\.(svg|png|webp)(\?|$)/i.test(u) && !/sprite|icon|favicon/i.test(u)).slice(0, 6);
for (const u of uniqImgs) {
  try {
    const res = await fetch(u); if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 600000) continue; // skip heavy hero imagery
    const base = (u.split("/").pop() || "img").split("?")[0].replace(/[^\w.-]/g, "_");
    writeFileSync(join(ASSETS, base), buf);
    assetImages.push(`assets/${base}`);
  } catch {}
}

await browser.close();

// ════════════════════════════════════════════════════════════════════════
//  CLASSIFY → harvest.json
// ════════════════════════════════════════════════════════════════════════

// background palette: rank non-transparent bgColors; bg = lightest-or-darkest dominant
const bgRanked = raw.bgColor.map(([c, h]) => ({ p: parseColor(c), hex: toHex(parseColor(c)), hits: h })).filter((x) => x.p && x.p.a > 0.5 && x.hex);
const textRanked = raw.textColor.map(([c, h]) => ({ p: parseColor(c), hex: toHex(parseColor(c)), hits: h })).filter((x) => x.p && x.p.a > 0.5 && x.hex);

// bg = the most frequent background (page surface). Use body bg as anchor.
const bodyBg = parseColor(raw.body.bg);
const bgPick = (bodyBg && bodyBg.a > 0.5) ? { hex: toHex(bodyBg), hits: (bgRanked.find((x) => x.hex === toHex(bodyBg)) || {}).hits || 1 } : bgRanked[0];
const BG = bgPick ? bgPick.hex : "#ffffff";
const bgLum = lum(parseColor(BG));
const bgIsLight = bgLum > 0.5;

// fg = dominant text color with strong contrast vs bg (the ink)
const fgCand = textRanked.filter((x) => Math.abs(lum(x.p) - bgLum) > 0.35 && isGray(x.p) || (Math.abs(lum(x.p) - bgLum) > 0.45));
const FGpick = (fgCand[0] || textRanked.find((x) => Math.abs(lum(x.p) - bgLum) > 0.3) || textRanked[0]);
const FG = FGpick ? FGpick.hex : (bgIsLight ? "#0a0a0a" : "#fafafa");

// accent = most-hit saturated non-gray color (prefer a primary button bg)
function accentFromButtons() {
  for (const b of raw.buttons) {
    const p = parseColor(b.styles["background-color"]);
    if (p && p.a > 0.5 && !isGray(p) && Math.abs(lum(p) - bgLum) > 0.05) return { hex: toHex(p), hits: 1 };
  }
  return null;
}
function accentFromTally() {
  const cand = [...bgRanked, ...textRanked].filter((x) => !isGray(x.p) && sat(x.p) > 0.25);
  cand.sort((a, b) => (sat(b.p) * Math.log(1 + b.hits)) - (sat(a.p) * Math.log(1 + a.hits)));
  return cand[0] ? { hex: cand[0].hex, hits: cand[0].hits } : null;
}
const accentPick = accentFromButtons() || accentFromTally();
const ACCENT = accentPick ? accentPick.hex : (bgIsLight ? "#1a1a1a" : "#f0f0f0");
const accentObserved = !!accentPick;

// accent-hover: from hoverStyle bg if it differs, else darken/lighten accent 12%
let accentHover;
if (hoverStyle && hoverStyle.bg) {
  const hp = parseColor(hoverStyle.bg);
  if (hp && hp.a > 0.5 && toHex(hp) !== ACCENT) accentHover = obs(toHex(hp), 1);
}
if (!accentHover) {
  const a = parseColor(ACCENT); const f = bgIsLight ? 0.86 : 1.14;
  accentHover = inf(toHex({ r: a.r * f, g: a.g * f, b: a.b * f, a: 1 }), "accent shifted 14% toward contrast (no hover bg observed)");
}

// muted / subtle: gray text colors between fg and bg luminance
const grayTexts = textRanked.filter((x) => isGray(x.p) && x.hex !== FG && x.hex !== BG).sort((a, b) => b.hits - a.hits);
const FG_MUTED = grayTexts[0] ? obs(grayTexts[0].hex, grayTexts[0].hits) : inf(mix(FG, BG, 0.42), "no distinct muted text observed");
const FG_SUBTLE = grayTexts[1] ? obs(grayTexts[1].hex, grayTexts[1].hits) : inf(mix(FG, BG, 0.6), "no distinct subtle text observed");

function mix(aHex, bHex, t) { const a = parseColor(aHex), b = parseColor(bHex); return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 }); }

// surfaces: light/near-bg backgrounds distinct from BG (cards / alt sections)
const surfaces = bgRanked
  .filter((x) => x.hex !== BG && isGray(x.p) && Math.abs(lum(x.p) - bgLum) < 0.18)
  .slice(0, 3)
  .map((x) => obs(x.hex, x.hits));
if (!surfaces.length) surfaces.push(inf(mix(BG, FG, 0.04), "subtle surface tint (none distinctly observed)"));

// borders: ranked border colors that are gray + low-contrast
const borders = raw.borderColor.map(([c, h]) => ({ p: parseColor(c), hex: toHex(parseColor(c)), hits: h }))
  .filter((x) => x.p && x.p.a > 0.4 && x.hex && x.hex !== BG && Math.abs(lum(x.p) - bgLum) < 0.5)
  .slice(0, 2).map((x) => obs(x.hex, x.hits));
if (!borders.length) borders.push(inf(mix(BG, FG, 0.12), "hairline border (none distinctly observed)"));

// gradients — FILTER OUT trust-gradients so we never self-trip the linter
const TRUST_PATTERNS = [
  /linear-gradient\([^)]*#(6366f1|4f46e5|4338ca|3730a3|8b5cf6|7c3aed|a855f7)[^)]*#(3b82f6|2563eb|60a5fa|0ea5e9|06b6d4|22d3ee|ec4899|db2777|f472b6)/i,
  /linear-gradient\([^)]*#(3b82f6|2563eb|60a5fa)[^)]*#(06b6d4|22d3ee|0ea5e9)/i,
  /linear-gradient\([^)]*(purple|indigo|violet)[^)]*(blue|cyan|pink|fuchsia)/i,
  /linear-gradient\([^)]*(blue)[^)]*(cyan)/i,
];
const gradients = raw.gradients
  .filter(([g]) => !TRUST_PATTERNS.some((re) => re.test(g)))
  .slice(0, 4)
  .map(([g, h]) => obs(g, h));

// semantic — almost never on a landing page → inferred, brand-neutral
const semantic = {
  success: inf("#1a7f4b", "semantic success not observed on landing; conventional green"),
  danger: inf("#c0353a", "semantic danger not observed on landing; conventional red"),
  warning: inf("#b7791f", "semantic warning not observed on landing; conventional amber"),
};

// ── type classification ─────────────────────────────────────────────────
const pxOf = (s) => { const m = /([\d.]+)px/.exec(s || ""); return m ? +m[1] : null; };
const families = raw.families.map(([f, h]) => ({ value: f, hits: h, first: f.split(",")[0].replace(/["']/g, "").trim() }));
const bodyFam = raw.body.fontFamily;
const displayFamRaw = (raw.headings.h1 || raw.headings.h2 || {}).styles ? (raw.headings.h1 || raw.headings.h2).styles["font-family"] : bodyFam;
const monoFam = families.find((f) => /mono|code|consolas|menlo|courier/i.test(f.value));
// `primary` = the cleaned human family name (next/font hashes resolved); `backed`
// = a webfont file was actually downloaded for it. Generators use these to emit
// a full fallback stack + the right @font-face — never a raw family.
const backedByName = new Set(fonts.map((f) => f.family.toLowerCase()));
const mkRole = (value, role, hits, confidence, source) => {
  const primary = cleanFamily(value);
  return { value, role, hits, confidence, source, primary, backed: backedByName.has(primary.toLowerCase()) };
};
const typeFamilies = [];
typeFamilies.push(mkRole(displayFamRaw || bodyFam, "display", (families.find((f) => f.value === displayFamRaw) || {}).hits || 0, "observed", SRC_OBSERVED));
typeFamilies.push(mkRole(bodyFam, "body", (families.find((f) => f.value === bodyFam) || {}).hits || 0, "observed", SRC_OBSERVED));
typeFamilies.push(monoFam
  ? mkRole(monoFam.value, "mono", monoFam.hits, "observed", SRC_OBSERVED)
  : mkRole("ui-monospace, SFMono-Regular, Menlo, monospace", "mono", 0, "inferred", "inferred: no monospace family observed; system mono stack"));

const sizesPx = raw.sizes.map(([s, h]) => ({ px: pxOf(s), rem: pxOf(s) ? +(pxOf(s) / 16).toFixed(4) : null, hits: h })).filter((x) => x.px).sort((a, b) => a.px - b.px);

const headingType = {};
for (const tag of ["h1", "h2", "h3", "h4"]) {
  const h = raw.headings[tag]; if (!h) continue;
  headingType[tag] = {
    family: h.styles["font-family"], sizePx: pxOf(h.styles["font-size"]),
    weight: h.styles["font-weight"], lineHeight: h.styles["line-height"],
    tracking: h.styles["letter-spacing"], color: toHex(parseColor(h.styles.color)) || h.styles.color,
    transform: h.styles["text-transform"],
  };
}
const bodyType = {
  family: bodyFam, sizePx: pxOf(raw.body.fontSize), weight: raw.body.fontWeight,
  lineHeight: raw.body.lineHeight, tracking: raw.body.letterSpacing, color: toHex(parseColor(raw.body.color)) || raw.body.color,
};
const weights = raw.weights.map(([w, h]) => ({ value: w, hits: h })).filter((x) => /^\d+$/.test(x.value)).sort((a, b) => +a.value - +b.value);

// ── spacing / radius / shadow / motion ──────────────────────────────────
const spacingPx = raw.spacing.map(([s, h]) => ({ px: pxOf(s), hits: h })).filter((x) => x.px && x.px <= 160).sort((a, b) => a.px - b.px);
const radius = raw.radii.map(([r, h]) => ({ value: r, px: pxOf(r), hits: h })).filter((x) => x.value).sort((a, b) => (a.px || 9999) - (b.px || 9999));
const shadow = raw.shadows.map(([s, h]) => obs(s, h));
const motion = {
  durations: raw.durations.map(([d, h]) => ({ value: d, hits: h })).slice(0, 6),
  easings: raw.easings.map(([e, h]) => ({ value: e, hits: h })).slice(0, 5),
};

// screenshots present
const SCREENS = ["full.png", "hero.png", "nav.png", "hero-section.png", "btn-default.png", "btn-hover.png", "input-default.png", "input-focus.png", "footer.png", "mobile.png"]
  .filter((f) => existsSync(join(SHOTS, f)));

const harvest = {
  $schema: "cb-design-dna/harvest.json@v1",
  source: { url: URL, capturedAt: new Date(t0).toISOString(), viewport: VIEWPORT, deviceScaleFactor: DSF, userAgent: UA },
  meta: { title: raw.title, lang: raw.lang, description: raw.meta["description"] || raw.meta["og:description"] || null, og: { title: raw.meta["og:title"] || null, image: raw.meta["og:image"] || null, type: raw.meta["og:type"] || null } },
  palette: {
    bg: obs(BG, bgPick ? bgPick.hits : 0),
    fg: obs(FG, FGpick ? FGpick.hits : 0),
    accent: accentObserved ? obs(ACCENT, accentPick.hits) : inf(ACCENT, "no saturated accent observed; high-contrast fallback"),
    accentHover,
    fgMuted: FG_MUTED, fgSubtle: FG_SUBTLE,
    surfaces, borders, semantic, gradients,
  },
  colorsObserved: bgRanked.slice(0, 30).map((x) => ({ value: x.hex, hits: x.hits })),
  type: { families: typeFamilies, sizesPx, headings: headingType, body: bodyType, weights },
  spacingPx, radius, shadow, motion,
  components: { buttons: raw.buttons, link: raw.link, nav: raw.nav, input: raw.input, cards: raw.cards, footer: raw.footer, hoverStyle },
  assets: { logo: raw.logoHTML ? "assets/logo.svg" : null, images: assetImages },
  fonts,
  fontGaps,
  screenshots: SCREENS,
  a11y: raw.a11y,
  rootVars: raw.rootVars,
};

writeFileSync(join(SRC, "harvest.json"), JSON.stringify(harvest, null, 2) + "\n");
log(`wrote source/harvest.json · accent ${ACCENT}${accentObserved ? "" : " (inferred)"} · bg ${BG} · fg ${FG} · ${typeFamilies.length} families · ${sizesPx.length} sizes · ${fonts.length} fonts`);
log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
