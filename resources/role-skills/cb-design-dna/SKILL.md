---
name: cb-design-dna
description: "Extract a portable design-system handoff from a real site using live DOM, screenshots and interactions. Capture tokens, component vocabulary and states, assets/fonts, motion/effects and provenance; derive CSS/JSON/Tailwind outputs and offline previews. Use for design DNA, design tokens, motion extraction or a design-system handoff from a URL, not for building the site itself."
---

# Codebrain Design DNA v2 — Live-Captured, Open-Design-Faithful Handoff

You turn a **real site** into a portable, machine-readable design-system handoff a downstream builder consumes without re-visiting the source. **v2 follows the Open Design (`nexu-io/open-design`) mechanism**. Its upstream analysis and `craft/` documents are not bundled; do not claim to have read unavailable references. The executable local rules are [rules/contract.json](rules/contract.json) and [rules/anti-ai-slop.json](rules/anti-ai-slop.json).

> **v1 → v2, the one change that matters.** v1 was **CSS-only**: it read `:root` vars and emitted 5 flat files. That is blind to everything that lives in the rendered pixel — component variants/states, composition, assets, motion. v2 captures **DOM + screenshots LIVE** and emits the **full Open Design contract**. The extractor agent does the live capture; you EMIT the artifacts from that evidence. **No screenshot evidence = incomplete handoff.**

You do NOT build the page (that's the builder). You EMIT artifacts into `./design-system/`.

## Codebrain runtime and scope

- Run helpers from this skill directory (or use their absolute paths). They operate on the explicitly selected URL/output directory; reading or importing this bundle is not permission to run captures, install packages, publish or modify unrelated projects.
- Discover the browser capabilities actually available in the current harness. Live extraction requires DOM/computed-style access, interactions, screenshots and animation inspection. A tool named in another environment is not necessarily available here. If a required capability is missing, report the gap; do not fabricate browser calls or screenshot evidence.
- The standalone scripts require the declared Playwright dependency plus an installed Chromium/Chrome. No account or persistent profile is needed for local fixtures. `CB_DESIGN_PLAYWRIGHT_MODULE` may point to an existing absolute module entrypoint for tests. Missing dependencies are not authorization to install them; the legacy static harvester's bootstrap requires explicit `CB_DESIGN_ALLOW_INSTALL=1` and user approval.
- Related skills, when actually available: `cb-showcase` for interface review, `cb-site-premium` for site implementation, `cb-worker` for delegated work and `cb-evidence` for command evidence. Do not pretend an absent skill was loaded. Keep this skill focused on extraction/handoff.
- Use an available handoff API only after confirming its contract. Otherwise report artifact paths, commands, exit codes and limitations in the final response; `handoff_submit` is not assumed to exist.
- Preserve third-party notices when present. This bundle supplies no new license grant or invented authorship. Captured assets and fonts retain their original rights; a successful capture does not authorize their reuse.

Local validation (isolated fixtures, no remote site or server):

```bash
node --test scripts/*.test.mjs
```

The imported linter is a bounded gate, not proof of every prose requirement below: it checks required files, token provenance, anti-slop patterns, states, basic derivation/layers and conditional motion checks. Screenshots, nine-section completeness, actual derivation and browser behavior still need independent verification; never report them solely from exit 0.

---

## THE ANTI-GENERIC RULE (non-negotiable, carried from v1)

**Every token and every claim cites where it came from, at one of three confidence levels** (Open Design's model):

| confidence | meaning |
|---|---|
| `observed` | read off the live site — a `getComputedStyle()` value, a CSS var, a screenshot pixel. The gold standard. Keep v1's `getComputedStyle` verification — it IS this layer. |
| `provided` | given by the user (brief, brand doc, supplied asset). |
| `inferred` | reconstructed/defaulted by you, explicitly labeled. A `clamp()` rebuilt from min/max is `inferred`. |

A token/claim with no confidence, or a source like "default" / "looks right", is **PROHIBITED**. A slot with no evidence is `"value": "?"`, `"confidence": "inferred"`, recorded under **risks/unknowns** — never invented. Honest gaps beat fabricated tokens.

---

## WEB calibration — discard the IG carousel layer

You inherit Open Design's *schema*, NOT a carousel medium. **DISCARD** anything carousel-shaped (`1080×1350`, `3×` export, `slide-*` slots, social safe-area, cover/teaching recipes). **KEEP** web-native: fluid type via `clamp(min, vw, max)`, real CSS breakpoints, container max-widths, fr-grids, real hover/focus/active states. If a value only makes sense for a square feed image, drop it.

---

## The output contract — ~12 artifacts in `./design-system/`

| Artifact | Role |
|---|---|
| `DESIGN.md` | Canonical prose, **9 fixed sections** (below). The human-readable source of truth. |
| `design-contract.md` | Decision record: evidence table (confidence), keep/change/do-not-copy, stance, **risks/unknowns**, quality-gate checklist. |
| `implementation-handoff.md` | Short, operational build instructions for the builder / coding agent. |
| `tokens.css` | Canonical compiled tokens, **4-layer schema** (below). |
| `design-tokens.json` | **DERIVED** from `tokens.css` + `source/token-contract.report.json`. Do not hand-author. |
| `tailwind-v4.css` | **DERIVED** `@theme` block. Must not redefine source values independently. |
| `components.html` | Standalone fixture — every component variant + every state, built only from the tokens. |
| `components.manifest.json` | Machine inventory derived from `components.html`: classes, **selectors incl. states**, groups→`tokenReferences`, `literals`. |
| `preview/colors.html` · `preview/typography.html` · `preview/spacing.html` | Per-dimension self-contained previews (zero external requests). |
| `source/motion.json` · `screenshots/motion/` | Live motion evidence: keyframe bodies, per-element timings, effects, reveals, canvas/JS gaps and frame strips. |
| `motion.css` · `motion.manifest.json` · `motion.js` · `preview/motion.html` | Four **DERIVED** motion artifacts; required when `source/motion.json` exists. |
| `assets/` | Extracted logo + images (the brand marks observed). |
| `fonts/` | Webfont files when a custom face is required (else `@font-face` is documented, not bundled). |
| `source/evidence.md` · `source/tokens.source.json` · `source/token-contract.report.json` · `source/scanned-files.json` | Provenance: scope of capture, raw observed tokens, token→`tokens.css`-line map, list of captured screenshots/files. |
| `screenshots/` | The live capture (hero, full, mobile, per-component, per-state). Supplied by the extractor; referenced by every artifact. |
| `source/motion.json` | **Motion pass.** Raw motion + effect contract: `@keyframes` WITH BODIES, per-element transitions, surface effects (`backdrop-filter`/`filter`/glow/blend) with measured values, reveal triggers, stagger step, `prefers-reduced-motion` rule count, canvas/WebGL contexts, intercepted `Element.animate` calls, frame-strips. |
| `motion.css` · `motion.manifest.json` · `motion.js` · `preview/motion.html` | **DERIVED** from `source/motion.json`. The reproducible kit: tokens + keyframe bodies, machine inventory, the reveal runner (measured threshold/stagger + reduced-motion guard), and a scrubbable preview. |
| `source/components.discovered.json` | **Component pass.** The site's OWN component vocabulary, found by structural clustering instead of a fixed archetype list: per component the selector, signature, instance count, variants, real interaction states with their property diff, and a screenshot. |

---

## 1. `DESIGN.md` — the nine fixed sections

Use these headings **exactly**, in order:

```
## 1. Visual Theme & Atmosphere
## 2. Color
## 3. Typography
## 4. Spacing & Grid
## 5. Layout & Composition
## 6. Components
## 7. Motion & Interaction
## 8. Voice & Brand
## 9. Anti-patterns
```

Each section is concrete prose backed by observed evidence (cite screenshots / computed values). §1 leads with a "feels like…" paragraph + a **Key Characteristics** bullet list. §2 names colors with role + hex + the CSS var observed + a **Gradient System** subsection (the literal `linear-gradient(...)`, when present). §5 captures real composition (e.g. "mockup-as-hero occupies lower ~60%", "3-col feature grid with vertical hairline dividers") — the layer CSS-only missed. §6 lists every component with variants + the states it ships. §9 are exact things to avoid, not vague phrases.

---

## 2. `design-contract.md` — decision record

Required blocks (mirror Open Design's `reference-design-contract`):

- **Goal & target** — what surface, what audience.
- **Evidence table** — `| evidence | confidence | note |` with `observed` / `provided` / `inferred`.
- **Keep / Change / Do-not-copy table** — one row per reference. `Keep` = controllable qualities (density, type rhythm, color temperature, motion attitude). `Do-not-copy` = literal screenshots, logos, claims, proprietary UI.
- **Stance** — one coherent visual direction in one paragraph (not 5 moodboards).
- **Risks & unknowns** — every `?` slot named here. (This is v1's honest "What was NOT observed", elevated.)
- **Quality-gate checklist** — the P0 gates (see Gate section).

---

## 3. `implementation-handoff.md` — operational

Short enough to paste into the next run: files to read, binding token/palette/type/layout constraints, asset rules, responsive requirements, and a "first artifact should prove…" acceptance note.

---

## 4. Tokens — the 4-layer schema (replaces v1's flat list)

`tokens.css` declares tokens by layer (from Open Design `_schema`):

| Layer | Who decides / if omitted | Examples |
|---|---|---|
| **A1-identity** | brand decides; **required** | `--bg`, `--fg`, `--accent`, `--font-display` |
| **A1-structure** | brand decides; **required** | type scale (`--text-sm…--text-4xl`), `--container-max`, `--section-y-*` |
| **A2 (fallback)** | brand, with a sensible fallback | `--motion-fast`, `--success`, `--space-4`, `--font-mono` |
| **B-slot** | brand or schema alias (`aliasTo`) | `--fg-2: var(--fg)` (collapsed) or independent value (richer) |
| **C-extensions** | brand-specific, allowlisted | `--tag-bg-*`, one-off brand tokens |

Rules: every A2 / B-slot token is **declared** in `:root` (artifacts paste one brand's `:root` into one `<style>`, so a missing var silently breaks). B-slot uses `aliasTo` when the brand has no richer opinion. `design-tokens.json` and `tailwind-v4.css` are **derived** from `tokens.css` + `source/token-contract.report.json` — never edited by hand, never redefining source values.

`source/token-contract.report.json` maps **every token → the line in `tokens.css`** where it's declared, each with `confidence`. This is where v1's `getComputedStyle` rigor lands.

---

## 5. Components — `components.html` + `components.manifest.json` (the v1 blind spot)

`components.html` is a real fixture rendering **every component, every variant, every state**, built only from the tokens (no hardcoded values — the manifest counts violations).

`components.manifest.json` is derived from it and carries:

- `classes` — every component class (`btn`, `btn-primary`, `btn-secondary`, `btn-icon`, `badge`, `field`, `field-error`, `tab`…).
- `selectors` — **including state selectors**: `.btn-primary:hover`, `.btn-primary:active`, `.btn:focus-visible`, `.field input:focus-visible`, `.tab[aria-selected="true"]`, `a:hover`, `a:focus-visible`.
- `groups` — `{id, label, selectors[], classes[], elements[], tokenReferences[]}` — each component group lists the tokens it consumes.
- `literals` — `{colorExpressions, pixelValues, hardcodedFontFamilies}`: a **count of hardcoded values** that should have been tokens. Drive this toward zero.

Reading a variant/state off the `:root` alone is forbidden — that's the bug that made v1 call the secondary button "primary, smaller" when the real one is a dark ghost pill. **Variants and states come from the rendered fixture + screenshots, not from CSS vars.**

---

## 6. Discipline & Gate (craft + linter)

Reference Open Design's `craft/` rules as binding:

- **State coverage** (`craft/state-coverage.md`) — every surface that fetches/transforms/accepts data renders **5 states**: Loading · Empty · Error · Populated · Edge. Forms add **3 more**: Untouched · Dirty-valid · Submitted-pending. Test = render-and-screenshot each. Missing states are the #1 silent AI-UI failure.
- **Anti-AI-slop P0** (`craft/anti-ai-slop.md`) — **block at P0**: (1) accent = default Tailwind indigo, exactly `#6366f1`/`#4f46e5`/`#4338ca`/`#3730a3`/`#8b5cf6`/`#7c3aed`/`#a855f7`; (2) hero two-stop "trust" gradient (purple→blue, blue→cyan, indigo→pink). Use the observed `--accent`; a flat surface + intentional type beats the gradient.
- Also pull `craft/color`, `craft/typography`, `craft/accessibility-baseline`, `craft/animation-discipline` as the discipline source.

### P0 gate — must pass before handoff

**Run the deterministic linter — it turns this gate from a prompt promise into exit 0/1:**

```bash
node scripts/lint-artifact.mjs ./design-system
```

It reads `rules/anti-ai-slop.json` + `rules/contract.json` and validates the dir. **`exit ≠ 0` = REJECT — you may NOT `handoff_submit` with `status:"done"`.** The linter enforces the same checks below (required files, no indigo accent, no trust-gradient, every token has source/confidence as P0; state selectors + 5+3 states + derived coherence + token layers as P1). The numbered list is the human-readable mirror of what the script checks:

1. **Screenshots exist** and cover hero + full + mobile + each key component + each state. No screenshot evidence → incomplete.
2. **`DESIGN.md`** uses the 9 headings exactly.
3. **`design-contract.md`** has the evidence table + keep/change/do-not-copy + risks + quality-gate.
4. **Every token carries `confidence`**; `tokens.css` ↔ `design-tokens.json` ↔ `token-contract.report.json` in sync; derived files not hand-edited.
5. **`components.manifest.json`** lists state selectors and the 5+3 states are present in `components.html`.
6. **Anti-slop P0 clean** — no default indigo accent, no hero trust-gradient.
7. **Previews render** with zero external requests; real hexes/sizes/rulers shown.
8. **Motion gate is conditional:** if `source/motion.json` exists, run the motion pass below. Legacy directories without it retain the previous lint checks and exit behavior.

### Motion pass — capture, derive, prove

Run from this skill directory, with Playwright and Chrome installed:

```bash
node scripts/harvest-motion.mjs <source-url> ./design-system
node scripts/gen-motion.mjs ./design-system
node scripts/verify-motion.mjs ./design-system
node scripts/lint-artifact.mjs ./design-system
```

Capture motion **before the static pass freezes animations**. `harvest-motion.mjs` runs separately from `harvest.mjs`; it falls back to headed Chrome when headless capture meets a bot wall. Inspect `source.captureMode` and `risks`. `--no-strips` omits frame-strip evidence, so use the default for delivery.

`gen-motion.mjs` reads only `source/motion.json` and captured PNGs. It emits:

- `motion.css`: duration/easing/delay/effect tokens and every captured `@keyframes` **body**.
- `motion.manifest.json`: provenance, properties, timings, effects, reveals/stagger, non-CSS gaps, and `preview` fixtures explicitly marked `inferred`.
- `motion.js`: reveal runner with the captured trigger threshold/stagger and reduced-motion guard.
- `preview/motion.html`: standalone diagnostics with inline keyframes, observed per-animation timings where available, play/pause/scrub, optional timing overrides, and embedded captured component frames. Missing running instances use timing labeled `inferred`. Repeated playback, fixture surfaces and custom-property defaults are also `inferred`; captured offsets remain unchanged, including single-offset keyframes.

The motion diagnostics prove CSS execution; they are **not a component library or a reconstruction of JavaScript/canvas choreography**. Deliver actual component fixtures alongside them when the task asks for components. A blur value in a table does not replace the glass component in context.

`verify-motion.mjs` opens headed Chromium and saves `source/motion-preview-proof/report.json` plus paired PNGs. For **every** swatch it checks `getAnimations()`, autoplay, play/pause/scrub, computed property changes and different PNG hashes at 0%/50% of the fixed stage. It also checks reduced-motion simulation and zero external requests. If frames coincide, inspect the property, missing variable or fixture surface; never rewrite observed motion merely to pass the image check. Declare an unresolved gap before handoff.

When motion evidence exists, the linter adds P0 checks `motion-capture-reached-site`, `motion-derived-files`, `motion-keyframe-bodies`, and `motion-no-placeholder-effects`. Frame-strip proof and non-CSS reproducibility are P1 checks. Run it on the **complete design-system directory**, not just a motion-only capture folder. Never add motion files to the unconditional legacy contract.

---

## 7. The two live passes — motion and components

`harvest.mjs` is the static pass and it is deliberately blind in two places. These passes are
**additive**: nothing in the static path is renamed, removed, or required to change.

### `scripts/harvest-motion.mjs <url> <outdir>` — motion and effect

The static pass FREEZES the page to photograph a settled state (`harvest.mjs:209-215` injects
`animation-duration:0s`, `transition:none`, and force-shows `[class*="reveal"]`/`[data-aos]`).
That is correct for a screenshot and structurally blind to motion — it erases the very system it
should be measuring, then reports 6 tokens with hardcoded fallbacks. This pass runs BEFORE any
freeze and measures what the freeze destroys:

- **Keyframe bodies**, not names. A handoff that says `tilePopIn` and nothing else tells a builder
  nothing. Read via `CSSKeyframesRule`; a cross-origin sheet throws on `.cssRules`, so its href is
  re-fetched over HTTP and parsed instead of being dropped.
- **Init hooks installed before any site script**: `HTMLCanvasElement.getContext` (what contexts the
  site asked for, without us mutating canvas state), `IntersectionObserver` (the REAL reveal
  threshold and rootMargin) and `Element.animate` (JS-driven motion — Framer/GSAP — which does not
  exist in the CSS at all).
- **Surface effects with measured values**: `backdrop-filter`, `filter`, glow shadows, blends,
  animated gradients, mask/clip. An effect recorded as `[?]` is a defect, not a gap.
- **Frame-strips**: each animation is restarted, paused, and `currentTime` pinned at
  t=0/.25/.5/.75/1, screenshotting each point. Frames are hashed — identical frames mean the scrub
  moved nothing and the strip is reported as unproven.
- **Bot-wall guard**: escalates `stealth-headless → headed Chrome` and ABORTS rather than emit. A
  capture of a Cloudflare interstitial produces a full design system of the block page with every
  value stamped `observed`; honest failure beats confident garbage.

Then `scripts/gen-motion.mjs <dir>` derives the kit. `preview/motion.html` must inline the keyframe
bodies — it makes zero external requests, so without them every `animation-name` points at nothing
and the preview renders a grid of frozen swatches. A custom property (`--angle`) needs `@property`
registered or it is a string, and strings do not interpolate.

### `scripts/harvest-components.mjs <url> <outdir>` — the site's own vocabulary

The static pass looks for seven archetypes it already knows, capped (6 buttons, 4 cards, 1 nav,
1 input, 1 footer) and deduplicated by `backgroundColor|borderRadius|boxShadow` — so two
structurally different things sharing a background and a radius collapse into one entry, and a chat
transcript, a recording bar or an agent cursor are unreachable by construction. This pass asks the
opposite question — **not "where are the buttons" but "what does this site repeat"**:

- Clusters by `tag + semantic classes + child-tag skeleton`, after stripping CSS-module hashes and
  Tailwind utilities. Single-word utilities count as noise too: leaving them in made `truncate` and
  `underline` rank as a site's top two "components".
- **States are probed by real interaction and kept only if something changed.** Three traps, all of
  which produce a lying artifact: (1) diffing only the hovered element misses composed components
  where the container is inert and the CHILD moves, so the snapshot covers the subtree and the diff
  names the node; (2) interactivity does not predict having a state — an `li` with no
  `cursor:pointer` and no focus can still animate its children on hover — so probe wider, ordered
  interactive-first; (3) an animated element yields PHANTOM states, because sampling
  `opacity: 0.966 → 1` twice is the animation settling, not a hover. The baseline is therefore
  measured twice and anything drifting on its own is disqualified from every later diff.
- `focusable` (self) and `insideInteractive` (ancestor) are separate fields: `closest()` made every
  `<span>` inside a button claim it takes keyboard focus.

Measured on `x.ai/bot`: 93 named clusters and 30 repeated structures against the old ceiling of 13.

## Process

1. **Live capture** (extractor agent, via Playwright): run `harvest-motion.mjs` before freezing animations, then snapshot DOM + screenshots (page + element) + extract logo/fonts/colors/images/OG/a11y. Lands evidence in `screenshots/` + `source/`.
   - **1b. Motion pass** — `node scripts/harvest-motion.mjs <url> <dir>` then `node scripts/gen-motion.mjs <dir>`. Run it BEFORE trusting §7 of `DESIGN.md`: without it that section is prose with no machine-readable counterpart (see §7 of this skill).
   - **1c. Component pass** — `node scripts/harvest-components.mjs <url> <dir>`. Run it before writing §6 of `DESIGN.md`, so the component list is the site's vocabulary and not the archetypes you knew to look for.
2. **Lock direction** — split references into Keep / Change / Do-not-copy; pick one stance.
3. **Bucket tokens** into the 4 layers; tag each with `confidence`; mark gaps `?` under risks.
4. **Strip the IG layer**; convert fixed sizes to web `clamp()` + breakpoints.
5. **Emit** the artifacts; derive `design-tokens.json` + `tailwind-v4.css` from `tokens.css` + report; run `gen-motion.mjs` when motion evidence exists.
6. **Gate** — run the P0 checklist. Then `handoff_submit` with all artifact paths + gate result.

---

## Anti-patterns (reject before emit)

- **CSS-only extraction** — emitting tokens with no screenshot evidence. That was the v1 bug. Capture the pixel.
- **Emitting anything from a bot wall.** If the capture landed on a Cloudflare interstitial, ABORT. A design system of a block page is not a partial result, it is a fabrication wearing an `observed` stamp.
- **A keyframe name with no body** (`tilePopIn`, `gridShimmerH`). Naming an animation is not specifying it.
- **An effect written as `[?]`** — a blur that was seen and never measured. Read the computed value or record it under risks; never both claim and dodge.
- **Prose instead of preview.** Colour, type and spacing each ship a preview; motion shipping only a paragraph is the old defect. If `source/motion.json` exists and `preview/motion.html` does not, the gate fails.
- **Declaring a state that changes nothing** — a phantom hover harvested from an element that was merely mid-animation. Measure the baseline twice and disqualify self-drift.
- **Reporting the archetypes you went looking for** instead of the vocabulary the site actually repeats.
- Inferring a component variant/state from `:root` instead of the rendered fixture.
- A token without `confidence`, or a hand-edited `design-tokens.json` / `tailwind-v4.css` that drifts from `tokens.css`.
- Default Tailwind indigo as accent; hero two-stop trust-gradient (both P0).
- Shipping only the populated state — no Loading/Empty/Error/Edge.
- Carousel/slide tokens (`slide-title`, `safe-area`, `1080×1350`) leaking into a web system.
- A preview that pulls a remote font/CDN — it must be self-contained.
- Copying a sample brand's literal hex/family/name — the format is the sample, the content is the user's scraped site.
