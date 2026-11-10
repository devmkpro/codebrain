import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadBrowserRuntime } from "./browser-runtime.mjs";
import { exportComponentFixtures } from "./component-fixtures.mjs";
import { installFixtureCapture } from "./component-fixture-browser.mjs";

const { chromium } = loadBrowserRuntime();

test("captured DOM keeps glass, text, SVG references and native motion offline", async () => {
  const dir=mkdtempSync(join(tmpdir(),"cb-component-test-"));
  mkdirSync(join(dir,"screenshots"));mkdirSync(join(dir,"source"));
  const browser=await chromium.launch({headless:true});
  try {
    const source=await browser.newPage();
    await source.setContent(`<style>body{margin:0;background:#fafafa}#sample{width:300px;height:120px;background:linear-gradient(90deg,#eef,#446);position:relative}.glass{position:absolute;inset:10px;backdrop-filter:blur(12px);background:#ffffff66}span{display:inline-block;animation:move 2s linear infinite}@keyframes move{from{transform:translateX(0)}to{transform:translateX(70px)}}</style><section id="sample"><div class="glass"><span>Captured text</span><svg width="30" height="30"><defs><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><rect id="shape" width="20" height="20" fill="url(#paint)"/><use href="#shape" x="3"/></svg></div></section>`);
    await source.locator("#sample").screenshot({path:join(dir,"screenshots","source.png")});
    const components=[{slug:"sample",name:"sample",selector:"#sample",rect:{w:300,h:120},screenshot:"screenshots/source.png",states:[],focusable:false,insideInteractive:false}];
    const result=await exportComponentFixtures({page:source,components,outdir:dir});
    assert.equal(result.count,1);
    assert.equal(components[0].focusable,false);assert.equal(components[0].insideInteractive,false);
    const html=readFileSync(join(dir,"components/sample.html"),"utf8");
    assert.match(html,/blur\(12px\)/);assert.match(html,/Captured text/);assert.match(html,/href=\\?"#shape/);
    const fixture=await browser.newPage();let external=0;
    await fixture.route("**/*",route=>{if(/^(file|data):/.test(route.request().url()))return route.continue();external++;return route.abort();});
    await fixture.goto(pathToFileURL(join(dir,"components/sample.html")).href);
    await fixture.waitForFunction(()=>window.__fixture);
    assert.ok(await fixture.locator("[data-node]").evaluateAll(els=>els.some(el=>el.getAnimations().length>0)));
    await fixture.evaluate(()=>window.__fixture.seek(0));
    const a=await fixture.locator("#capture").screenshot({animations:"allow"});
    await fixture.evaluate(()=>window.__fixture.seek(700));
    const b=await fixture.locator("#capture").screenshot({animations:"allow"});
    assert.equal(a.equals(b),false);assert.equal(external,0);
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true});}
});

test("DOM recording observes changing text and stops within its bounded window", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<section id="sample">First observed frame</section>');
    await page.evaluate(installFixtureCapture);
    const recorded = await page.evaluate(async () => {
      const start = performance.now();
      setTimeout(() => { document.querySelector('#sample').textContent = 'Second observed frame'; }, 150);
      const replay = await window.__cbFixtureCapture.record('#sample', 600, 60);
      return { replay, elapsed: performance.now() - start };
    });
    assert.ok(recorded.elapsed >= 600 && recorded.elapsed < 2000);
    assert.equal(recorded.replay.frames[0].at, 0);
    assert.deepEqual([...new Set(recorded.replay.frames.map((frame) => frame.text))],
      ['First observed frame', 'Second observed frame']);
    assert.ok(recorded.replay.frames.every((frame, i, all) => !i || frame.at > all[i - 1].at));
  } finally { await browser.close(); }
});
