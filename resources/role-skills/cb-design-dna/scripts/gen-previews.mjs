#!/usr/bin/env node
/*
 * gen-previews.mjs — DETERMINISTIC, brand-agnostic preview dashboard.
 *
 * Usage:  node gen-previews.mjs <outdir>
 *
 * Promotes the generator proven on the Stripe run into a generic one: emits
 *   preview/colors.html · preview/typography.html · preview/spacing.html
 *   preview/index.html   (the aggregate dashboard, §6 of SKILL.md)
 *
 * Every page is SELF-CONTAINED (inlines :root + @font-face from tokens.css,
 * zero external requests) and AUTO-THEMED: chrome derives from the run's own
 * --bg/--fg/--accent, so a Linear run yields a Linear dashboard and a Stripe
 * run a Stripe one with zero code change. Nothing brand-specific is hardcoded —
 * every value shown is read from tokens.css / design-tokens.json.
 *
 * Zero deps — pure Node.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(process.cwd(), process.argv[2] || ".");
const TOKENS = join(OUT, "tokens.css");
const DT = join(OUT, "design-tokens.json");
if (!existsSync(TOKENS) || !existsSync(DT)) { console.error("error: tokens.css / design-tokens.json missing — run gen-tokens.mjs first"); process.exit(2); }
mkdirSync(join(OUT, "preview"), { recursive: true });
const css = readFileSync(TOKENS, "utf8");
const dt = JSON.parse(readFileSync(DT, "utf8"));
const log = (...a) => console.log("[gen-previews]", ...a);

// lift :root + @font-face (paths fixed for preview/ subdir → ../fonts)
const rootStart = css.indexOf(":root");
const rootBlock = css.slice(rootStart, css.indexOf("}", rootStart) + 1);
const fontFace = (css.slice(0, rootStart).match(/@font-face[\s\S]*?\}/g) || [])
  .join("\n").replace(/url\("\.\/fonts\//g, 'url("../fonts/').replace(/url\('\.\/fonts\//g, "url('../fonts/");

const brand = (dt.$description || "Brand").replace(/\s+design DNA.*$/, "").trim();
const url = dt.$source || "";
const date = dt.$capturedAt || "";

// ── collect token leaves (design-tokens.json grouped by LAYER) ──────────────
const leaves = [];
(function walk(n) { if (!n || typeof n !== "object") return; if ("$value" in n) return; for (const k of Object.keys(n)) { if (k.startsWith("$")) continue; const v = n[k]; if (v && typeof v === "object" && "$value" in v) leaves.push({ name: k, ...v }); else walk(v); } })(dt);
const byGroup = (g) => leaves.filter((l) => l.group === g);
const has = (name) => leaves.some((l) => l.name === name);
const v = (name, fb) => has(name) ? `var(--${name})` : (fb || "transparent");

const nObs = leaves.filter((l) => l.confidence === "observed").length;
const nInf = leaves.filter((l) => l.confidence === "inferred").length;

// theme luminance (decide chrome accents that need a literal — most use var())
const bgHex = (css.match(/--bg:\s*(#[0-9a-f]{3,8})/i) || [])[1] || "#ffffff";

const confTag = (c) => c === "observed"
  ? '<span class="tag obs">observed</span>'
  : c === "provided" ? '<span class="tag prov">provided</span>' : '<span class="tag inf">inferred</span>';

const head = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title>
<style>
${fontFace}
${rootBlock}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body);font-size:var(--text-base);line-height:var(--leading-normal);padding:var(--space-8)}
h1{font-family:var(--font-display);font-weight:var(--weight-light);letter-spacing:var(--tracking-tight);font-size:var(--text-4xl);margin:0 0 var(--space-2)}
h2{font-family:var(--font-display);font-weight:var(--weight-light);font-size:var(--text-2xl);margin:var(--space-12) 0 var(--space-4)}
.sub{color:var(--fg-muted);margin:0 0 var(--space-8)}
.mono{font-family:var(--font-mono);font-size:var(--text-sm)}
.tag{font-size:var(--text-xs);padding:2px 8px;border-radius:var(--radius-full);font-family:var(--font-mono)}
.obs{background:var(--accent-soft);color:var(--accent)}
.inf{background:color-mix(in srgb,var(--danger) 16%,var(--bg));color:var(--danger)}
.prov{background:color-mix(in srgb,var(--success) 16%,var(--bg));color:var(--success)}
a.back{color:var(--accent);text-decoration:none;font-size:var(--text-sm)}
</style></head><body>`;
const foot = `<p style="margin-top:var(--space-12)"><a class="back" href="./index.html">← Dashboard</a></p></body></html>`;

// ════ colors.html ════
const colorTokens = byGroup("color").filter((l) => /^#|rgb|hsl/.test(String(l.$value)));
const swatches = colorTokens.map((l) => `
<div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden">
  <div style="height:84px;background:var(${l.var})"></div>
  <div style="padding:var(--space-3)">
    <div style="font-weight:var(--weight-medium)">${l.name} ${confTag(l.confidence)}</div>
    <div class="mono" style="color:var(--fg-muted)">${l.var}</div>
    <div class="mono">${l.$value}</div>
  </div></div>`).join("");
const gradTokens = byGroup("gradient");
const gradHtml = gradTokens.length
  ? `<h2>Gradients</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-4)">${gradTokens.map((l) => `<div style="height:120px;border-radius:var(--radius-md);background:var(${l.var})"></div>`).join("")}</div>`
  : "";
writeFileSync(join(OUT, "preview/colors.html"), head(`${brand} DNA — Colors`) +
  `<h1>Colors</h1><p class="sub">Every color token in tokens.css, with confidence. Source: ${url} (${date}).</p>
   <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-4)">${swatches}</div>${gradHtml}` + foot);

// ════ typography.html ════
const ramp = [["text-5xl", "Hero"], ["text-4xl", "H1"], ["text-3xl", "H2"], ["text-2xl", "H3"], ["text-xl", "Subhead"], ["text-lg", "Large body"], ["text-base", "Body"], ["text-sm", "Small / button"], ["text-xs", "Caption"]];
const specimens = ramp.filter(([t]) => has(t)).map(([t, label]) => {
  const l = leaves.find((x) => x.name === t);
  return `<div style="border-bottom:1px solid var(--border);padding:var(--space-4) 0">
    <div class="mono" style="color:var(--fg-muted)">--${t} · ${l.$value} ${confTag(l.confidence)}</div>
    <div style="font-family:var(--font-display);font-size:var(${l.var});font-weight:var(--weight-light);letter-spacing:var(--tracking-tight);line-height:var(--leading-tight)">${label} — ${brand}</div>
  </div>`;
}).join("");
const wtRows = ["weight-light", "weight-regular", "weight-medium", "weight-bold"].filter(has).map((w) => {
  const l = leaves.find((x) => x.name === w);
  return `<p style="font-family:var(--font-display);font-weight:var(${l.var});font-size:var(--text-2xl);margin:var(--space-2) 0">${l.$value} — ${w.replace("weight-", "")} ${confTag(l.confidence)}</p>`;
}).join("");
writeFileSync(join(OUT, "preview/typography.html"), head(`${brand} DNA — Typography`) +
  `<h1>Typography</h1><p class="sub">Display + body families with the observed size ramp, weights and tracking. Source: ${url}.</p>
   ${specimens}<h2>Weights</h2>${wtRows}
   <h2>Mono</h2><p class="mono" style="font-size:var(--text-base)">const dna = extract("${brand}"); // ${has("font-mono") ? leaves.find((x) => x.name === "font-mono").$value.split(",")[0] : "mono"}</p>` + foot);

// ════ spacing.html ════
const spaceTokens = byGroup("space");
const bars = spaceTokens.map((l) => `<div style="display:flex;align-items:center;gap:var(--space-4);margin:var(--space-2) 0">
  <span class="mono" style="width:120px;color:var(--fg-muted)">--${l.name} ${confTag(l.confidence)}</span>
  <span style="height:16px;width:var(${l.var});background:var(--accent);border-radius:2px"></span>
  <span class="mono">${l.$value}</span></div>`).join("");
const radTokens = byGroup("radius");
const radBars = radTokens.map((l) => `<div style="text-align:center">
  <div style="width:80px;height:80px;background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(${l.var});margin:auto"></div>
  <div class="mono" style="margin-top:var(--space-2)">--${l.name}<br>${l.$value}</div></div>`).join("");
const shTokens = byGroup("shadow");
const shBars = shTokens.map((l) => `<div style="text-align:center">
  <div style="width:120px;height:80px;background:var(--surface);border-radius:var(--radius-md);box-shadow:var(${l.var});margin:auto"></div>
  <div class="mono" style="margin-top:var(--space-3)">--${l.name} ${confTag(l.confidence)}</div></div>`).join("");
const moTokens = byGroup("motion");
const moRows = moTokens.map((l) => `<tr><td class="mono">--${l.name}</td><td class="mono">${l.$value}</td><td>${confTag(l.confidence)}</td></tr>`).join("");
writeFileSync(join(OUT, "preview/spacing.html"), head(`${brand} DNA — Spacing, Radius, Shadow, Motion`) +
  `<h1>Spacing &amp; system</h1><p class="sub">Spacing scale, radii, shadows and motion — observed where the live site exposed them.</p>
   <h2>Spacing scale</h2>${bars}
   <h2>Radius</h2><div style="display:flex;gap:var(--space-6);flex-wrap:wrap">${radBars}</div>
   <h2>Shadows</h2><div style="display:flex;gap:var(--space-8);flex-wrap:wrap;padding:var(--space-4)">${shBars}</div>
   <h2>Motion</h2><table style="border-collapse:collapse" class="mono"><tr style="text-align:left"><th>token</th><th>value</th><th>conf</th></tr>${moRows}</table>` + foot);

// ════ index.html — aggregate dashboard ════
const compHtml = existsSync(join(OUT, "components.html")) ? readFileSync(join(OUT, "components.html"), "utf8") : "";
const compBody = compHtml ? compHtml.slice(compHtml.indexOf("<body>") + 6, compHtml.indexOf("</body>")) : "";
const compStyle = compHtml ? compHtml.slice(compHtml.indexOf("<style>") + 7, compHtml.indexOf("</style>")) : "";
// the lifted compStyle already contains :root + @font-face — strip its @font-face dup path (./fonts not ../fonts in index, which lives in preview/)
const compStyleFixed = compStyle.replace(/url\("\.\/fonts\//g, 'url("../fonts/');

const colorMini = colorTokens.slice(0, 18).map((l) => `<div style="text-align:center"><div style="height:48px;border-radius:var(--radius-sm);background:var(${l.var});border:1px solid var(--border)"></div><div class="mono" style="font-size:10px;margin-top:4px">${l.name}</div></div>`).join("");
const summary = (dt.$description || "").replace(/\s+design DNA.*$/, "") + " — captured live.";

const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>${brand} DNA — Dashboard</title>
<style>
${compStyleFixed || fontFace + "\n" + rootBlock}
.wrap{max-width:var(--container-wide);margin:auto}
.topnav{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:saturate(140%) blur(8px);border-bottom:1px solid var(--border);padding:var(--space-3) var(--space-6);display:flex;gap:var(--space-5);align-items:center;flex-wrap:wrap}
.topnav a{color:var(--fg-muted);text-decoration:none;font-size:var(--text-sm)}
.topnav a:hover{color:var(--accent)}
.section{padding:var(--space-12) var(--space-6);border-bottom:1px solid var(--border)}
.kpi{display:inline-flex;gap:var(--space-2);align-items:center;background:var(--surface-muted);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--space-1) var(--space-3);font-size:var(--text-sm);font-family:var(--font-mono);margin-right:var(--space-2)}
.passpill{background:var(--accent-soft);color:var(--accent)}
.mini-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:var(--space-3)}
.foot-links{display:flex;flex-wrap:wrap;gap:var(--space-4)}
.foot-links a{color:var(--accent);text-decoration:none;font-size:var(--text-sm)}
</style></head><body style="padding:0">
<nav class="topnav">
  <strong style="font-family:var(--font-display);font-weight:var(--weight-medium)">▍${brand} DNA</strong>
  <a href="#colors">Colors</a><a href="#type">Type</a><a href="#space">Spacing &amp; motion</a><a href="#components">Components</a><a href="#artifacts">Artifacts</a>
</nav>
<div class="wrap">
  <header class="section">
    <h1 style="font-family:var(--font-display);font-weight:var(--weight-light);letter-spacing:var(--tracking-tight);font-size:var(--text-4xl);margin:0">${brand} — Design DNA</h1>
    <p style="color:var(--fg-muted);max-width:60ch">${summary} Captured LIVE from <a href="${url}" style="color:var(--accent)">${url}</a> on ${date}.</p>
    <div class="row">
      <span class="kpi">${nObs} observed</span>
      <span class="kpi">${nInf} inferred</span>
      <span class="kpi passpill">P0 gate: run lint-artifact.mjs</span>
    </div>
  </header>

  <section class="section" id="colors">
    <h2 style="font-family:var(--font-display);font-weight:var(--weight-light);font-size:var(--text-2xl)">Colors</h2>
    <div class="mini-grid">${colorMini}</div>
    <p style="margin-top:var(--space-4)"><a class="back" style="color:var(--accent);text-decoration:none" href="./colors.html">Full color preview →</a></p>
  </section>

  <section class="section" id="type">
    <h2 style="font-family:var(--font-display);font-weight:var(--weight-light);font-size:var(--text-2xl)">Typography</h2>
    <div style="font-family:var(--font-display);font-weight:var(--weight-light);letter-spacing:var(--tracking-tight);font-size:var(--text-5xl);line-height:var(--leading-tight)">${brand}</div>
    <p style="font-size:var(--text-base)">Body copy at base size / normal leading. <span class="mono">code in mono</span></p>
    <p><a class="back" style="color:var(--accent);text-decoration:none" href="./typography.html">Full type preview →</a></p>
  </section>

  <section class="section" id="space">
    <h2 style="font-family:var(--font-display);font-weight:var(--weight-light);font-size:var(--text-2xl)">Spacing &amp; motion</h2>
    <div class="row">
      ${["space-2", "space-4", "space-6", "space-8", "space-12"].filter(has).map((s) => `<div style="height:16px;width:var(--${s});background:var(--accent)"></div>`).join("")}
    </div>
    <div class="row">
      ${["radius-sm", "radius-md"].filter(has).map((r) => `<div style="width:64px;height:64px;background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--${r})"></div>`).join("")}
      ${["shadow-lg", "shadow-xl"].filter(has).map((s) => `<div style="width:64px;height:64px;background:var(--surface);border-radius:var(--radius-md);box-shadow:var(--${s})"></div>`).join("")}
    </div>
    <p class="mono" style="color:var(--fg-muted)">motion ${moTokens.map((l) => "--" + l.name + " " + l.$value).join(" · ")}</p>
    <p><a class="back" style="color:var(--accent);text-decoration:none" href="./spacing.html">Full spacing preview →</a></p>
  </section>

  <section class="section" id="components">
    <h2 style="font-family:var(--font-display);font-weight:var(--weight-light);font-size:var(--text-2xl)">Components &amp; states</h2>
    ${compBody}
  </section>

  <footer class="section" id="artifacts">
    <h2 style="font-family:var(--font-display);font-weight:var(--weight-light);font-size:var(--text-2xl)">Artifacts</h2>
    <div class="foot-links">
      <a href="../DESIGN.md">DESIGN.md</a><a href="../design-contract.md">design-contract.md</a>
      <a href="../implementation-handoff.md">implementation-handoff.md</a><a href="../tokens.css">tokens.css</a>
      <a href="../design-tokens.json">design-tokens.json</a><a href="../tailwind-v4.css">tailwind-v4.css</a>
      <a href="../components.html">components.html</a><a href="../components.manifest.json">components.manifest.json</a>
      <a href="./colors.html">colors</a><a href="./typography.html">typography</a><a href="./spacing.html">spacing</a>
      <a href="../screenshots/">screenshots/</a>
    </div>
  </footer>
</div>
</body></html>`;
writeFileSync(join(OUT, "preview/index.html"), index);

log(`previews generated · ${colorTokens.length} colors · ${nObs} observed / ${nInf} inferred · brand "${brand}"`);
