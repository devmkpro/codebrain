#!/usr/bin/env node
/*
 * gen-motion.mjs — DERIVES the motion handoff from source/motion.json.   [CB-DESIGN-MOTION]
 *
 * Usage:  node gen-motion.mjs <design-system-dir>
 *
 * Reads   <dir>/source/motion.json   (emitted by harvest-motion.mjs)
 * Writes  <dir>/motion.css            tokens + every @keyframes WITH ITS BODY
 *         <dir>/motion.manifest.json  machine inventory (the components.manifest.json of motion)
 *         <dir>/motion.js             reveal runner: IntersectionObserver + stagger + reduced-motion guard
 *         <dir>/preview/motion.html   self-contained: plays each animation isolated, with scrub
 *
 * Why this exists: cor, tipo e spacing já saíam como contrato reproduzível
 * (tokens + manifest + preview). Motion saía como prosa — nome de keyframe sem
 * corpo, três durações globais, nenhum preview. O builder downstream recebia
 * movimento como folclore e chutava. Estes quatro arquivos fecham essa lacuna.
 *
 * DERIVED, never hand-authored — same rule as design-tokens.json / tailwind-v4.css.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: node gen-motion.mjs <design-system-dir>");
  process.exit(2);
}
const DIR = resolve(process.cwd(), target);
const SRC = join(DIR, "source", "motion.json");
if (!existsSync(SRC)) {
  console.error(`[gen-motion] ${SRC} not found — run harvest-motion.mjs first.`);
  process.exit(2);
}
const M = JSON.parse(readFileSync(SRC, "utf8"));
const log = (...a) => console.log("[gen-motion]", ...a);

// ── helpers ───────────────────────────────────────────────────────────────
const msOf = (v) => {
  if (!v) return 0;
  const s = String(v).trim();
  if (s.endsWith("ms")) return parseFloat(s);
  if (s.endsWith("s")) return parseFloat(s) * 1000;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const cssIdent = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").toLowerCase();
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── 1. duration scale ─────────────────────────────────────────────────────
// Ranked by real occurrence, then sorted: the three most-used become
// fast/base/slow (the names the rest of the system already speaks), and every
// other observed duration is kept as a numbered token instead of being thrown
// away — throwing them away is how "3 global durations" happened.
const durs = (M.scale?.durations || [])
  .map((d) => ({ raw: d.value, ms: msOf(d.value), hits: d.hits }))
  .filter((d) => d.ms > 0);
const byHits = [...durs].sort((a, b) => b.hits - a.hits).slice(0, 3).sort((a, b) => a.ms - b.ms);
const roleNames = ["motion-fast", "motion-base", "motion-slow"];
const durTokens = [];
byHits.forEach((d, i) => durTokens.push({ name: roleNames[i], value: d.raw, ms: d.ms, hits: d.hits, role: true }));
[...durs]
  .sort((a, b) => a.ms - b.ms)
  .forEach((d, i) => {
    if (byHits.some((b) => b.raw === d.raw)) return;
    durTokens.push({ name: `motion-d${i + 1}`, value: d.raw, ms: d.ms, hits: d.hits, role: false });
  });

// ── 2. easing scale ───────────────────────────────────────────────────────
const eases = (M.scale?.easings || []).filter((e) => e.value && e.value !== "linear");
const easeTokens = eases.map((e, i) => ({
  name: i === 0 ? "ease-standard" : `ease-${i + 1}`,
  value: e.value,
  hits: e.hits,
  // an easing whose 2nd control point overshoots 1 is a spring, and that IS
  // the personality of the motion — label it so the builder does not flatten it
  spring: /cubic-bezier\([^)]*\)/.test(e.value) && (e.value.match(/[-\d.]+/g) || []).some((n, idx) => idx === 3 && parseFloat(n) > 1),
}));

// ── 3. delay / stagger ────────────────────────────────────────────────────
const delayTokens = (M.scale?.delays || [])
  .filter((d) => msOf(d.value) > 0)
  .slice(0, 6)
  .map((d, i) => ({ name: `motion-delay-${i + 1}`, value: d.value, hits: d.hits }));
const staggerStep = M.stagger?.length ? Math.round(M.stagger[0].stepMs) : null;

// ── 4. effect tokens (the layer that used to be a "[?]") ──────────────────
const effectTokens = [];
(M.effects?.backdropFilter || []).forEach((e, i) => {
  effectTokens.push({ name: i === 0 ? "glass" : `glass-${i + 1}`, prop: "backdrop-filter", value: e.value, hits: e.hits });
});
(M.effects?.filter || []).forEach((e, i) => {
  effectTokens.push({ name: `filter-${i + 1}`, prop: "filter", value: e.value, hits: e.hits });
});
(M.effects?.glowShadows || []).slice(0, 6).forEach((e, i) => {
  effectTokens.push({ name: `glow-${i + 1}`, prop: "box-shadow", value: e.value, hits: e.hits });
});
(M.effects?.mixBlendMode || []).forEach((e, i) => {
  effectTokens.push({ name: `blend-${i + 1}`, prop: "mix-blend-mode", value: e.value, hits: e.hits });
});

// ── 5. motion.css ─────────────────────────────────────────────────────────
const kf = M.keyframes || [];
const cssParts = [];
cssParts.push(`/* motion.css — DERIVED from source/motion.json by scripts/gen-motion.mjs. Do not hand-edit.
 * source:  ${M.source?.url || "?"}
 * captured: ${M.source?.capturedAt || "?"}  (mode: ${M.source?.captureMode || "?"})
 * ${kf.length} keyframes with bodies · ${durTokens.length} durations · ${easeTokens.length} easings · ${effectTokens.length} effect tokens
 */`);
cssParts.push(":root {");
cssParts.push("  /* durations — observed, ranked by occurrence */");
durTokens.forEach((d) => cssParts.push(`  --${d.name}: ${d.value};${d.role ? "" : ""} /* ${d.hits}x */`));
cssParts.push("  /* easings — the site's personality lives here */");
easeTokens.forEach((e) =>
  cssParts.push(`  --${e.name}: ${e.value}; /* ${e.hits}x${e.spring ? " · SPRING: overshoots and settles — do not flatten" : ""} */`)
);
if (delayTokens.length) {
  cssParts.push("  /* delays */");
  delayTokens.forEach((d) => cssParts.push(`  --${d.name}: ${d.value}; /* ${d.hits}x */`));
}
if (staggerStep) cssParts.push(`  --stagger-step: ${staggerStep}ms; /* measured sibling delay step */`);
if (effectTokens.length) {
  cssParts.push("  /* surface effects — real observed values, never a placeholder */");
  effectTokens.forEach((e) => cssParts.push(`  --${e.name}: ${e.value}; /* ${e.prop} · ${e.hits}x */`));
}
cssParts.push("}");
cssParts.push("");
cssParts.push("/* ── keyframes, with their bodies ─────────────────────────────────── */");
kf.forEach((k) => {
  cssParts.push(`@keyframes ${k.name} {`);
  (k.offsets || []).forEach((o) => {
    const decls = Object.entries(o.props || {})
      .map(([p, v]) => `${p}: ${v};`)
      .join(" ");
    cssParts.push(`  ${o.offset} { ${decls} }`);
  });
  cssParts.push("}");
});
if (M.reducedMotion?.respected) {
  cssParts.push("");
  cssParts.push(`/* the source declares ${M.reducedMotion.ruleCount} prefers-reduced-motion rules — honour it */`);
  cssParts.push("@media (prefers-reduced-motion: reduce) {");
  cssParts.push("  *, *::before, *::after {");
  cssParts.push("    animation-duration: 0.01ms !important;");
  cssParts.push("    animation-iteration-count: 1 !important;");
  cssParts.push("    transition-duration: 0.01ms !important;");
  cssParts.push("    scroll-behavior: auto !important;");
  cssParts.push("  }");
  cssParts.push("}");
}
writeFileSync(join(DIR, "motion.css"), cssParts.join("\n") + "\n");

// ── 6. motion.manifest.json ───────────────────────────────────────────────
const tokenRefs = [
  ...durTokens.map((d) => `--${d.name}`),
  ...easeTokens.map((e) => `--${e.name}`),
  ...delayTokens.map((d) => `--${d.name}`),
  ...effectTokens.map((e) => `--${e.name}`),
];
const manifest = {
  $schema: "cb-design-dna/motion.manifest.json@v1",
  derivedFrom: "source/motion.json",
  card: "CB-DESIGN-MOTION",
  source: { url: M.source?.url, capturedAt: M.source?.capturedAt, captureMode: M.source?.captureMode },
  counts: {
    keyframes: kf.length,
    keyframesWithBody: kf.filter((k) => (k.offsets || []).length > 0).length,
    animatedElements: (M.animations || []).length,
    transitions: (M.transitions || []).length,
    reveals: (M.reveals || []).length,
    staggerGroups: (M.stagger || []).length,
    effectTokens: effectTokens.length,
    frameStrips: (M.frameStrips || []).length,
    frameStripsProvingMotion: (M.frameStrips || []).filter((s) => s.proofOfMotion).length,
  },
  tokenReferences: tokenRefs,
  keyframes: kf.map((k) => ({
    name: k.name,
    offsets: (k.offsets || []).map((o) => o.offset),
    properties: [...new Set((k.offsets || []).flatMap((o) => Object.keys(o.props || {})))],
    hasBody: (k.offsets || []).length > 0,
    confidence: k.confidence,
  })),
  animations: (M.animations || []).map((a) => ({
    selector: a.selector,
    keyframe: a.name,
    durationMs: a.durationMs,
    delayMs: a.delayMs,
    easing: a.easing,
    iterations: a.iterations,
    fill: a.fill,
    direction: a.direction,
  })),
  transitions: M.transitions || [],
  effects: effectTokens,
  effectsWhere: {
    backdropFilter: M.effects?.backdropFilterWhere || [],
    filter: M.effects?.filterWhere || [],
  },
  reveals: M.reveals || [],
  stagger: M.stagger || [],
  reducedMotion: { ruleCount: M.reducedMotion?.ruleCount || 0, respected: !!M.reducedMotion?.respected },
  canvas: M.canvas || { present: false },
  jsDriven: {
    waapiCallCount: M.jsDriven?.waapiCallCount || 0,
    intersectionObservers: (M.jsDriven?.intersectionObservers || []).length,
  },
  frameStrips: M.frameStrips || [],
  // the honest-gap register: anything the capture could not reach
  risks: M.risks || [],
  // a motion system that cannot be reproduced from CSS alone must say so
  reproducibility:
    M.canvas?.present || (M.jsDriven?.waapiCallCount || 0) > 0
      ? "partial — CSS covers the keyframes and effects below, but this source also drives motion outside CSS (see canvas / jsDriven). Those parts are documented, not reproduced."
      : "full — the observed motion is expressible in CSS",
};

// ── 7. motion.js — the reveal runner the builder drops in ─────────────────
const revealThreshold = (() => {
  const io = (M.jsDriven?.intersectionObservers || [])
    .map((o) => o.threshold)
    .flat()
    .filter((t) => typeof t === "number" && t > 0);
  if (io.length) return Math.min(...io);
  const measured = (M.reveals || []).map((r) => r.triggerRatio).filter((r) => typeof r === "number" && r > 0);
  return measured.length ? Number(Math.min(...measured).toFixed(2)) : 0.15;
})();
const motionJs = `/* motion.js — DERIVED by scripts/gen-motion.mjs from source/motion.json. Do not hand-edit.
 *
 * The reveal runner. Threshold and stagger step are MEASURED off the source
 * (${M.source?.url || "?"}), not guessed:
 *   threshold    = ${revealThreshold}   ${(M.jsDriven?.intersectionObservers || []).length ? "(from the site's own IntersectionObserver options)" : "(from the measured trigger ratio)"}
 *   staggerStep  = ${staggerStep ?? "null"}${staggerStep ? "ms" : " — no stagger observed; siblings reveal together"}
 *
 * Usage:  <link rel="stylesheet" href="motion.css">
 *         <script src="motion.js" defer></script>
 *         <div data-reveal>…</div>            one element
 *         <div data-reveal-group>…</div>      children reveal staggered
 */
(() => {
  "use strict";
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const THRESHOLD = ${revealThreshold};
  const STAGGER_STEP = ${staggerStep ?? 0};

  // Reduced motion is not "a slower reveal", it is NO reveal: show everything
  // and bind nothing. Anything else re-introduces the motion the user opted out of.
  if (REDUCED) {
    document.querySelectorAll("[data-reveal], [data-reveal-group] > *").forEach((el) => {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
    return;
  }

  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll("[data-reveal], [data-reveal-group] > *").forEach((el) => {
      el.classList.add("is-revealed");
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        const group = el.parentElement && el.parentElement.hasAttribute("data-reveal-group");
        if (group && STAGGER_STEP > 0) {
          const idx = Array.prototype.indexOf.call(el.parentElement.children, el);
          el.style.animationDelay = idx * STAGGER_STEP + "ms";
          el.style.transitionDelay = idx * STAGGER_STEP + "ms";
        }
        el.classList.add("is-revealed");
        io.unobserve(el); // reveal is one-shot; re-firing on scroll-back reads as a glitch
      }
    },
    { threshold: THRESHOLD }
  );

  const bind = () => {
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    document.querySelectorAll("[data-reveal-group]").forEach((g) => {
      Array.prototype.forEach.call(g.children, (c) => io.observe(c));
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
`;
writeFileSync(join(DIR, "motion.js"), motionJs);

// ── 8. preview/motion.html — the artifact motion never had ────────────────
mkdirSync(join(DIR, "preview"), { recursive: true });
const baseDur = durTokens.find((d) => d.name === "motion-base") || durTokens[0] || { value: "300ms" };
const baseEase = easeTokens[0]?.value || "ease";

// The preview must carry the @keyframes IN ITSELF. It cannot link motion.css —
// the contract is zero external requests — and without the bodies inlined every
// `animation-name` points at nothing, `getAnimations()` returns [] and the play
// button is dead. That was the first version's bug.
const kfCssBlock = kf
  .map((k) => {
    const body = (k.offsets || [])
      .map((o) => `    ${o.offset} { ${Object.entries(o.props || {}).map(([p, v]) => `${p}: ${v};`).join(" ")} }`)
      .join("\n");
    return `  @keyframes ${k.name} {\n${body}\n  }`;
  })
  .join("\n");

// A keyframe that animates a custom property (--angle on a conic border-beam)
// does nothing until that property is REGISTERED: an unregistered custom prop
// is a plain string and strings do not interpolate.
const customProps = [
  ...new Set(kf.flatMap((k) => (k.offsets || []).flatMap((o) => Object.keys(o.props || {}))).filter((p) => p.startsWith("--"))),
];
const propertyDecls = customProps
  .map(
    (p) => `  @property ${p} {
    syntax: "${/angle|rotate|deg/i.test(p) ? "<angle>" : "<length-percentage>"}";
    inherits: false;
    initial-value: ${/angle|rotate|deg/i.test(p) ? "0deg" : "0%"};
  }`
  )
  .join("\n");

const usesCustomProp = (k) =>
  (k.offsets || []).some((o) => Object.keys(o.props || {}).some((p) => p.startsWith("--")));
const usesBgPosition = (k) =>
  (k.offsets || []).some((o) => Object.keys(o.props || {}).some((p) => p.includes("background-position")));

// These are display fixtures, never additions to the captured keyframe body.
// In particular, missing offsets are left intact for the CSS engine to resolve.
const fixtures = kf.map((k) => {
  const properties = [...new Set((k.offsets || []).flatMap((o) => Object.keys(o.props || {})))];
  const values = (k.offsets || []).flatMap((o) => Object.values(o.props || {})).join(" ");
  const variables = {};
  for (const [name, value] of Object.entries({
    "--bar-h": "64px", "--cli-dot-color": "var(--hot)",
    "--lift": "1", "--offset": "0px", "--swipe-amount": "0px",
  })) if (values.includes(`var(${name}`)) variables[name] = value;
  const observed = (M.animations || []).find((a) => a.name === k.name && a.durationMs > 0);
  const classes = [
    usesCustomProp(k) && "conic", usesBgPosition(k) && "shimmer",
    properties.includes("background-color") && "color",
    properties.includes("height") && "height",
    properties.some((p) => ["top", "left", "right", "bottom"].includes(p)) && "positioned",
  ].filter(Boolean);
  return {
    name: k.name, classes, variables, confidence: "inferred",
    note: "Diagnostic surface and variable defaults; not the original component. Keyframe offsets remain observed and unchanged.",
    timing: observed ? {
      durationMs: observed.durationMs, delayMs: observed.delayMs || 0,
      easing: observed.easing, direction: observed.direction || "normal", confidence: "observed", selector: observed.selector,
    } : { durationMs: 800, delayMs: 0, easing: baseEase, direction: "normal", confidence: "inferred",
      note: "CSS definition captured without a running instance; demonstration timing only." },
  };
});
manifest.preview = {
  fixtures, customPropertyRegistration: { confidence: "inferred", properties: customProps },
  iterationCount: "infinite", fillMode: "both", confidence: "inferred",
  note: "Loop/fill overrides are for inspection. Original iteration/fill values remain in animations. No offsets synthesized.",
};

const inlineFrame = (file) => {
  const path = resolve(DIR, file), rel = relative(DIR, path);
  if (rel.startsWith("..") || isAbsolute(rel) || !/\.png$/i.test(path) || !existsSync(path)) return null;
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
};

const cards = kf
  .map((k, i) => {
    const props = [...new Set((k.offsets || []).flatMap((o) => Object.keys(o.props || {})))];
    const fixture = fixtures[i], timing = fixture.timing;
    const kind = fixture.classes.length ? " " + fixture.classes.join(" ") : "";
    const style = Object.entries({
      ...fixture.variables, "--sample-duration": timing.durationMs + "ms", "--sample-ease": timing.easing,
      "animation-name": k.name, "animation-delay": timing.delayMs + "ms", "animation-direction": timing.direction,
    }).map(([p, v]) => `${p}:${v}`).join(";");
    const strip = (M.frameStrips || []).find((s) => s.name === k.name);
    const frames = (strip?.frames || []).map(inlineFrame);
    const evidence = frames.length && frames.every(Boolean) ? `<details class="source-frames"><summary>Captured component · ${frames.length} source frames</summary><div>${frames.map((src, n) => `<figure><img src="${src}" alt="Captured ${esc(k.name)} at ${Math.round(n / (frames.length - 1) * 100)}%"><figcaption>${Math.round(n / (frames.length - 1) * 100)}%</figcaption></figure>`).join("")}</div></details>` : "";
    return `      <article class="card" data-i="${i}">
        <header>
          <code>@keyframes ${esc(k.name)}</code>
          <span class="props">${props.map((p) => `<em>${esc(p)}</em>`).join("")}</span>
          <span class="note">${timing.durationMs}ms · ${esc(timing.easing)} · timing ${timing.confidence}</span>
        </header>
        <div class="stage"><div class="demo${kind}" id="demo-${i}" style="${esc(style)}"></div></div>
        <div class="ctl">
          <button data-act="play" data-i="${i}">play</button>
          <button data-act="pause" data-i="${i}">pause</button>
          <input type="range" min="0" max="100" value="0" data-scrub="${i}" title="scrub">
          <span class="t" id="t-${i}">t=0%</span>
        </div>
        ${evidence}
        <details><summary>body (${(k.offsets || []).length} offsets)</summary><pre>${esc(
      (k.offsets || [])
        .map((o) => `${o.offset} { ${Object.entries(o.props || {}).map(([p, v]) => `${p}: ${v};`).join(" ")} }`)
        .join("\n")
    )}</pre></details>
      </article>`;
  })
  .join("\n");

const effectRows = effectTokens
  .map(
    (e) =>
      `        <tr><td><code>--${esc(e.name)}</code></td><td>${esc(e.prop)}</td><td><code>${esc(
        e.value
      )}</code></td><td>${e.hits}×</td></tr>`
  )
  .join("\n");

const previewHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Motion preview — ${esc(M.source?.url || "")}</title>
<!-- Self-contained by contract: zero external requests. Fonts are system stacks. -->
<style>
  /* the derived tokens, inlined so this file stands alone */
${durTokens.map((d) => `  :root { --${d.name}: ${d.value}; }`).join("\n")}
${easeTokens.map((e) => `  :root { --${e.name}: ${e.value}; }`).join("\n")}

  /* registered custom properties — an unregistered one is a string, and
     strings do not interpolate, so the animation would silently do nothing */
${propertyDecls}

  /* the captured @keyframes, inlined: the preview makes zero external requests,
     so the bodies must live here or every animation-name points at nothing */
${kfCssBlock}
  :root {
    --ink: #0e0e11; --paper: #fbfbfd; --line: #e3e3ea; --dim: #6b6b76; --hot: #111;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f2f2f5; --paper: #0d0d10; --line: #26262e; --dim: #9a9aa6; --hot: #fff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: var(--paper); color: var(--ink);
         font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .meta { color: var(--dim); font-size: 12px; margin-bottom: 20px; }
  .meta code { color: var(--ink); }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
         padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 22px; }
  .bar label { display: flex; gap: 6px; align-items: center; font-size: 12px; }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--paper) 92%, var(--ink)); }
  .card header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
  .card code { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; }
  .props em { font-style: normal; font-size: 10px; color: var(--dim); border: 1px solid var(--line);
              border-radius: 4px; padding: 1px 5px; margin-right: 4px; }
  .stage { height: 96px; display: grid; place-items: center; border-radius: 8px; position: relative; overflow: hidden;
           background: repeating-linear-gradient(45deg, transparent 0 8px, color-mix(in srgb, var(--ink) 4%, transparent) 8px 16px); }
  /* A flat solid swatch cannot show a background-position or a conic sweep —
     the animation runs and looks frozen. Each swatch kind gets a surface that
     makes its own animated property visible. */
  .demo { width: 48px; height: 48px; border-radius: 10px;
          background: linear-gradient(135deg, var(--hot) 0%, color-mix(in srgb, var(--hot) 30%, transparent) 50%, var(--hot) 100%);
          background-size: 300% 300%; background-position: 0% 0%;
          animation-duration: var(--demo-dur, var(--sample-duration)); animation-timing-function: var(--demo-ease, var(--sample-ease));
          animation-iteration-count: infinite; animation-fill-mode: both; }
  .demo.shimmer { width: 140px; height: 28px;
                  background: linear-gradient(100deg,
                    color-mix(in srgb, var(--hot) 12%, transparent) 20%,
                    var(--hot) 45%,
                    color-mix(in srgb, var(--hot) 12%, transparent) 70%);
                  /* A non-commensurate tile avoids identical 0/50% frames when
                     the captured sweep is 150% to -150% with linear timing. */
                  background-size: 275% 100%; }
  .demo.conic { width: 64px; height: 64px; background: conic-gradient(from var(--angle, 0deg),
                  transparent 0turn, var(--hot) 0.25turn, transparent 0.5turn, transparent 1turn); }
  .demo.color { background-image: none; background-color: var(--hot); }
  .demo.height { width: 12px; border-radius: 4px; }
  .demo.positioned { position: absolute; width: 16px; height: 20px; border-radius: 0;
    clip-path: polygon(0 0, 100% 70%, 54% 70%, 36% 100%); }
  .source-frames > div { display: flex; gap: 8px; overflow: auto; }
  .source-frames figure { margin: 4px 0; flex: 0 0 150px; }
  .source-frames img { width: 100%; height: 120px; object-fit: contain; }
  .source-frames figcaption { font-size: 10px; color: var(--dim); }
  .ctl { display: flex; gap: 6px; align-items: center; margin-top: 10px; }
  .ctl button { font: 11px ui-monospace, Menlo, monospace; padding: 3px 8px; cursor: pointer;
                border: 1px solid var(--line); border-radius: 5px; background: transparent; color: var(--ink); }
  .ctl input[type=range] { flex: 1; min-width: 60px; }
  .ctl .t { font: 10px ui-monospace, Menlo, monospace; color: var(--dim); min-width: 48px; }
  details { margin-top: 8px; }
  summary { font-size: 11px; color: var(--dim); cursor: pointer; }
  pre { font: 11px/1.5 ui-monospace, Menlo, monospace; background: color-mix(in srgb, var(--ink) 6%, transparent);
        padding: 8px; border-radius: 6px; overflow: auto; margin: 6px 0 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  section { margin-top: 32px; }
  h2 { font-size: 14px; margin: 0 0 4px; }
  .note { font-size: 12px; color: var(--dim); }
  .risk { border-left: 2px solid #d4a017; padding-left: 10px; margin: 6px 0; font-size: 12px; color: var(--dim); }
  body.rm .demo { animation: none !important; }
</style>
</head>
<body>
  <h1>Motion preview</h1>
  <p class="meta">
    source <code>${esc(M.source?.url || "?")}</code> · captured <code>${esc(M.source?.capturedAt || "?")}</code>
    · mode <code>${esc(M.source?.captureMode || "?")}</code><br>
    ${kf.length} keyframes with bodies · ${durTokens.length} durations · ${easeTokens.length} easings
    · ${effectTokens.length} effect tokens · ${(M.frameStrips || []).length} frame-strips
  </p>
  <p class="note">Isolated CSS diagnostics. Timing is observed where a running instance was captured; otherwise it is marked inferred.
    The surface, variable defaults and repeated playback are demonstration fixtures. Captured component frames are included where available.
    These swatches do not reproduce the source's full components or JavaScript choreography.</p>

  <div class="bar">
    <label><input type="checkbox" id="rm"> simulate <code>prefers-reduced-motion</code></label>
    <label><input type="checkbox" id="override"> override captured timing</label>
    <label>duration <input disabled type="range" id="dur" min="60" max="4000" step="20" value="${Math.max(
      60,
      Math.min(2000, msOf(baseDur.value) || 300)
    )}"> <span id="durv" class="t"></span></label>
    <label>easing
      <select disabled id="ease">
${easeTokens.map((e) => `        <option value="${esc(e.value)}">--${esc(e.name)}${e.spring ? " (spring)" : ""}</option>`).join("\n")}
        <option value="linear">linear</option>
      </select>
    </label>
  </div>

  <div class="grid">
${cards}
  </div>

${
  effectTokens.length
    ? `  <section>
    <h2>Surface effects</h2>
    <p class="note">Observed values, with the element they were read from in <code>motion.manifest.json</code> › <code>effectsWhere</code>. No placeholders.</p>
    <table>
      <thead><tr><th>token</th><th>property</th><th>value</th><th>hits</th></tr></thead>
      <tbody>
${effectRows}
      </tbody>
    </table>
  </section>`
    : ""
}

  <section>
    <h2>Reproducibility</h2>
    <p class="note">${esc(manifest.reproducibility)}</p>
${
  M.canvas?.present
    ? `    <p class="note">canvas: ${M.canvas.count} element(s), context ${esc(
        (M.canvas.contexts || []).join(", ") || "unknown"
      )}. Pixel-level motion inside a canvas is not CSS and is not reproduced here.</p>`
    : `    <p class="note">No canvas on the source page.</p>`
}
${
  (M.jsDriven?.waapiCallCount || 0) > 0
    ? `    <p class="note">${M.jsDriven.waapiCallCount} <code>Element.animate()</code> calls were intercepted — this source drives motion from JS. Sample lives in <code>source/motion.json</code> › <code>jsDriven</code>.</p>`
    : ""
}
  </section>

${
  (M.risks || []).length
    ? `  <section>
    <h2>Honest gaps</h2>
${(M.risks || []).map((r) => `    <p class="risk">${esc(r)}</p>`).join("\n")}
  </section>`
    : ""
}

<script>
  const $ = (s) => document.querySelector(s);
  const demos = Array.from(document.querySelectorAll(".demo"));

  const setDur = (ms) => {
    if ($("#override").checked) document.documentElement.style.setProperty("--demo-dur", ms + "ms");
    $("#durv").textContent = ms + "ms";
  };
  setDur(Number($("#dur").value));
  $("#dur").addEventListener("input", (e) => setDur(Number(e.target.value)));
  $("#ease").addEventListener("change", (e) =>
    document.documentElement.style.setProperty("--demo-ease", e.target.value)
  );
  $("#override").addEventListener("change", (e) => {
    $("#dur").disabled = $("#ease").disabled = !e.target.checked;
    if (e.target.checked) {
      setDur(Number($("#dur").value));
      document.documentElement.style.setProperty("--demo-ease", $("#ease").value);
    } else {
      document.documentElement.style.removeProperty("--demo-dur");
      document.documentElement.style.removeProperty("--demo-ease");
    }
  });
  $("#rm").addEventListener("change", (e) => document.body.classList.toggle("rm", e.target.checked));

  // Scrub uses the same mechanism the capture used: pin animation.currentTime.
  // Same trick on both ends means what you scrub here is what was measured there.
  document.querySelectorAll("[data-scrub]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const i = slider.getAttribute("data-scrub");
      const el = document.getElementById("demo-" + i);
      const t = Number(slider.value) / 100;
      el.getAnimations().forEach((a) => {
        a.pause();
        const d = a.effect && a.effect.getTiming ? a.effect.getTiming().duration : null;
        if (typeof d === "number" && d > 0) a.currentTime = a.effect.getTiming().delay + d * t;
      });
      document.getElementById("t-" + i).textContent = "t=" + slider.value + "%";
    });
  });
  document.querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const el = document.getElementById("demo-" + b.getAttribute("data-i"));
      el.getAnimations().forEach((a) => (b.getAttribute("data-act") === "play" ? a.play() : a.pause()));
    });
  });
</script>
</body>
</html>
`;
writeFileSync(join(DIR, "preview", "motion.html"), previewHtml);
writeFileSync(join(DIR, "motion.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ── summary ───────────────────────────────────────────────────────────────
log("motion.css            ", `${kf.length} keyframes with bodies, ${durTokens.length + easeTokens.length + delayTokens.length + effectTokens.length} tokens`);
log("motion.manifest.json  ", `${manifest.tokenReferences.length} tokenReferences, reproducibility: ${manifest.reproducibility.split(" —")[0]}`);
log("motion.js             ", `threshold ${revealThreshold}, stagger ${staggerStep ?? "none"}`);
log("preview/motion.html   ", "self-contained, scrubbable");
if ((M.risks || []).length) log(`carried ${M.risks.length} honest gap(s) into the manifest and the preview`);
