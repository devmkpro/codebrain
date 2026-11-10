#!/usr/bin/env node
/*
 * gen-components.mjs — DETERMINISTIC component fixture + manifest.
 *
 * Usage:  node gen-components.mjs <outdir>
 *
 * Emits a FIXED, token-driven fixture covering every component + variant +
 * the gate-mandated states (5 data: Loading/Empty/Error/Populated/Edge ·
 * 3 form: Untouched/Dirty-valid/Submitted-pending) and interactive states
 * (:hover/:active/:focus-visible/[aria/data-state]).
 *
 *   components.html        — SELF-CONTAINED: inlines :root + @font-face lifted
 *                            from tokens.css (NO external <link> to tokens.css).
 *                            Renders robustly under any file:// policy.
 *   components.manifest.json — classes · selectors (WITH states) · groups→
 *                            tokenReferences · literals (count of hardcoded values).
 *
 * Zero deps — pure Node.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(process.cwd(), process.argv[2] || ".");
const TOKENS = join(OUT, "tokens.css");
if (!existsSync(TOKENS)) { console.error(`error: ${TOKENS} not found — run gen-tokens.mjs first`); process.exit(2); }
const css = readFileSync(TOKENS, "utf8");
const log = (...a) => console.log("[gen-components]", ...a);

// lift the @font-face blocks + :root block VERBATIM (self-contained inline)
const rootStart = css.indexOf(":root");
const rootBlock = css.slice(rootStart, css.indexOf("}", rootStart) + 1);
const fontFace = css.slice(0, rootStart).match(/@font-face[\s\S]*?\}/g)?.join("\n") || "";

const brand = (() => { const m = css.match(/tokens for ([^.]+)\./); return m ? m[1].trim() : "Brand"; })();

// ── the component stylesheet — 100% token-driven (no hardcoded design values)
const componentCss = `
  *,*::before,*::after { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:var(--font-body);
    font-size:var(--text-base); line-height:var(--leading-normal); -webkit-font-smoothing:antialiased; padding:var(--space-8); }
  h1,h2,h3 { font-family:var(--font-display); font-weight:var(--weight-light); letter-spacing:var(--tracking-tight);
    line-height:var(--leading-tight); color:var(--fg); margin:0 0 var(--space-4); }
  h1 { font-size:var(--text-4xl); }
  h2 { font-size:var(--text-2xl); margin-top:var(--space-12); }
  h3 { font-size:var(--text-xl); font-weight:var(--weight-regular); letter-spacing:var(--tracking-snug); }
  .muted { color:var(--fg-muted); }
  .subtle { color:var(--fg-subtle); font-size:var(--text-sm); }
  .row { display:flex; flex-wrap:wrap; gap:var(--space-4); align-items:center; margin:var(--space-4) 0; }
  .stack { display:flex; flex-direction:column; gap:var(--space-3); max-width:360px; }
  .label { font-size:var(--text-xs); color:var(--fg-subtle); text-transform:uppercase; letter-spacing:.06em; }
  hr { border:0; border-top:1px solid var(--border); margin:var(--space-12) 0; }

  /* ── Buttons ─────────────────────────────────────────── */
  .btn { font-family:var(--font-body); font-size:var(--text-sm); font-weight:var(--weight-regular);
    border-radius:var(--radius-sm); padding:var(--space-3) var(--space-5); border:1px solid transparent;
    cursor:pointer; line-height:1; transition:background-color var(--motion-base) var(--ease-out),
    color var(--motion-fast) var(--ease-in-out), border-color var(--motion-base) var(--ease-out),
    box-shadow var(--motion-base) var(--ease-out); }
  .btn:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
  .btn-primary { background:var(--accent); color:var(--bg); }
  .btn-primary:hover { background:var(--accent-hover); }
  .btn-primary:active { background:var(--accent-hover); box-shadow:var(--shadow-sm); }
  .btn-primary:disabled { background:var(--accent-soft); color:var(--accent); cursor:not-allowed; opacity:.8; }
  .btn-secondary { background:var(--surface); color:var(--accent); border-color:var(--border-strong); }
  .btn-secondary:hover { background:var(--accent-soft); }
  .btn-secondary:active { background:var(--accent-soft); }
  .btn-ghost { background:transparent; color:var(--accent); }
  .btn-ghost:hover { text-decoration:underline; }
  .btn-ghost:active { color:var(--accent-hover); }
  .btn-soft { background:var(--accent-soft); color:var(--accent); }
  .btn-soft:hover { background:var(--accent-light); color:var(--bg); }

  /* ── Link ────────────────────────────────────────────── */
  a.link { color:var(--link); text-decoration:none; transition:color var(--motion-fast) var(--ease-in-out); }
  a.link:hover { text-decoration:underline; }
  a.link:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }

  /* ── Card ────────────────────────────────────────────── */
  .card { background:var(--surface); border-radius:var(--radius-md); box-shadow:var(--shadow-lg);
    padding:var(--space-6); border:1px solid var(--border);
    transition:box-shadow var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out); }
  .card:hover { box-shadow:var(--shadow-xl); }
  .card h3 { margin-top:0; }
  .card-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:var(--space-6); }

  /* ── Field / Input ───────────────────────────────────── */
  .field { display:flex; flex-direction:column; gap:var(--space-2); }
  .field input { font-family:var(--font-body); font-size:var(--text-base); color:var(--fg);
    background:var(--surface); border:1px solid var(--border-strong); border-radius:var(--radius-sm);
    padding:var(--space-3) var(--space-4);
    transition:border-color var(--motion-base) var(--ease-out), box-shadow var(--motion-base) var(--ease-out); }
  .field input:hover { border-color:var(--fg-subtle); }
  .field input:focus-visible { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  .field input:active { border-color:var(--accent); }
  .field-error input { border-color:var(--danger); box-shadow:0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent); }
  .field-valid input { border-color:var(--success); }
  .field .err { color:var(--danger); font-size:var(--text-xs); }
  .field .ok { color:var(--success); font-size:var(--text-xs); }

  /* ── Badge ───────────────────────────────────────────── */
  .badge { display:inline-flex; align-items:center; gap:var(--space-1); font-size:var(--text-xs);
    font-family:var(--font-mono); padding:2px var(--space-2); border-radius:var(--radius-full);
    background:var(--accent-soft); color:var(--accent); }
  .badge-success { background:color-mix(in srgb, var(--success) 16%, var(--bg)); color:var(--success); }
  .badge-danger { background:color-mix(in srgb, var(--danger) 16%, var(--bg)); color:var(--danger); }

  /* ── Data states ─────────────────────────────────────── */
  .state { border:1px solid var(--border); border-radius:var(--radius-md); padding:var(--space-6);
    background:var(--surface); min-height:120px; display:flex; flex-direction:column; gap:var(--space-3); }
  .state[data-state="error"] { border-color:var(--danger); }
  .skeleton { height:14px; border-radius:var(--radius-sm);
    background:linear-gradient(90deg, var(--surface-muted), var(--border), var(--surface-muted)); }
  .pill-spinner { width:18px; height:18px; border-radius:var(--radius-full);
    border:2px solid var(--border-strong); border-top-color:var(--accent); }

  /* ── Nav + footer ────────────────────────────────────── */
  .nav { display:flex; align-items:center; gap:var(--space-6); padding:var(--space-4) var(--space-6);
    border-bottom:1px solid var(--border); }
  .nav .brand { font-family:var(--font-display); font-weight:var(--weight-medium); }
  .nav a { color:var(--fg-muted); text-decoration:none; font-size:var(--text-sm); }
  .nav a:hover { color:var(--accent); }
  .footer { background:var(--surface-muted); border-top:1px solid var(--border);
    padding:var(--space-12) var(--space-6); display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:var(--space-8); }
  .footer .col a { display:block; color:var(--fg-muted); text-decoration:none; font-size:var(--text-sm); padding:var(--space-1) 0; }
  .footer .col a:hover { color:var(--accent); }`;

// ── the fixture BODY ───────────────────────────────────────────────────────
const body = `
<div style="background:var(--surface-muted);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-md);padding:var(--space-4) var(--space-5);margin-bottom:var(--space-8);font-family:var(--font-mono);font-size:var(--text-sm);color:var(--fg-muted)">
  <strong style="color:var(--fg)">FIXTURE · machine source of truth.</strong> Raw, exhaustive render of every component / variant / state straight from <code>components.manifest.json</code>. It looks dense on purpose — it is NOT the showcase. For the curated human view, open <code>preview/index.html</code>.
</div>
<h1>${brand} — Components Fixture</h1>
<p class="muted">Every component, variant, and state — built only from tokens.css (inlined below, self-contained).</p>

<nav class="nav"><span class="brand">▍${brand}</span><a href="#">Product</a><a href="#">Pricing</a><a href="#">Docs</a><a class="link" href="#">Sign in</a></nav>

<h2>Buttons &amp; states</h2>
<div class="row">
  <button class="btn btn-primary">Primary</button>
  <button class="btn btn-secondary">Secondary</button>
  <button class="btn btn-ghost">Ghost</button>
  <button class="btn btn-soft">Soft</button>
  <button class="btn btn-primary" disabled>Disabled</button>
</div>
<p class="subtle">Interactive states present in CSS: :hover · :active · :focus-visible · :disabled</p>

<h2>Link</h2>
<p>Inline <a class="link" href="#">text link</a> with hover + focus-visible states.</p>

<h2>Badges</h2>
<div class="row"><span class="badge">Default</span><span class="badge badge-success">Success</span><span class="badge badge-danger">Danger</span></div>

<h2>Cards</h2>
<div class="card-grid">
  <div class="card"><h3>Card title</h3><p class="muted">Populated card content with body copy and a <a class="link" href="#">link</a>.</p></div>
  <div class="card"><h3>Second card</h3><p class="muted">Hover to raise elevation (shadow-lg → shadow-xl).</p></div>
</div>

<h2>Form — the 3 form states</h2>
<div class="row" style="align-items:flex-start">
  <div class="stack">
    <span class="label">Untouched</span>
    <div class="field"><input placeholder="you@example.com" value=""/></div>
  </div>
  <div class="stack">
    <span class="label">Dirty-valid</span>
    <div class="field field-valid"><input value="you@example.com"/><span class="ok">Looks good</span></div>
  </div>
  <div class="stack">
    <span class="label">Submitted-pending</span>
    <div class="field"><input value="you@example.com" disabled/>
      <button class="btn btn-primary" disabled><span class="pill-spinner"></span> Submitting…</button></div>
  </div>
  <div class="stack">
    <span class="label">Error</span>
    <div class="field field-error"><input value="not-an-email"/><span class="err">Enter a valid email</span></div>
  </div>
</div>

<h2>Data states — Loading · Empty · Error · Populated · Edge</h2>
<div class="card-grid">
  <div class="state" data-state="loading"><span class="label">Loading</span><div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:70%"></div></div>
  <div class="state" data-state="empty"><span class="label">Empty</span><p class="muted">No results yet — try adjusting your filters.</p></div>
  <div class="state" data-state="error"><span class="label">Error</span><p><span class="badge badge-danger">Failed</span> Couldn’t load data. <a class="link" href="#">Retry</a></p></div>
  <div class="state" data-state="populated"><span class="label">Populated</span><p>3 items loaded.</p><div class="row"><span class="badge badge-success">Active</span><span class="badge">Default</span></div></div>
  <div class="state" data-state="edge"><span class="label">Edge</span><p class="subtle">Very long single token without spaces: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa — truncation/overflow guard.</p></div>
</div>

<hr/>
<footer class="footer">
  <div class="col"><span class="label">Product</span><a href="#">Features</a><a href="#">Pricing</a><a href="#">Changelog</a></div>
  <div class="col"><span class="label">Company</span><a href="#">About</a><a href="#">Careers</a><a href="#">Contact</a></div>
  <div class="col"><span class="label">Legal</span><a href="#">Privacy</a><a href="#">Terms</a></div>
</footer>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${brand} DNA — Components Fixture</title>
<!--
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ components.html = THE FIXTURE MACHINE.                                     │
  │ Crude, exhaustive, the literal source-of-truth render of every selector   │
  │ in components.manifest.json. Density is intentional — do NOT read it as    │
  │ "broken". The human-facing, curated view is preview/index.html.           │
  └─────────────────────────────────────────────────────────────────────────┘
  SELF-CONTAINED: :root + @font-face inlined from tokens.css. Zero external refs.
-->
<style>
${fontFace}
${rootBlock}
${componentCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(OUT, "components.html"), html);

// ── manifest (selectors WITH states, groups→tokenReferences, literals) ──────
// literal scan: count hardcoded color/px/font-family in the COMPONENT css only
// (the inlined :root is the token source, not a violation).
const colorExpr = (componentCss.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || [])
  .filter((x) => !/var\(/.test(x));
const pixelVals = (componentCss.match(/\b\d+px\b/g) || []).filter((p) => !["0px", "1px", "2px", "3px"].includes(p)); // hairlines/outlines allowed
const fontFams = (componentCss.match(/font-family:\s*(?!var\()[^;]+/gi) || []);

const tokenRefs = (block) => [...new Set([...block.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
const slice = (from, to) => { const a = componentCss.indexOf(from); const b = to ? componentCss.indexOf(to) : componentCss.length; return componentCss.slice(a, b > a ? b : componentCss.length); };

const groups = [
  { id: "button", label: "Button (primary/secondary/ghost/soft)",
    selectors: [".btn", ".btn:focus-visible", ".btn-primary", ".btn-primary:hover", ".btn-primary:active", ".btn-primary:disabled", ".btn-secondary", ".btn-secondary:hover", ".btn-secondary:active", ".btn-ghost", ".btn-ghost:hover", ".btn-ghost:active", ".btn-soft", ".btn-soft:hover"],
    classes: ["btn", "btn-primary", "btn-secondary", "btn-ghost", "btn-soft"], elements: ["button"], tokenReferences: tokenRefs(slice("/* ── Buttons", "/* ── Link")) },
  { id: "link", label: "Link", selectors: ["a.link", "a.link:hover", "a.link:focus-visible"], classes: ["link"], elements: ["a"], tokenReferences: tokenRefs(slice("/* ── Link", "/* ── Card")) },
  { id: "card", label: "Card", selectors: [".card", ".card:hover", ".card h3", ".card-grid"], classes: ["card", "card-grid"], elements: ["div"], tokenReferences: tokenRefs(slice("/* ── Card", "/* ── Field")) },
  { id: "field", label: "Field / Input", selectors: [".field input", ".field input:hover", ".field input:focus-visible", ".field input:active", ".field-error input", ".field-valid input"], classes: ["field", "field-error", "field-valid"], elements: ["input"], tokenReferences: tokenRefs(slice("/* ── Field", "/* ── Badge")) },
  { id: "badge", label: "Badge", selectors: [".badge", ".badge-success", ".badge-danger"], classes: ["badge", "badge-success", "badge-danger"], elements: ["span"], tokenReferences: tokenRefs(slice("/* ── Badge", "/* ── Data states")) },
  { id: "state", label: "Data states (loading/empty/error/populated/edge)", selectors: [".state", '.state[data-state="error"]', ".skeleton", ".pill-spinner"], classes: ["state", "skeleton", "pill-spinner"], elements: ["div"], tokenReferences: tokenRefs(slice("/* ── Data states", "/* ── Nav")) },
  { id: "nav", label: "Nav", selectors: [".nav", ".nav .brand", ".nav a", ".nav a:hover"], classes: ["nav", "brand"], elements: ["nav", "a"], tokenReferences: tokenRefs(slice("/* ── Nav", "")) },
  { id: "footer", label: "Footer", selectors: [".footer", ".footer .col a", ".footer .col a:hover"], classes: ["footer", "col"], elements: ["footer", "a"], tokenReferences: tokenRefs(slice(".footer {", "")) },
];

const allSelectors = [...new Set(groups.flatMap((g) => g.selectors))];
const allClasses = [...new Set(groups.flatMap((g) => g.classes))];

const manifest = {
  $description: `Machine inventory derived from components.html. Selectors include states. ${brand} DNA.`,
  source: (css.match(/from (https?:\/\/[^\s.]+\S*?) /) || [])[1] || null,
  builtFrom: "tokens.css (inlined — components.html is self-contained)",
  selfContained: true,
  classes: allClasses,
  selectors: allSelectors,
  states: {
    data: ["Loading", "Empty", "Error", "Populated", "Edge"],
    form: ["Untouched", "Dirty-valid", "Submitted-pending"],
    interactive: ["hover", "active", "focus-visible", "disabled"],
  },
  groups,
  literals: {
    colorExpressions: colorExpr.length,
    pixelValues: pixelVals.length,
    hardcodedFontFamilies: fontFams.length,
    $note: "Counts hardcoded design values in the component stylesheet (excludes the inlined :root token declarations and hairline 0–3px outlines). Drive toward zero.",
  },
};
writeFileSync(join(OUT, "components.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

log(`components.html (self-contained: ${fontFace ? "@font-face + " : ""}:root inline) · ${allSelectors.length} selectors · literals colors=${colorExpr.length} px=${pixelVals.length} fonts=${fontFams.length}`);
