#!/usr/bin/env node
/*
 * lint-artifact.mjs — deterministic gate for cb-design-dna output.
 *
 * Usage:  node lint-artifact.mjs <designSystemDir>
 *
 * Turns the SKILL.md "P0 gate" from a prompt promise into exit 0/1.
 * Reads rules/anti-ai-slop.json + rules/contract.json (resolved relative to
 * THIS script, not the cwd), validates <designSystemDir>, prints a readable
 * report, and exits 1 if ANY P0 check fails (else 0). P1 failures warn only.
 *
 * Zero dependencies — pure Node ESM.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = resolve(__dirname, "..", "rules");

// ── args ──────────────────────────────────────────────────────────────
const target = process.argv[2];
if (!target) {
  console.error("usage: node lint-artifact.mjs <designSystemDir>");
  process.exit(2);
}
const DIR = resolve(process.cwd(), target);
if (!existsSync(DIR) || !statSync(DIR).isDirectory()) {
  console.error(`error: not a directory: ${DIR}`);
  process.exit(2);
}

// ── helpers ───────────────────────────────────────────────────────────
const readText = (p) => {
  try { return readFileSync(p, "utf8"); } catch { return null; }
};
const readJson = (p) => {
  const t = readText(p);
  if (t == null) return { ok: false, err: "missing", data: null };
  try { return { ok: true, err: null, data: JSON.parse(t) }; }
  catch (e) { return { ok: false, err: `parse: ${e.message}`, data: null }; }
};

const rules = readJson(join(RULES_DIR, "anti-ai-slop.json"));
const contract = readJson(join(RULES_DIR, "contract.json"));
if (!rules.ok || !contract.ok) {
  console.error(`error: cannot load rules from ${RULES_DIR} (${rules.err || ""} ${contract.err || ""})`);
  process.exit(2);
}
const RULES = rules.data;
const CONTRACT = contract.data;

const results = []; // { id, sev: 'P0'|'P1', pass, detail }
const add = (id, sev, pass, detail) => results.push({ id, sev, pass, detail });

// recursively collect leaf token objects ({value|$value}) from a DTCG-ish tree
function collectTokens(node, path, out) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n, i) => collectTokens(n, `${path}[${i}]`, out)); return; }
  const hasValue = "value" in node || "$value" in node;
  if (hasValue) { out.push({ path, node }); return; }
  for (const k of Object.keys(node)) collectTokens(node[k], path ? `${path}.${k}` : k, out);
}
const tokenHasProvenance = (n) => {
  const ext = n.$extensions || {};
  return Boolean(n.source || n.confidence || n.$source || ext.source || ext.confidence);
};

// gather all css/html text blobs in the dir for pattern scans
function gatherStyleBlobs() {
  const files = [
    "tokens.css",
    "tailwind-v4.css",
    "components.html",
    "preview/colors.html",
    "preview/typography.html",
    "preview/spacing.html",
  ];
  const blobs = [];
  for (const f of files) {
    const t = readText(join(DIR, f));
    if (t != null) blobs.push({ file: f, text: t });
  }
  return blobs;
}

// ── P0.1 — required files exist ───────────────────────────────────────
{
  const missing = CONTRACT.requiredFiles.filter((f) => !existsSync(join(DIR, f)));
  add("required-files", "P0", missing.length === 0,
    missing.length ? `missing ${missing.length}/${CONTRACT.requiredFiles.length}: ${missing.join(", ")}`
                   : `all ${CONTRACT.requiredFiles.length} present`);
}

// ── P0.2 — no forbidden indigo accent ─────────────────────────────────
{
  const forbidden = RULES.forbiddenAccentHexes.map((h) => h.toLowerCase());
  const hits = [];
  // tokens.css: lines declaring an --accent* var
  const css = readText(join(DIR, "tokens.css"));
  if (css) {
    for (const line of css.split("\n")) {
      const m = line.match(/--accent[\w-]*\s*:\s*([^;]+);/i);
      if (m) {
        const val = m[1].toLowerCase();
        for (const hex of forbidden) if (val.includes(hex)) hits.push(`tokens.css: ${line.trim()}`);
      }
    }
  }
  // design-tokens.json: any token whose path mentions "accent"
  const dt = readJson(join(DIR, "design-tokens.json"));
  if (dt.ok) {
    const toks = []; collectTokens(dt.data, "", toks);
    for (const { path, node } of toks) {
      if (!/accent/i.test(path)) continue;
      const v = String(node.value ?? node.$value ?? "").toLowerCase();
      for (const hex of forbidden) if (v.includes(hex)) hits.push(`design-tokens.json: ${path} = ${v}`);
    }
  }
  add("no-indigo-accent", "P0", hits.length === 0,
    hits.length ? `forbidden indigo accent: ${hits.join(" | ")}` : "accent is not default Tailwind indigo");
}

// ── P0.3 — no hero trust-gradient ─────────────────────────────────────
{
  const patterns = RULES.trustGradientPatterns.map((p) => new RegExp(p, "i"));
  const hits = [];
  for (const { file, text } of gatherStyleBlobs()) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) hits.push(`${file}: ${m[0].slice(0, 80)}`);
    }
  }
  add("no-trust-gradient", "P0", hits.length === 0,
    hits.length ? `trust-gradient: ${hits.join(" | ")}` : "no two-stop trust gradient");
}

// ── P0.4 — every token has source/confidence ──────────────────────────
{
  let checked = null, missing = [];
  const dt = readJson(join(DIR, "design-tokens.json"));
  const src = readJson(join(DIR, "source/tokens.source.json"));
  const pick = dt.ok ? { name: "design-tokens.json", data: dt.data }
            : src.ok ? { name: "source/tokens.source.json", data: src.data }
            : null;
  if (!pick) {
    add("token-provenance", "P0", false,
      `cannot read design-tokens.json (${dt.err}) nor source/tokens.source.json (${src.err})`);
  } else {
    const toks = []; collectTokens(pick.data, "", toks);
    checked = toks.length;
    missing = toks.filter(({ node }) => !tokenHasProvenance(node)).map(({ path }) => path);
    add("token-provenance", "P0", checked > 0 && missing.length === 0,
      checked === 0 ? `no tokens found in ${pick.name}`
        : missing.length ? `${missing.length}/${checked} tokens lack source/confidence in ${pick.name}: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`
        : `all ${checked} tokens in ${pick.name} carry source/confidence`);
  }
}

// ── P1.1 — component state selectors + required states ────────────────
{
  const cm = readJson(join(DIR, "components.manifest.json"));
  if (!cm.ok) {
    add("component-states", "P1", false, `components.manifest.json ${cm.err}`);
  } else {
    const selectors = Array.isArray(cm.data.selectors) ? cm.data.selectors
      : Array.isArray(cm.data.groups) ? cm.data.groups.flatMap((g) => g.selectors || []) : [];
    const needSel = [":hover", ":active", ":focus-visible"];
    const haveSel = needSel.filter((s) => selectors.some((x) => String(x).includes(s)));
    const html = (readText(join(DIR, "components.html")) || "").toLowerCase();
    const manifestText = JSON.stringify(cm.data).toLowerCase();
    const allStates = [...CONTRACT.requiredStates.data, ...CONTRACT.requiredStates.form];
    const missingStates = allStates.filter((s) => {
      const k = s.toLowerCase();
      return !(html.includes(k) || manifestText.includes(k));
    });
    const pass = haveSel.length === needSel.length && missingStates.length === 0;
    add("component-states", "P1", pass,
      `state selectors ${haveSel.length}/${needSel.length} (${haveSel.join(",") || "none"})` +
      (missingStates.length ? `; uncovered states: ${missingStates.join(", ")}` : `; all ${allStates.length} states referenced`));
  }
}

// ── P1.2 — derived files coherent with tokens.css ─────────────────────
{
  const css = readText(join(DIR, "tokens.css"));
  const tw = readText(join(DIR, "tailwind-v4.css"));
  const dt = readJson(join(DIR, "design-tokens.json"));
  if (css == null) {
    add("derived-coherence", "P1", false, "tokens.css missing — cannot verify derivation");
  } else {
    const cssVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const issues = [];
    if (tw == null) issues.push("tailwind-v4.css missing");
    else {
      const twVars = [...tw.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
      const orphan = [...new Set(twVars)].filter((v) => !cssVars.has(v));
      if (orphan.length) issues.push(`tailwind-v4.css introduces ${orphan.length} var(s) absent from tokens.css: ${orphan.slice(0, 6).join(", ")}`);
    }
    if (!dt.ok) issues.push(`design-tokens.json ${dt.err}`);
    else { const toks = []; collectTokens(dt.data, "", toks); if (toks.length === 0) issues.push("design-tokens.json has 0 tokens"); }
    add("derived-coherence", "P1", issues.length === 0,
      issues.length ? issues.join("; ") : `tokens.css has ${cssVars.size} vars; derived files coherent`);
  }
}

// ── P1.3 — token layers declared ──────────────────────────────────────
{
  const css = readText(join(DIR, "tokens.css")) || "";
  const report = readText(join(DIR, "source/token-contract.report.json")) || "";
  const hay = (css + " " + report).toLowerCase();
  const missing = CONTRACT.requiredTokenLayers.filter((l) => !hay.includes(l.toLowerCase()));
  add("token-layers", "P1", missing.length === 0,
    missing.length ? `layers not referenced: ${missing.join(", ")}` : `all ${CONTRACT.requiredTokenLayers.length} layers referenced`);
}

// ── MOTION gate — only fires when a motion pass actually ran ──────────
// Backwards compatible ON PURPOSE: a design-system emitted before the motion
// pass existed has no source/motion.json, so none of this applies and its exit
// code is unchanged. Adding these as unconditional required files would have
// retro-failed every artifact already on disk.
{
  const motionSrcPath = join(DIR, "source/motion.json");
  if (existsSync(motionSrcPath)) {
    const m = readJson(motionSrcPath);
    if (m.err) {
      add("motion-source-readable", "P0", false, `source/motion.json unreadable — ${m.err}`);
    } else {
      const M = m.data;

      // P0 — the capture must have reached the real page. A bot-wall capture
      // emits confident tokens for an interstitial; that is worse than nothing.
      add("motion-capture-reached-site", "P0", !!M.source?.captureMode,
        M.source?.captureMode
          ? `captured via ${M.source.captureMode}`
          : "source.captureMode missing — cannot prove the capture reached the real page, not a block page");

      // P0 — the four derived files must exist once motion.json does
      const motionFiles = ["motion.css", "motion.manifest.json", "motion.js", "preview/motion.html"];
      const missingMotion = motionFiles.filter((f) => !existsSync(join(DIR, f)));
      add("motion-derived-files", "P0", missingMotion.length === 0,
        missingMotion.length
          ? `motion.json exists but derived file(s) missing: ${missingMotion.join(", ")} — run scripts/gen-motion.mjs`
          : `all ${motionFiles.length} derived motion files present`);

      // P0 — a keyframe NAME with no BODY is the exact defect this pass exists
      // to kill: "tilePopIn" tells a builder nothing.
      const kf = M.keyframes || [];
      const bodyless = kf.filter((k) => !(k.offsets || []).length).map((k) => k.name);
      add("motion-keyframe-bodies", "P0", kf.length > 0 && bodyless.length === 0,
        kf.length === 0
          ? "no @keyframes captured — if the source really has none, say so under risks"
          : bodyless.length
            ? `${bodyless.length} keyframe(s) named without a body: ${bodyless.slice(0, 5).join(", ")}`
            : `${kf.length} keyframe(s), every one with its body`);

      // P0 — an effect recorded as "[?]" is the low-ticket bug: a blur that was
      // seen but never measured.
      const effectValues = [
        ...(M.effects?.backdropFilter || []),
        ...(M.effects?.filter || []),
        ...(M.effects?.glowShadows || []),
      ].map((e) => String(e.value ?? ""));
      const placeholders = effectValues.filter((v) => !v || /^\[?\?+\]?$/.test(v.trim()));
      add("motion-no-placeholder-effects", "P0", placeholders.length === 0,
        placeholders.length
          ? `${placeholders.length} effect value(s) are placeholders, not measurements`
          : `${effectValues.length} effect value(s), all measured`);

      // P1 — frame-strips are the visual proof. Identical frames mean the
      // scrub did not actually move anything.
      const strips = M.frameStrips || [];
      const proven = strips.filter((s) => s.proofOfMotion).length;
      add("motion-frame-strip-proof", "P1", strips.length === 0 || proven > 0,
        strips.length === 0
          ? "no frame-strips (run without --no-strips to produce visual proof)"
          : `${proven}/${strips.length} strip(s) proved motion with distinct frames`);

      // P1 — motion that lives outside CSS must be declared, not silently dropped
      const outsideCss = M.canvas?.present || (M.jsDriven?.waapiCallCount || 0) > 0;
      const mf = readJson(join(DIR, "motion.manifest.json"));
      const declared = !mf.err && typeof mf.data?.reproducibility === "string";
      add("motion-reproducibility-declared", "P1", !outsideCss || declared,
        outsideCss
          ? declared
            ? `non-CSS motion present and declared: ${String(mf.data.reproducibility).split(" —")[0]}`
            : "canvas/JS-driven motion observed but motion.manifest.json declares no reproducibility stance"
          : "all observed motion is CSS-expressible");
    }
  }
}

// ── report ────────────────────────────────────────────────────────────
const p0 = results.filter((r) => r.sev === "P0");
const p1 = results.filter((r) => r.sev === "P1");
const p0Fail = p0.filter((r) => !r.pass);
const p1Fail = p1.filter((r) => !r.pass);

const sym = (r) => (r.pass ? "PASS" : "FAIL");
console.log(`\nlint-artifact — ${DIR}`);
console.log("─".repeat(64));
console.log("P0 (blocking):");
for (const r of p0) console.log(`  [${sym(r)}] ${r.id} — ${r.detail}`);
console.log("P1 (warn):");
for (const r of p1) console.log(`  [${sym(r)}] ${r.id} — ${r.detail}`);
console.log("─".repeat(64));
console.log(`P0: ${p0.length - p0Fail.length}/${p0.length} pass · P1: ${p1.length - p1Fail.length}/${p1.length} pass`);

if (p0Fail.length) {
  console.log(`\nRESULT: FAIL — ${p0Fail.length} P0 check(s) failed. Handoff must NOT be 'done'.`);
  process.exit(1);
}
console.log(`\nRESULT: PASS — no P0 failures.${p1Fail.length ? ` (${p1Fail.length} P1 warning(s))` : ""}`);
process.exit(0);
