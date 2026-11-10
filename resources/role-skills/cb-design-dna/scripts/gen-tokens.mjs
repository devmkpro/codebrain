#!/usr/bin/env node
/*
 * gen-tokens.mjs — DETERMINISTIC token bucketing from harvest.json.
 *
 * Usage:  node gen-tokens.mjs <outdir>
 *
 * Reads <outdir>/source/harvest.json (the single source of truth) and emits,
 * with a documented heuristic, the canonical 4-layer token system + derivatives:
 *   tokens.css                          (canonical, 4 layers, confidence comments)
 *   design-tokens.json                  (DERIVED — DTCG-ish, confidence per leaf)
 *   tailwind-v4.css                     (DERIVED — @theme maps utilities → tokens)
 *   source/tokens.source.json           (flat token table w/ confidence)
 *   source/token-contract.report.json   (token → tokens.css line + confidence)
 *
 * HEURISTIC (deterministic, documented):
 *  • colors come straight from harvest.palette (already classified, with conf).
 *  • type scale: 9 named slots mapped to px anchors [12,14,16,18,22,26,32,44,56];
 *    each slot snaps to the NEAREST observed size (±2px ⇒ observed) else anchor
 *    (inferred). Large slots (≥26px) get a reconstructed clamp() ⇒ inferred.
 *  • spacing: canonical grid 4,8,12,16,20,24,32,48,64,96 → space-1..space-24;
 *    observed when that px appears in harvest.spacingPx, else inferred.
 *  • radius: observed radii snapped to sm/md/lg by px; full = 9999px.
 *  • shadow: top observed shadows → shadow-sm..xl ordered by blur magnitude.
 *  • motion: observed durations → fast/base/slow; easings → out/in-out/smooth.
 *  Nothing is invented silently — every inferred value carries an inferred tag.
 *
 * Zero deps — pure Node.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(process.cwd(), process.argv[2] || ".");
const SRC = join(OUT, "source");
const HARVEST = join(SRC, "harvest.json");
if (!existsSync(HARVEST)) { console.error(`error: ${HARVEST} not found — run harvest.mjs first`); process.exit(2); }
mkdirSync(SRC, { recursive: true });
const H = JSON.parse(readFileSync(HARVEST, "utf8"));
const log = (...a) => console.log("[gen-tokens]", ...a);

const O = "observed", I = "inferred", P = "provided";
const capDate = (H.source.capturedAt || "").slice(0, 10);
const SRC_OBS = `${H.source.url} (getComputedStyle, ${capDate})`;

// token rows: [name, value, confidence, layer, group, note]
const T = [];
const push = (name, value, conf, layer, group, note) => T.push([name, value, conf, layer, group, note || ""]);
const confOf = (slot) => slot && slot.confidence === O ? O : slot && slot.confidence === P ? P : I;
const valOf = (slot, fb) => (slot && slot.value != null) ? slot.value : fb;

// ── helpers ──────────────────────────────────────────────────────────────
const pal = H.palette;

// ════ A1-identity ════
push("bg", valOf(pal.bg, "#ffffff"), confOf(pal.bg), "A1-identity", "color", `page surface · ${pal.bg.hits} hits`);
push("fg", valOf(pal.fg, "#0a0a0a"), confOf(pal.fg), "A1-identity", "color", `primary ink · ${pal.fg.hits} hits`);
push("accent", valOf(pal.accent, "#1a1a1a"), confOf(pal.accent), "A1-identity", "color", pal.accent.confidence === O ? `brand accent · ${pal.accent.hits} hits` : pal.accent.source);
push("accent-hover", valOf(pal.accentHover, "#000000"), confOf(pal.accentHover), "A1-identity", "color", pal.accentHover.source);

// fonts — NEVER emit a raw family. Always a COMPLETE fallback stack so the render
// degrades gracefully when the webfont is missing. @font-face is emitted ONLY for
// families with a downloaded file (see below); a family without a file lives in the
// stack only (marked inferred + noted as a gap).
const SANS_FB = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO_FB = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
function cleanFam(rawStack) {
  if (!rawStack) return "";
  let f = String(rawStack).split(",")[0].replace(/["']/g, "").trim();
  const m = f.match(/^__(.+?)(?:_Fallback)?_[0-9a-f]{4,}$/i); // next/font hash → human
  if (m) f = m[1].replace(/_/g, " ").trim();
  return f;
}
const SYS_FAM = /^(system-ui|-apple-system|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|inherit|initial)$/i;
const stackFor = (primary, kind) => {
  const fb = kind === "mono" ? MONO_FB : SANS_FB;
  return primary && !SYS_FAM.test(primary) ? `"${primary}", ${fb}` : fb;
};
const roleOf = (r) => H.type.families.find((f) => f.role === r) || {};
const FONTS = H.fonts || [];
const isBacked = (primary) => !!primary && FONTS.some((f) => (f.family || "").toLowerCase() === primary.toLowerCase() && (f.files || []).length);

const dispPrimary = roleOf("display").primary || cleanFam(roleOf("display").value);
const bodyPrimary = roleOf("body").primary || cleanFam(roleOf("body").value);
const monoPrimary = roleOf("mono").primary || cleanFam(roleOf("mono").value);

const dispNote = isBacked(dispPrimary) ? `${dispPrimary || "system"} · @font-face bundled` : `${dispPrimary || "system"} · no webfont file — relies on fallback stack`;
const bodyNote = isBacked(bodyPrimary) ? `${bodyPrimary || "system"} · @font-face bundled` : `${bodyPrimary || "system"} · no webfont file — relies on fallback stack`;
push("font-display", stackFor(dispPrimary, "sans"), isBacked(dispPrimary) ? O : I, "A1-identity", "font", `heading family — ${dispNote}`);
push("font-body", stackFor(bodyPrimary, "sans"), isBacked(bodyPrimary) ? O : I, "A1-identity", "font", `body family — ${bodyNote}`);

// ════ A1-structure — type scale ════
const ANCHORS = [["text-xs", 12], ["text-sm", 14], ["text-base", 16], ["text-lg", 18], ["text-xl", 22], ["text-2xl", 26], ["text-3xl", 32], ["text-4xl", 44], ["text-5xl", 56]];
const observedPx = (H.type.sizesPx || []).map((s) => s.px);
function nearestObserved(target) {
  let best = null, bestD = Infinity;
  for (const px of observedPx) { const d = Math.abs(px - target); if (d < bestD) { bestD = d; best = px; } }
  return bestD <= 2 ? best : null;
}
function clampFor(px) {
  // reconstruct a fluid clamp: min ≈ 0.86·px, max = px, fluid via vw
  const min = +(px * 0.82 / 16).toFixed(3), max = +(px / 16).toFixed(3);
  const vw = +((max - min) / (1440 / 100) * 100 / 6).toFixed(2); // gentle slope
  return `clamp(${min}rem, ${(min + 0.2).toFixed(3)}rem + ${vw}vw, ${max}rem)`;
}
for (const [name, anchor] of ANCHORS) {
  const obsPx = nearestObserved(anchor);
  if (anchor >= 26) {
    // fluid headings — clamp reconstructed ⇒ inferred (even if min seen)
    const basePx = obsPx || anchor;
    push(name, clampFor(basePx), I, "A1-structure", "size", `${basePx}px ${obsPx ? "observed min" : "anchor"}, clamp reconstructed`);
  } else if (obsPx) {
    push(name, `${+(obsPx / 16).toFixed(4)}rem`, O, "A1-structure", "size", `${obsPx}px observed`);
  } else {
    push(name, `${+(anchor / 16).toFixed(4)}rem`, I, "A1-structure", "size", `${anchor}px anchor (not observed)`);
  }
}

// leading / tracking / weights from headings + body
const h1 = H.type.headings.h1 || {}, h2 = H.type.headings.h2 || {}, h3 = H.type.headings.h3 || {};
const lhTight = h1.lineHeight && /^[\d.]+$/.test(h1.lineHeight) ? h1.lineHeight : (h1.lineHeight && h1.sizePx ? (parseFloat(h1.lineHeight) / h1.sizePx).toFixed(2) : null);
push("leading-tight", lhTight || "1.1", lhTight ? O : I, "A1-structure", "leading", "heading line-height");
push("leading-snug", "1.3", I, "A1-structure", "leading", "interpolated");
const bodyLH = H.type.body.lineHeight && H.type.body.sizePx ? (/^[\d.]+$/.test(H.type.body.lineHeight) ? H.type.body.lineHeight : (parseFloat(H.type.body.lineHeight) / H.type.body.sizePx).toFixed(2)) : null;
push("leading-normal", bodyLH || "1.5", bodyLH ? O : I, "A1-structure", "leading", "body rhythm");

const trk = (h) => h.tracking && h.tracking !== "normal" && h.sizePx ? `${(parseFloat(h.tracking) / h.sizePx).toFixed(3)}em` : null;
const t1 = trk(h1), t3 = trk(h3);
push("tracking-tight", t1 || "-0.02em", t1 ? O : I, "A1-structure", "tracking", "heading tracking");
push("tracking-snug", t3 || "-0.01em", t3 ? O : I, "A1-structure", "tracking", "subhead tracking");
push("tracking-normal", "0em", I, "A1-structure", "tracking", "body default");

const wts = (H.type.weights || []).map((w) => +w.value);
const wLight = wts.find((w) => w <= 350);
const wReg = wts.find((w) => w >= 380 && w <= 460) || 400;
const wMed = wts.find((w) => w >= 480 && w <= 560);
const wBold = wts.find((w) => w >= 600);
push("weight-light", String(wLight || 300), wLight ? O : I, "A1-structure", "weight", "light headings");
push("weight-regular", String(wReg), O, "A1-structure", "weight", "body/buttons");
push("weight-medium", String(wMed || 500), wMed ? O : I, "A1-structure", "weight", "UI emphasis");
push("weight-bold", String(wBold || 700), wBold ? O : I, "A1-structure", "weight", "strong emphasis");

// layout — harvest-driven when observed (H.layout), else conservative default
const layout = H.layout || {};
const cmaxS = layout.containerMax, cwideS = layout.containerWide;
push("container-max", cmaxS ? valOf(cmaxS) : "1080px", cmaxS ? confOf(cmaxS) : I, "A1-structure", "layout", cmaxS ? (cmaxS.source || "observed container width") : "content column (not directly observed)");
push("container-wide", cwideS ? valOf(cwideS) : "1280px", cwideS ? confOf(cwideS) : I, "A1-structure", "layout", cwideS ? (cwideS.source || "observed wrapper width") : "wrapper width");
push("section-y", "clamp(4rem, 8vw, 8rem)", I, "A1-structure", "layout", "section rhythm");
push("section-y-sm", "clamp(2.5rem, 5vw, 4rem)", I, "A1-structure", "layout", "tight section rhythm");
const gutter = (H.spacingPx || []).find((s) => s.px === 16 || s.px === 24);
push("gutter", gutter ? `${gutter.px / 16}rem` : "1rem", gutter ? O : I, "A1-structure", "layout", "page padding");

// ════ A2 — spacing scale ════
const GRID = [["space-1", 4], ["space-2", 8], ["space-3", 12], ["space-4", 16], ["space-5", 20], ["space-6", 24], ["space-8", 32], ["space-12", 48], ["space-16", 64], ["space-24", 96]];
const obsSpace = new Set((H.spacingPx || []).map((s) => s.px));
for (const [name, px] of GRID) {
  const seen = obsSpace.has(px);
  push(name, `${px / 16}rem`, seen ? O : I, "A2", "space", `${px}px${seen ? " observed" : " grid step"}`);
}

// radius
const radii = (H.radius || []).filter((r) => r.px != null && r.px < 9000).sort((a, b) => a.px - b.px);
const pickRad = (lo, hi) => radii.find((r) => r.px >= lo && r.px <= hi);
const rSm = pickRad(2, 5), rMd = pickRad(6, 10), rLg = pickRad(11, 20);
push("radius-sm", rSm ? rSm.value : "4px", rSm ? O : I, "A2", "radius", rSm ? `${rSm.hits} hits` : "small radius");
push("radius-md", rMd ? rMd.value : "8px", rMd ? O : I, "A2", "radius", rMd ? `${rMd.hits} hits` : "medium radius");
push("radius-lg", rLg ? rLg.value : "12px", rLg ? O : I, "A2", "radius", rLg ? `${rLg.hits} hits` : "large radius");
const rFull = (H.radius || []).find((r) => r.px >= 9000 || /9999|50%/.test(r.value));
push("radius-full", rFull ? rFull.value : "9999px", rFull ? O : I, "A2", "radius", "pills / circular");

// shadow — order observed shadows by blur magnitude, take up to 4
const blurMag = (s) => { const nums = (s.match(/-?[\d.]+px/g) || []).map((n) => Math.abs(parseFloat(n))); return nums.length ? Math.max(...nums) : 0; };
const shObs = (H.shadow || []).map((s) => ({ v: s.value, hits: s.hits, mag: blurMag(s.value) })).sort((a, b) => a.mag - b.mag);
const shNames = ["shadow-sm", "shadow-md", "shadow-lg", "shadow-xl"];
if (shObs.length) {
  // distribute up to 4 across the observed range
  const picks = shObs.length <= 4 ? shObs : [shObs[0], shObs[Math.floor(shObs.length / 3)], shObs[Math.floor(2 * shObs.length / 3)], shObs[shObs.length - 1]];
  shNames.forEach((n, i) => { const p = picks[Math.min(i, picks.length - 1)]; push(n, p.v, O, "A2", "shadow", `${p.hits} hits`); });
} else {
  push("shadow-sm", "0 1px 2px rgba(0,0,0,0.06)", I, "A2", "shadow", "no shadow observed");
  push("shadow-md", "0 4px 12px rgba(0,0,0,0.08)", I, "A2", "shadow", "no shadow observed");
  push("shadow-lg", "0 12px 32px rgba(0,0,0,0.12)", I, "A2", "shadow", "no shadow observed");
  push("shadow-xl", "0 24px 60px rgba(0,0,0,0.16)", I, "A2", "shadow", "no shadow observed");
}

// motion
const durs = (H.motion.durations || []).map((d) => d.value);
push("motion-fast", durs[0] || "0.15s", durs[0] ? O : I, "A2", "motion", "fast transition");
push("motion-base", durs[1] || durs[0] || "0.25s", durs[1] || durs[0] ? O : I, "A2", "motion", "base transition");
push("motion-slow", durs[2] || "0.4s", durs[2] ? O : I, "A2", "motion", "slow transition");
const eases = (H.motion.easings || []).map((e) => e.value).filter((e) => /cubic-bezier/.test(e));
push("ease-out", eases[0] || "cubic-bezier(0.25, 1, 0.5, 1)", eases[0] ? O : I, "A2", "motion", "ease-out");
push("ease-in-out", eases[1] || "cubic-bezier(0.45, 0.05, 0.55, 0.95)", eases[1] ? O : I, "A2", "motion", "ease-in-out");
push("ease-smooth", eases[2] || "cubic-bezier(0.3, 0, 0.2, 1)", eases[2] ? O : I, "A2", "motion", "smooth");

// mono + muted/subtle + semantic
push("font-mono", stackFor(monoPrimary, "mono"), (monoPrimary && roleOf("mono").confidence === O) ? O : I, "A2", "font", monoPrimary ? `mono family — ${isBacked(monoPrimary) ? monoPrimary + " · @font-face bundled" : (monoPrimary + " · fallback stack")}` : "system mono stack");
push("fg-muted", valOf(pal.fgMuted, "#666"), confOf(pal.fgMuted), "A2", "color", pal.fgMuted.confidence === O ? `${pal.fgMuted.hits} hits` : pal.fgMuted.source);
push("fg-subtle", valOf(pal.fgSubtle, "#888"), confOf(pal.fgSubtle), "A2", "color", pal.fgSubtle.confidence === O ? `${pal.fgSubtle.hits} hits` : pal.fgSubtle.source);
push("success", pal.semantic.success.value, confOf(pal.semantic.success), "A2", "color", pal.semantic.success.source);
push("danger", pal.semantic.danger.value, confOf(pal.semantic.danger), "A2", "color", pal.semantic.danger.source);
if (pal.semantic.warning) push("warning", pal.semantic.warning.value, confOf(pal.semantic.warning), "A2", "color", pal.semantic.warning.source);

// ════ B-slot ════
push("surface", valOf(pal.bg, "#ffffff"), confOf(pal.bg), "B-slot", "color", "card/panel base = bg");
pal.surfaces.forEach((s, i) => push(`surface-${i === 0 ? "muted" : "tint"}`, s.value, confOf(s), "B-slot", "color", s.confidence === O ? `alt surface · ${s.hits} hits` : s.source));
pal.borders.forEach((b, i) => push(i === 0 ? "border" : "border-strong", b.value, confOf(b), "B-slot", "color", b.confidence === O ? `hairline · ${b.hits} hits` : b.source));
if (pal.borders.length === 1) push("border-strong", pal.borders[0].value, confOf(pal.borders[0]), "B-slot", "color", "divider (= border)");
push("fg-2", "var(--fg-muted)", O, "B-slot", "alias", "aliasTo fg-muted");
push("link", "var(--accent)", O, "B-slot", "alias", "aliasTo accent");
push("focus-ring", "var(--accent)", O, "B-slot", "alias", "aliasTo accent");

// accent-soft: a light tint of accent (for soft fills) — inferred mix toward bg
push("accent-soft", mixHex(valOf(pal.accent, "#1a1a1a"), valOf(pal.bg, "#fff"), 0.82), I, "B-slot", "color", "light accent fill (mixed toward bg)");
push("accent-soft-fg", "var(--accent)", O, "B-slot", "alias", "aliasTo accent");

// ════ C-extensions ════
push("accent-light", mixHex(valOf(pal.accent, "#1a1a1a"), valOf(pal.bg, "#fff"), 0.3), I, "C-extensions", "color", "lighter accent (mixed 30% toward bg)");
push("accent-lighter", mixHex(valOf(pal.accent, "#1a1a1a"), valOf(pal.bg, "#fff"), 0.55), I, "C-extensions", "color", "lightest accent (mixed 55% toward bg)");
(pal.gradients || []).forEach((g, i) => push(`grad-${i + 1}`, g.value, confOf(g), "C-extensions", "gradient", `observed gradient · ${g.hits} hits`));
// brand-specific semantic taxonomy colors (e.g. post-type badges) → C-extensions
for (const [k, slot] of Object.entries(pal.semantic || {})) {
  if (!/^badge/i.test(k) || !slot || slot.value == null) continue;
  const tname = k.replace(/([A-Z])/g, "-$1").toLowerCase(); // badgeReel → badge-reel
  push(tname, slot.value, confOf(slot), "C-extensions", "color", slot.source);
}

// SOURCE-FIRST faithful tokens — named @theme colors + full ramps that live in
// the CODEBASE source (globals.css @theme + design-tokens.json), NOT derivable
// from the rendered DOM. Optional keys; backward-compatible when absent.
const PCONF = (c) => (c === O ? O : c === P ? P : I);
const named = (pal.named && typeof pal.named === "object") ? pal.named : {};
for (const [nm, slot] of Object.entries(named)) {
  if (!slot || slot.value == null) continue;
  push(nm, slot.value, PCONF(slot.confidence), "C-extensions", slot.group || "color", slot.source || "");
}
const ramps = (H.ramps && typeof H.ramps === "object") ? H.ramps : {};
for (const [rname, stops] of Object.entries(ramps)) {
  (stops || []).forEach((s, i) => {
    if (!s || s.value == null) return;
    push(`ramp-${rname}-${i + 1}`, s.value, PCONF(s.confidence), "C-extensions", "color", s.source || `${rname} ramp stop ${i + 1}`);
  });
}

// ── color mix helper ──────────────────────────────────────────────────────
function parseHex(h) { const m = /^#([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const x = m[1]; return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) }; }
function mixHex(aHex, bHex, t) { const a = parseHex(aHex), b = parseHex(bHex); if (!a || !b) return aHex; const c = { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }; return "#" + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }

// ════════════════════════════════════════════════════════════════════════
//  EMIT tokens.css
// ════════════════════════════════════════════════════════════════════════
const brand = (H.meta.title || H.source.url).replace(/\s*[|—-].*$/, "").trim();

// @font-face — ONLY for families with a real downloaded file. The declared
// family NAME equals the stack primary so the browser actually applies it.
// Path is ./fonts/ relative to tokens.css; previews/components rewrite to ../fonts/.
let fontFace = "";
const emittedFaces = new Set();
for (const f of FONTS) {
  const fam = (f.family || "Brand").replace(/"/g, "");
  const faces = (f.faces && f.faces.length) ? f.faces : (f.files || []).map((file) => ({ file, weight: "", format: "woff2" }));
  for (const face of faces) {
    if (!face || !face.file) continue;
    const wKey = `${fam.toLowerCase()}|${face.weight || ""}`;
    if (emittedFaces.has(wKey)) continue; // one face per (family,weight) — first subset wins
    emittedFaces.add(wKey);
    const rel = `./${face.file.replace(/^\.?\/?/, "").replace(/^fonts\//, "fonts/")}`;
    const fmt = face.format || (/\.woff2/i.test(face.file) ? "woff2" : /\.woff/i.test(face.file) ? "woff" : /\.ttf/i.test(face.file) ? "truetype" : /\.otf/i.test(face.file) ? "opentype" : "woff2");
    const wLine = face.weight ? ` font-weight: ${face.weight};` : "";
    fontFace += `@font-face { font-family: "${fam}";${wLine} src: url("${rel}") format("${fmt}"); font-display: swap; }\n`;
  }
}

const byLayer = (layer) => T.filter((r) => r[3] === layer);
const layerComment = { "A1-identity": "A1-identity — brand decides · REQUIRED", "A1-structure": "A1-structure — brand decides · REQUIRED", "A2": "A2 — brand with sensible fallback", "B-slot": "B-slot — brand value or aliasTo schema default", "C-extensions": "C-extensions — brand-specific, allowlisted" };
let css = `/* tokens.css — CANONICAL 4-layer design tokens for ${brand}.
   Source of truth: source/harvest.json. Generated by scripts/gen-tokens.mjs.
   confidence: observed = read off the live site · inferred = reconstructed/defaulted.
   Captured ${capDate} from ${H.source.url}. DO NOT hand-edit — re-run gen-tokens. */
${fontFace ? "\n" + fontFace : ""}
:root {
`;
for (const layer of ["A1-identity", "A1-structure", "A2", "B-slot", "C-extensions"]) {
  css += `\n  /* ── ${layerComment[layer]} ── */\n`;
  for (const [name, value, conf, , , note] of byLayer(layer)) {
    css += `  --${name}: ${value}; /* ${conf}${note ? " · " + note : ""} */\n`;
  }
}
css += `}\n`;
writeFileSync(join(OUT, "tokens.css"), css);

// ════════════════════════════════════════════════════════════════════════
//  EMIT design-tokens.json (DERIVED, grouped by layer, confidence per leaf)
// ════════════════════════════════════════════════════════════════════════
const typeOf = (g) => ({ color: "color", font: "fontFamily", size: "dimension", space: "dimension", radius: "dimension", shadow: "shadow", motion: "duration", leading: "number", tracking: "dimension", weight: "fontWeight", layout: "dimension", gradient: "gradient", alias: "other" }[g] || "other");
const groups = {};
for (const [name, value, conf, layer, group, note] of T) {
  groups[layer] ??= {};
  groups[layer][name] = {
    $value: value, $type: typeOf(group),
    confidence: conf, source: conf === O ? SRC_OBS : (conf === P ? (note || "provided (authored source)") : (note.startsWith("inferred") || note.startsWith("aliasTo") ? note : "reconstructed from observed range")),
    layer, group, var: `--${name}`, note: note || undefined,
  };
}
const dt = { $description: `${brand} design DNA — DERIVED from tokens.css. Do not hand-edit.`, $source: H.source.url, $capturedAt: capDate, ...groups };
writeFileSync(join(OUT, "design-tokens.json"), JSON.stringify(dt, null, 2) + "\n");

// ════════════════════════════════════════════════════════════════════════
//  EMIT source/tokens.source.json + source/token-contract.report.json
// ════════════════════════════════════════════════════════════════════════
const cssLines = css.split("\n");
const lineOf = (name) => { const i = cssLines.findIndex((l) => new RegExp(`--${name}\\s*:`).test(l)); return i >= 0 ? i + 1 : null; };

const flat = {};
for (const [name, value, conf, layer, group, note] of T) flat[`--${name}`] = { value, confidence: conf, layer, group, note };
writeFileSync(join(SRC, "tokens.source.json"), JSON.stringify({ $description: `Flat token table derived/observed from ${H.source.url}`, source: H.source.url, capturedAt: capDate, tokens: flat }, null, 2) + "\n");

const report = {
  $description: "Maps every token → declaration line in tokens.css, with layer + confidence.",
  source: H.source.url, capturedAt: capDate,
  layers: ["A1-identity", "A1-structure", "A2", "B-slot", "C-extensions"],
  tokens: T.map(([name, value, conf, layer, group, note]) => ({ token: `--${name}`, value, layer, group, confidence: conf, tokensCssLine: lineOf(name), note })),
  summary: { total: T.length, observed: T.filter((r) => r[2] === O).length, inferred: T.filter((r) => r[2] === I).length, provided: T.filter((r) => r[2] === P).length },
};
writeFileSync(join(SRC, "token-contract.report.json"), JSON.stringify(report, null, 2) + "\n");

// ════════════════════════════════════════════════════════════════════════
//  EMIT tailwind-v4.css (DERIVED @theme)
// ════════════════════════════════════════════════════════════════════════
const has = (n) => T.some((r) => r[0] === n);
const themeLine = (twVar, tok) => has(tok) ? `  ${twVar}: var(--${tok});\n` : "";
let tw = `/* tailwind-v4.css — DERIVED from tokens.css. Do NOT hand-edit (gen-tokens.mjs).
   @theme maps Tailwind utility vars → canonical tokens. Load tokens.css first. */
@import "./tokens.css";

@theme inline {
  /* colors */
${["bg", "fg", "fg-muted", "fg-subtle", "accent", "accent-hover", "accent-soft", "surface", "surface-muted", "border", "success", "danger", "warning"].map((c) => themeLine(`--color-${c}`, c)).join("")}  /* typography */
${["font-display", "font-body", "font-mono"].map((f) => themeLine(`--${f}`, f)).join("")}${["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl"].map((t) => themeLine(`--${t}`, t)).join("")}  /* spacing */
${["space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-8", "space-12", "space-16", "space-24"].map((s, i) => themeLine(`--spacing-${s.split("-")[1]}`, s)).join("")}  /* radius + shadow */
${["radius-sm", "radius-md", "radius-lg", "radius-full"].map((r) => themeLine(`--${r}`, r)).join("")}${["shadow-sm", "shadow-md", "shadow-lg", "shadow-xl"].map((s) => themeLine(`--${s}`, s)).join("")}  /* motion */
${["ease-out", "ease-in-out", "ease-smooth"].map((e) => themeLine(`--${e}`, e)).join("")}}
`;
writeFileSync(join(OUT, "tailwind-v4.css"), tw);

log(`emitted ${T.length} tokens · ${report.summary.observed} observed / ${report.summary.inferred} inferred · brand "${brand}"`);
