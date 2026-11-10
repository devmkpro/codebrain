---
name: cb-showcase
description: "UI/UX rules for building, reviewing or fixing product interfaces: accessibility and touch first, then performance, layout, typography and colour, motion, style consistency and charts, with a pre-delivery checklist. The project's design system always wins over these defaults. Use when designing, building, reviewing or fixing any screen, component, page or dashboard."
---

# cb-showcase — professional UI by rule, not by taste

Priority-ordered rules that separate a professional interface from a template. **Hard rule: when
the project has a design system (tokens, components, brand doc), it wins over anything here.**
Read it first — `docs/design-system/`, the global stylesheet, two or three sibling screens — and
fill only the gaps with these defaults. Product UI (dashboards, admin, SaaS, settings, dense data)
→ the **Product UI** section below (seção app UI incorporada, absorbed here in OVKA-443); marketing and
landing pages → `cb-site-premium`; a portable design-system handoff captured from a live site →
`cb-design-dna`.

## Workflow

1. **Read the request** — product type (SaaS, dashboard, landing, mobile…), industry, style
   keywords, stack (default: the project's; otherwise HTML + Tailwind).
2. **Read the project** — tokens, existing components, spacing and type scales, light/dark
   handling. Reuse before inventing.
3. **Decide the system for what is missing** — style, palette (one accent on a neutral base),
   type pairing (heading and body personalities match), spacing scale, elevation, motion budget —
   and write it down before coding.
4. **Build** by the rules below, **review** with the checklist, **fix** what fails.

## Rules by priority

1. **Accessibility (critical)** — text contrast ≥ 4.5:1 (3:1 for large text); visible focus
   rings; alt text on meaningful images; `aria-label` on icon-only buttons; tab order = visual
   order; every input has a label; colour is never the only signal.
2. **Touch and interaction (critical)** — targets ≥ 44×44 px; primary actions on click or tap,
   never hover-only; buttons disabled with a spinner during async work; errors next to the field,
   in words; `cursor: pointer` on everything clickable; hover feedback that does not shift layout.
3. **Performance (high)** — WebP/AVIF, `srcset`, lazy-load below the fold; respect
   `prefers-reduced-motion`; reserve space for async content (no layout jumps); skeletons over
   spinners for content areas.
4. **Layout and responsive (high)** — viewport meta; ≥ 16 px body text on mobile; no horizontal
   scroll; one container width; content never hidden behind fixed bars; a z-index scale
   (10 / 20 / 30 / 50), not magic numbers; check 375, 768, 1024 and 1440.
5. **Typography and colour (medium)** — line-height 1.5–1.75 for body; 65–75 characters per
   line; at most two families; muted text still readable (slate-600, not gray-400); borders
   visible in both modes; glass surfaces ≥ 80 % opacity in light mode.
6. **Motion (medium)** — 150–300 ms for micro-interactions; animate `transform` and `opacity`,
   not width or height; every loading and empty state designed.
7. **Style (medium)** — one style across all pages; the style matches the product (fintech is
   not a kids app); SVG icons from one set (Lucide, Heroicons) with a fixed viewBox and size —
   **never emoji as icons**; correct brand logos from the official SVG.
8. **Charts and data (low)** — the chart type matches the data (trend → line, comparison → bar,
   part-of-whole → few slices); accessible palettes; a table alternative for screen readers.

## Anti-patterns that read as amateur

Emoji icons · hover scale that shifts layout · `bg-white/10` glass in light mode · gray-400 body
text · invisible borders · mixed container widths · a navbar glued to `top-0` with no spacing ·
instant or > 500 ms transitions · the browser focus ring removed without a replacement.

## Product UI — dashboards, admin, SaaS, dense data (seção app UI incorporada)

The enemy is the statistical default: every model has seen thousands of dashboards and drifts to
the centre of the distribution — a friendly font on a generic grid, a warm palette on a cold
structure. **Failure test:** if another agent, given a similar prompt, would land on the same
screen, you defaulted. Design is born from THIS product, THIS user, THIS task. (Landing pages and
marketing are not this section → `cb-site-premium`.)

1. **Intent before code** — a short brief, not an essay: *who* is this person, really (where they
   are, what they did five minutes before, what they do five minutes after); *which verb* they must
   complete (approve a payment, find the broken deploy, grade a test); *what feeling* the screen
   carries, in words that mean something ("dense as a trading floor", "calm as a reader", "cold as
   a terminal" — "clean and modern" says nothing). If the request cannot answer the three, ask ONE
   objective question; if you can assume responsibly, assume and declare it. Intent is systemic:
   "dense" means spacing, type and information architecture are all dense, not only the palette.
   A choice justified by "it's common" or "it works" is a default in disguise.
2. **Explore the product's domain** before any visual decision — produce four things: ≥ 5 domain
   concepts (vocabulary and metaphors of that world, territory not features); ≥ 5 colours that
   exist in the physical version of that space; one **signature** — a visual, structural or
   interaction element that could only exist in THIS product (no candidate → keep exploring);
   three obvious choices for this screen type that you reject, each with its replacement. Test:
   remove the product name from your proposal — can a reader still guess what it is?
3. **Hierarchy and composition** — one focus per screen, named out loud before building and made
   to win by size, contrast or surrounding space, everything else demoted on purpose; a type scale
   by ratio (≈1.2 for dense or calm UI, 1.25 for most product, 1.333 for something expressive) from
   a 14–16 px base, so steps are visibly distinct; weight and colour carry more hierarchy than size
   (one 14 px size sustains three layers: value 600/primary · label 500/secondary · meta 400/muted
   — use size, weight and colour together, never size alone); density is a choice expressed in px
   (12–16 px padding reads as a workbench, 24 px as a brochure) and the chosen value repeats
   everywhere; uneven spatial rhythm — a dense control zone yields to open content, related things
   sit tight, real air between groups (same card, same gap everywhere is the sound of nobody
   deciding); proportion says something (a 280 px sidebar serves the content, 360 px makes them
   peers — if you cannot say what a proportion says, it says nothing); ≈60/30/10
   neutral/secondary/accent, structure by space and weight BEFORE lines and borders, tighter
   tracking on large headings, ≈1.5 line-height in body.
4. **Layers and surfaces** — a numbered elevation scale with a few % of luminance per step
   (dropdown > card > page: each step barely perceptible alone, stacked they reveal the
   hierarchy); sidebar on the canvas background plus a subtle border, never a different colour
   (that splits "sidebar world" from "content world"); dropdown/popover one level above its
   parent; input slightly DARKER than its surroundings (it receives content, it is sunken);
   borders as low-opacity `rgba` (dark mode lives around `rgba(255,255,255,0.06–0.12)`), solid
   hex reads hard by comparison. **Squint test:** blur your eyes — the hierarchy must still be
   there, nothing jumping out. Every pattern has infinite expressions: a metric can be a hero
   number, an inline stat, a sparkline, a gauge, a comparative delta; the same sidebar + grid +
   icon-number-label card in every project is the most obvious AI tell. Colour comes from
   somewhere: visit the physical version of that space (materials, light, objects) before picking
   a palette, so it looks like it CAME from there instead of being applied on top.
5. **Use what exists** — the fastest way to degrade a codebase is to reinvent it (`<div
   onClick>` next to the project's real `Button`, a keyboard-less dropdown next to an installed
   primitive that already handles it). Controls, in this order: native HTML where it works
   (`<button>`, `<a>`, `<dialog>`, `<details>`) → a battle-tested primitive for anything stateful
   and hard to get right (select, combobox, dialog, tooltip, tabs, date picker — Radix, React
   Aria, Ark, Headless UI already solve keyboard/focus/ARIA/positioning) → hand-made only as a
   genuine last resort, owing the full contract (keyboard navigation, focus trap and return, ARIA,
   click-outside, scroll-lock). Styling, in this order: the design system (`<Button
   variant="…">`) → a component/variant for anything repeated twice → semantic tokens
   (`bg-card text-muted-foreground`, never raw hex or gray-N — they break theming and dark mode)
   → an inline utility only for a genuinely unique layout tweak.
6. **System essentials** — colour tokens trace to a handful of primitives (foreground, background,
   border, brand, semantic destructive/warning/success), zero loose hex; four text levels
   (primary / secondary / tertiary / muted — two is flat); a 4 or 8 px spacing unit, multiples
   only, scaled by context (micro / component / section / area); ONE depth strategy and keep it
   (border-only: technical and dense · subtle shadow: approachable · layered shadow: premium ·
   surface variation: no shadow) — never mixed; radius on a scale (small input/button, medium
   card, large modal); dedicated control tokens (input/select/checkbox do not reuse the generic
   surface token); dark mode leans on borders (shadow is weak in the dark), desaturates semantic
   colours, keeps the same hierarchy with inverted values, one hue varying only in luminance.
7. **Polish and motion** — concentric radius (`outer = inner + padding`; the same radius on parent
   and child is the most common "almost right" error); symmetric padding unless the content
   genuinely asks otherwise; `font-variant-numeric: tabular-nums` on any dynamic number (counter,
   price, table column); optical alignment corrected by eye (≈2 px less padding on the icon side
   than the text side); every interactive element has default/hover/active/focus/disabled and
   every data view has loading/empty/error — a missing state is the fastest tell of an unfinished
   screen; shadow over border for elevation on a card or button that "lifts"; `:active`
   `transform: scale(0.97)` (never below 0.95) as tactile confirmation; motion is felt, not
   watched — an action repeated 100+ times a day (shortcut, command palette) does NOT animate, an
   occasional surface (modal, drawer, toast) does; < 300 ms, custom ease-out never ease-in,
   `transform`/`opacity` only (GPU), never `transition: all`, never from `scale(0)` (start at
   `scale(0.95) + opacity: 0`), popovers scale from their trigger, modals stay centred, list
   entries stagger 30–80 ms, `prefers-reduced-motion` respected.
8. **Checkpoint before every component** — even a small one — write one line each: intent
   (person, verb, feeling) · hierarchy (the element in focus and how it wins) · palette (colours
   from the domain exploration, and why) · depth (border / subtle shadow / layers, and why) ·
   surfaces (elevation scale, and why that temperature) · typography (family + size/weight/colour
   levers, and why) · spacing (base unit + chosen density). A line without a *why* is a default:
   stop and decide again.

**Avoid:** a hard border as the first thing the eye lands on · a dramatic elevation jump · flat
hierarchy with no defined focus · the same card and gap everywhere · spacing off-grid · mixed
depth strategies · a missing state · a large radius on a small element, a thick decorative
border · decorative gradients or colour without meaning, multiple accents · the system font or
generic Inter when a direction was declared · structural hacks (negative margin undoing the
parent's padding, `calc()` escapes, `position: absolute` to flee the layout flow).

**Working rules:** inspect the app, tokens and existing patterns before proposing anything new;
explore the domain (the four outputs) before deciding layout, colour, type or density; build and
run typecheck/build when available; verify non-trivial UI visually — text/DOM snapshot BEFORE a
screenshot (QA pyramid: headless always, pixels only for the final verdict), checking overlap,
broken spacing, empty state, unreadable text; at most three attempts on the same approach for one
visual or technical problem — on the third failure change the approach or report the gap, never
attempt variation ten; a visual reference, when needed, is generated with
`media_generate` (owned media, never stock or hotlinks); a UI bug found while auditing
(not the current task) goes to `finding_add` com evidência via `cb-findings`, never a loose
report in chat; when citing craft, cite a category leader (Linear, Stripe, Vercel, Apple), never a
generic example. When the direction is ambiguous or expensive to change later, **suggest and ask**
— domain (5+ concepts) · palette (5+ colours from that domain) · signature · rejecting (obvious →
alternative) · direction connecting them — then "does this direction fit?".

**Final checks (product UI):** swap test — replace the font with the default and the layout with a
generic template: would anything change? where it would not, you defaulted · squint test —
hierarchy still readable when blurred? · signature test — point to five specific places where the
signature shows; "the overall feel" does not count · token test — read the CSS variables aloud: do
they belong to THIS product or to any project?

## Pre-delivery checklist

- [ ] Contrast, focus, labels, alt text and the keyboard path verified
- [ ] Touch targets and cursors on every interactive element
- [ ] Light and dark mode both checked
- [ ] Responsive at 375 / 768 / 1024 / 1440, no horizontal scroll
- [ ] Reduced motion respected; no content jump on load
- [ ] Icons from one set, no emoji; logos correct
- [ ] Project tokens and components used — nothing hard-coded that the design system already defines
- [ ] Product UI: one named focus per screen, every interactive and data state present, one depth strategy, the four final checks (swap / squint / signature / token) passed

## Integração Codebrain — capacidades reais

- Esta skill é material de orientação, não autorização para gastar com APIs, publicar, instalar ferramentas ou alterar permissões. Respeite o pedido, o escopo e o design system do usuário.
- O MCP do app expõe `media_generate({ prompt, kind?, provider?, size?, style? })` e `media_list({})`. `kind` é `image` ou `video`; `provider`, quando configurado e autorizado, é `openai`, `gemini` ou `openrouter`. Omita `provider` para usar o provedor configurado pelo host. Não há parâmetros `imageUrl` nem `outPath`: use o caminho devolvido em `assets/generated` no workspace.
- Confira na Central os provedores e formatos disponíveis; não existe uma ferramenta MCP de listar provedores. Não leia/exporte chaves para fazer essa conferência. Não presuma geração, vídeo, transparência ou edição por referência se o provedor ativo não oferecer isso. Sem capacidade autorizada, use assets fornecidos ou CSS/SVG e relate a limitação.
- Navegação e validação usam a capacidade browser real do Codebrain: `browser_navigate`, `browser_get_text` ou `browser_get_accessibility_tree`, `browser_screenshot`, `browser_console_log` e `browser_network_log`, conforme as ferramentas efetivamente disponíveis na sessão. Não invente uma ferramenta `cb-browser`. Capture evidência visual e inspecione pixels por uma capacidade real de visualização; descrição textual de screenshot não prova aparência. Se indisponível, informe a validação visual pendente.
- `cb-evidence` substitui a antiga etapa de comprovação; `cb-worker` delimita trabalho delegado; defeitos fora do escopo usam `cb-findings` e `finding_add` com evidência quando disponível. Não fabrique resultado de execução ou validação.
- `cb-design-dna` está incluído no Codebrain; use-o quando precisar extrair um design system de um site real. `cb-cinema-shot`, `cb-site-scrub` e `cb-site-encode` são referências opcionais não incluídas neste pack: carregue somente se estiverem instaladas e autorizadas. Sem elas, aplique a doutrina diretamente e declare qualquer etapa que não possa realizar. A antiga seção de app UI está incorporada em `cb-showcase`; não requer outra skill.
- Autoria, proveniência e avisos originais estão preservados em [NOTICE.md](NOTICE.md), não constituem dependências operacionais e não atribuem a autoria original ao Codebrain. Nenhuma licença adicional é presumida ou concedida.
