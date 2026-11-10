#!/usr/bin/env node
// Headed, pixel-level proof for the standalone preview. [CB-DESIGN-MOTION.1]
// Usage: node verify-motion.mjs <design-system-dir> [evidence-dir]
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) {
  console.error("usage: node verify-motion.mjs <design-system-dir> [evidence-dir]");
  process.exit(2);
}
const dir = resolve(process.argv[2]);
const out = resolve(process.argv[3] || join(dir, "source", "motion-preview-proof"));
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(dir, "motion.manifest.json"), "utf8"));
const source = JSON.parse(readFileSync(join(dir, "source", "motion.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = { browser: "chromium / chrome headed", samples: [0, 50], cards: [], failures: [] };
const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
    reducedMotion: "no-preference", colorScheme: "light",
  });
  let externalRequests = 0, pageErrors = 0;
  await context.route("**/*", (route) => {
    if (/^(file|data):/.test(route.request().url())) return route.continue();
    externalRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", () => pageErrors++);
  await page.goto(pathToFileURL(join(dir, "preview", "motion.html")).href);
  const frame = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await frame();
  const state = () => page.locator(".demo").evaluateAll((els) => els.map((el) => {
    const animations = el.getAnimations();
    return { count: animations.length, running: animations.every((a) => a.playState === "running"), time: animations[0]?.currentTime };
  }));
  const initial = await state();
  await frame();
  const advanced = await state();
  if (!initial.length || initial.length !== manifest.keyframes.length) report.failures.push("preview/manifest card count mismatch");
  await page.locator(".demo").evaluateAll(async (els) => {
    const animations = els.flatMap((el) => el.getAnimations());
    animations.forEach((a) => a.pause());
    await Promise.all(animations.map((a) => a.ready));
  });

  for (let i = 0; i < initial.length; i++) {
    const card = page.locator(`.card[data-i="${i}"]`);
    const demo = card.locator(".demo");
    const stage = card.locator(".stage");
    await stage.scrollIntoViewIfNeeded();
    const name = await demo.evaluate((el) => getComputedStyle(el).animationName);
    const entry = { name, animationCount: initial[i].count, autoplay: initial[i].running && advanced[i].time > initial[i].time, frames: [] };
    for (const percent of report.samples) {
      await card.locator("[data-scrub]").evaluate((slider, value) => {
        slider.value = String(value);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }, percent);
      await frame();
      const computed = await demo.evaluate((el, properties) => {
        const css = getComputedStyle(el), rect = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
        return { opacity: css.opacity, transform: css.transform, height: css.height, backgroundColor: css.backgroundColor,
          backgroundPosition: css.backgroundPosition, angle: css.getPropertyValue("--angle").trim(),
          x: rect.x - parent.x, y: rect.y - parent.y, time: el.getAnimations()[0]?.currentTime,
          properties: Object.fromEntries(properties.map((p) => [p, css.getPropertyValue(p)])) };
      }, manifest.keyframes[i].properties);
      const file = `${String(i).padStart(2, "0")}-${percent}.png`;
      // Capture the fixed stage, not the moving element or changing time label.
      const png = await stage.screenshot({ path: join(out, file), animations: "allow" });
      entry.frames.push({ percent, file, sha256: sha256(png), computed });
    }
    entry.distinctFrames = entry.frames[0].sha256 !== entry.frames[1].sha256;
    const offsets = source.keyframes[i].offsets;
    entry.propertyChanges = Object.fromEntries(manifest.keyframes[i].properties.filter((prop) => {
      const declared = offsets.filter((o) => prop in o.props);
      return new Set(declared.map((o) => o.props[prop])).size > 1 || declared.length === 1;
    }).map((prop) => [prop, entry.frames[0].computed.properties[prop] !== entry.frames[1].computed.properties[prop]]));
    entry.scrub = await demo.evaluate((el) => el.getAnimations().every((a) =>
      a.playState === "paused" && Math.abs(a.currentTime - (a.effect.getTiming().delay + a.effect.getTiming().duration / 2)) < 0.01));
    await card.locator('[data-act="play"]').click();
    await frame();
    const playing = await demo.evaluate((el) => el.getAnimations().map((a) => ({ state: a.playState, time: a.currentTime })));
    await frame();
    entry.play = await demo.evaluate((el, previous) => el.getAnimations().every((a, n) =>
      a.playState === "running" && a.currentTime > previous[n].time), playing);
    await card.locator('[data-act="pause"]').click();
    await demo.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.ready)));
    const paused = await demo.evaluate((el) => el.getAnimations().map((a) => a.currentTime));
    await frame();
    entry.pause = await demo.evaluate((el, times) => el.getAnimations().every((a, n) =>
      a.playState === "paused" && a.currentTime === times[n]), paused);
    entry.pass = entry.animationCount > 0 && entry.autoplay && entry.distinctFrames && entry.scrub && entry.play && entry.pause && Object.values(entry.propertyChanges).every(Boolean);
    report.cards.push(entry);
    if (!entry.pass) report.failures.push(name);
    console.log(`[${entry.pass ? "PASS" : "FAIL"}] ${name}: animations=${entry.animationCount} pixels=${entry.distinctFrames} autoplay=${entry.autoplay} scrub=${entry.scrub} play=${entry.play} pause=${entry.pause}`);
  }

  await page.locator("#rm").check();
  report.reducedMotion = await page.locator(".demo").evaluateAll((els) => els.every((el) => el.getAnimations().length === 0));
  if (!report.reducedMotion) report.failures.push("reduced-motion simulation");
  report.externalRequests = externalRequests;
  report.pageErrors = pageErrors;
  if (externalRequests || pageErrors) report.failures.push("external requests or page errors");
} finally {
  await browser.close();
}
report.pass = report.failures.length === 0;
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`${report.cards.filter((c) => c.pass).length}/${report.cards.length} swatches passed; evidence: ${out}`);
process.exitCode = report.pass ? 0 : 1;
