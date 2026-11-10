// Additive fixture/asset export for harvest-components.mjs. [CB-DESIGN-COMPONENTS]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFixtureCapture } from "./component-fixture-browser.mjs";

const esc = (v) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const json = (v) => JSON.stringify(v).replaceAll("<", "\\u003c");
const frameCss = (frames, styles) => {
  const used = new Set(frames.flatMap((frame) => [...frame.html.matchAll(/\bcb-s(\d+)\b/g)].map((m) => Number(m[1]))));
  return [...used].map((i) => `.cb-s${i}{${styles[i]}}`).join("\n") + "\n" + [...new Set(frames.flatMap((f) => f.pseudo))].join("\n");
};

export async function exportComponentFixtures({ page, components, outdir, recordPattern, recordMs = 9000, log = () => {} }) {
  await page.evaluate(installFixtureCapture);
  const captures = {}, gaps = [], assets = new Map();
  const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  for (const c of components) {
    if (!c.screenshot) continue;
    const locator = page.locator(c.selector).first();
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
      await page.mouse.move(0,0); await page.evaluate(() => document.activeElement?.blur()); await settle();
      const normal = await page.evaluate((selector) => window.__cbFixtureCapture.snapshot(selector), c.selector);
      if (!normal) continue;
      const capture = captures[c.slug] = { default: normal, states: {} };
      // State eligibility stays owned by the validated double-baseline probe.
      for (const state of c.states || []) {
        if (state.state === "hover") await locator.hover({ timeout: 4000 });
        else if (state.state === "focus" && c.focusable) await locator.focus();
        else continue;
        await settle();
        capture.states[state.state] = await page.evaluate((selector) => window.__cbFixtureCapture.snapshot(selector), c.selector);
        await page.mouse.move(0,0); await page.evaluate(() => document.activeElement?.blur());
      }
      if (recordPattern?.test(c.name)) {
        await locator.hover({ force: true }); await settle();
        log("recording component", c.name);
        capture.replay = await page.evaluate(({ selector, duration }) => window.__cbFixtureCapture.record(selector, duration, 160), { selector: c.selector, duration: recordMs });
        c.recording = { durationMs: recordMs, frames: capture.replay.frames.length,
          distinctTexts: new Set(capture.replay.frames.map((f) => f.text)).size, confidence: "observed" };
        await page.mouse.move(0,0);
      }
      c.fixture = `components/${c.slug}.html`;
      c.fixtureConfidence = "observed";
      c.fixtureGaps = [...normal.gaps, "Interaction/application logic is not exported; recorded states and DOM/native-animation replays are preserved."];
      log("fixture", c.name, "nodes", normal.nodes.length, "native animations", normal.animations.length);
    } catch { gaps.push(`${c.name}: fixture unavailable; source node detached or interaction could not resolve.`); delete captures[c.slug]; }
  }
  const styles = await page.evaluate(() => window.__cbFixtureCapture.styles());
  const faces = await page.evaluate(() => window.__cbFixtureCapture.fontFaces());
  const blobs = [...styles, ...faces, ...Object.values(captures).map((c) => JSON.stringify(c))];
  const urls = new Set();
  for (const blob of blobs) for (const m of blob.matchAll(/https?:[^\s"'<>\\)]+/g)) urls.add(m[0].replaceAll("&amp;", "&"));
  for (const url of urls) {
    try {
      const response = await page.context().request.get(url, { timeout: 15000 });
      const mime = (response.headers()["content-type"] || "").split(";")[0];
      if (!response.ok() || !/^(image\/|font\/|application\/(?:font|x-font|octet-stream))/.test(mime)) continue;
      const bytes = await response.body();
      if (bytes.length > 8_000_000) { gaps.push("A rendering asset exceeds the 8 MB embedding limit."); continue; }
      assets.set(url, `data:${mime};base64,${bytes.toString("base64")}`);
    } catch { gaps.push("A rendering asset was unavailable; no remote request is retained in the fixture."); }
  }
  const embed = (text) => {
    for (const [url, data] of assets) text = text.split(url).join(data).split(url.replaceAll("&", "&amp;")).join(data);
    // Unresolved assets become explicit gaps, never hidden network dependencies.
    text = text.replace(/url\(["']?https?:[^)]+\)/g, () => { gaps.push("An unresolved CSS image/font was omitted."); return "none"; });
    text = text.replace(/\bsrc="https?:[^"<]+"/g, () => { gaps.push("An unresolved image was omitted."); return 'src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"'; });
    return text;
  };
  const fontCss = embed(faces.join("\n"));
  const sharedAssets = [...new Set(assets.values())];
  const compact = (html) => { sharedAssets.forEach((asset, i) => { html = html.split(asset).join(`__CB_ASSET_${i}__`); }); return html; };
  mkdirSync(join(outdir,"components"), { recursive: true }); mkdirSync(join(outdir,"preview"), { recursive: true });
  const cards = [];
  for (const c of components) {
    const capture = captures[c.slug]; if (!capture) continue;
    const frames = capture.replay?.frames?.length ? capture.replay.frames : [{ at: 0, ...capture.default }];
    const css = embed(frameCss([...frames, ...Object.values(capture.states).filter(Boolean)], styles));
    const payload = { frames: frames.map((f) => ({ at: f.at, html: embed(f.html), animations: f.animations })),
      states: Object.fromEntries(Object.entries(capture.states).filter(([,f]) => f).map(([name,f]) => [name,{html:embed(f.html),animations:f.animations}])),
      duration: capture.replay?.durationMs || Math.max(1000,...capture.default.animations.map((a) => Number(a.timing.duration) || 0)) };
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.name)}</title>
<style>${fontCss}\n${css}\nhtml,body{margin:0;padding:0;background:${capture.default.backdrop};}#capture{position:relative;isolation:isolate;}</style>
<div id="capture"></div><script>
const data=${json(payload)};
const root=document.getElementById('capture');let animations=[],index=-1,time=0,playing=true,previous=performance.now(),mode='replay';
function render(frame,elapsed){root.innerHTML=frame.html;animations=[];for(const spec of frame.animations){const el=root.querySelector('[data-node="'+spec.target+'"]');if(!el)continue;try{const a=el.animate(spec.keyframes,{...spec.timing,iterations:spec.timing.iterations==='infinite'?Infinity:spec.timing.iterations});a.pause();a.currentTime=spec.currentTime+elapsed;animations.push({a,spec});}catch{}}}
function seek(value){time=value;let next=0;for(let n=0;n<data.frames.length;n++)if(data.frames[n].at<=time)next=n;const f=data.frames[next];if(next!==index){index=next;render(f,time-f.at);}for(const {a,spec} of animations)a.currentTime=spec.currentTime+time-f.at;}
function tick(now){if(playing&&mode==='replay'){time=(time+now-previous)%data.duration;seek(time);}previous=now;requestAnimationFrame(tick);}
window.addEventListener('message',e=>{const m=e.data;if(!m||m.type!=='cb-fixture')return;if(m.action==='play'){mode='replay';playing=true;index=-1;}if(m.action==='pause')playing=false;if(m.action==='scrub'){mode='replay';playing=false;index=-1;seek(Math.min(.999,Math.max(0,m.value))*data.duration);}if(m.action==='state'&&data.states[m.value]){mode='state';playing=false;render(data.states[m.value],0);}});
window.__fixture={data,seek:(t)=>{playing=false;index=-1;seek(t);},get time(){return time;}};
seek(0);requestAnimationFrame(tick);
</script></html>`;
    writeFileSync(join(outdir,c.fixture),html);
    const source = readFileSync(join(outdir,c.screenshot)).toString("base64");
    cards.push({name:c.name,selector:c.selector,fixture:c.fixture,html:compact(html),source,rect:c.rect,states:(c.states||[]).map((s)=>s.state),recording:c.recording,gaps:c.fixtureGaps});
  }
  const gallery = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Captured component library</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#161616;font:14px/1.5 system-ui}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:28px;margin:0}p{color:#666}input,button,select{font:inherit;padding:6px 10px}input[type=search]{width:100%;margin:20px 0}details{background:white;border:1px solid #ddd;margin:12px 0;padding:18px}summary{cursor:pointer;font-weight:600}code{font:11px/1.5 monospace;overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.viewport{overflow:auto;background:#fafafa;position:relative;min-height:60px}iframe{display:block;border:0;transform-origin:top left}img{max-width:100%;max-height:480px;object-fit:contain;object-position:top left}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.controls input{min-width:100px;flex:1}.note{font-size:12px;color:#666}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style>
<main><h1>Captured components</h1><p>Real DOM, text, surfaces and captured motion. Each fixture opens offline. Source screenshots stay alongside for comparison.</p><p class="note">${cards.length} fixtures · ${assets.size} embedded assets · ${[...new Set(gaps)].length} capture gaps. JavaScript application behavior is represented by recorded states/replays, not the original application.</p><input type="search" id="search" placeholder="Filter components" aria-label="Filter components"><div id="cards"></div></main>
<script>const assets=${json(sharedAssets)};const cards=${json(cards)};const container=document.getElementById('cards');cards.sort((a,b)=>Number(!!b.recording)-Number(!!a.recording));
cards.forEach((c,n)=>{const d=document.createElement('details');d.dataset.name=c.name.toLowerCase();const s=document.createElement('summary');s.textContent=c.name+(c.recording?' · recorded motion':'');d.append(s);let built=false;d.addEventListener('toggle',()=>{if(!d.open||built)return;built=true;const p=document.createElement('p');p.className='note';p.textContent=c.selector;d.append(p);const controls=document.createElement('div');controls.className='controls';const pair=document.createElement('div');pair.className='pair';const live=document.createElement('div');live.className='viewport';const f=document.createElement('iframe');f.title=c.name;f.sandbox='allow-scripts';f.width=c.rect.w;f.height=c.rect.h;f.srcdoc=c.html.replace(/__CB_ASSET_(\\d+)__/g,(_,i)=>assets[Number(i)]);live.append(f);const evidence=document.createElement('div');const img=document.createElement('img');img.src='data:image/png;base64,'+c.source;img.alt='Source capture: '+c.name;evidence.append(img);pair.append(live,evidence);const send=(action,value)=>f.contentWindow.postMessage({type:'cb-fixture',action,value},'*');['play','pause'].forEach(action=>{const b=document.createElement('button');b.textContent=action;b.onclick=()=>send(action);controls.append(b);});const scrub=document.createElement('input');scrub.type='range';scrub.min=0;scrub.max=100;scrub.value=0;scrub.ariaLabel='Scrub captured motion';scrub.oninput=()=>send('scrub',Number(scrub.value)/100);controls.append(scrub);c.states.forEach(state=>{const b=document.createElement('button');b.textContent=state;b.onclick=()=>send('state',state);controls.append(b);});const note=document.createElement('p');note.className='note';note.textContent=c.fixture+' · '+c.gaps.join(' ');d.append(controls,pair,note);new ResizeObserver(()=>{const scale=Math.min(1,live.clientWidth/c.rect.w);f.style.transform='scale('+scale+')';live.style.height=(c.rect.h*scale)+'px';}).observe(live);});container.append(d);if(n<3)d.open=true;});document.getElementById('search').oninput=e=>{for(const d of container.children)d.hidden=!d.dataset.name.includes(e.target.value.toLowerCase());};</script></html>`;
  writeFileSync(join(outdir,"preview","components-discovered.html"),gallery);
  const uniqueGaps = [...new Set(gaps)];
  writeFileSync(join(outdir,"source","components.capture.json"),JSON.stringify({$schema:"cb-design-dna/components.capture@v1",styles,fontFaces:faces,components:captures,embeddedAssets:assets.size,gaps:uniqueGaps})+"\n");
  const result = { count: cards.length, embeddedAssets: assets.size, preview: "preview/components-discovered.html", capture: "source/components.capture.json", gaps: uniqueGaps };
  log("portable fixtures",result.count,"embedded assets",result.embeddedAssets,"gaps",uniqueGaps.length);
  return result;
}
