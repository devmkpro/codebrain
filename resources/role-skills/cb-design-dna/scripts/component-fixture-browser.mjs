// Portable DOM/native-animation serialization; discovery stays in harvest-components.mjs.
export function installFixtureCapture() {
  const styles = [], styleIds = new Map();
  const box = (el) => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; };
  const intern = (css) => {
    if (!styleIds.has(css)) { styleIds.set(css, styles.length); styles.push(css); }
    return "cb-s" + styleIds.get(css);
  };
  const safeStyle = (cs, variables) => [...cs].filter((p) =>
    !p.startsWith("animation") && !p.startsWith("transition") &&
    (variables === undefined || p.startsWith("--") === variables))
    .map((p) => `${p}:${cs.getPropertyValue(p)};`).join("");

  function snapshot(id) {
    const root = document.querySelector(id);
    if (!root?.isConnected) return null;
    const rect = box(root), nodes = [], animations = [], pseudo = [], gaps = [];
    const sourceNodes = [root, ...root.querySelectorAll("*")];
    const map = new Map(sourceNodes.map((el, n) => [el, "n" + n]));
    for (const a of root.getAnimations({ subtree: true })) {
      const target = a.effect?.target;
      if (!map.has(target)) continue;
      const timing = a.effect.getTiming();
      animations.push({ target: map.get(target), keyframes: a.effect.getKeyframes(), timing: { ...timing, iterations: timing.iterations === Infinity ? "infinite" : timing.iterations },
        currentTime: typeof a.currentTime === "number" ? a.currentTime : 0, playState: a.playState, confidence: "observed" });
    }
    function clone(el, isRoot = false) {
      if (el.nodeType === Node.TEXT_NODE) return document.createTextNode(el.textContent);
      if (el.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|LINK|META|IFRAME|OBJECT|EMBED)$/.test(el.tagName)) return null;
      let copy = el.cloneNode(false);
      for (const attr of [...copy.attributes]) {
        if (/^on/i.test(attr.name) || ["srcset", "action", "formaction", "integrity", "nonce", "autoplay"].includes(attr.name) ||
            (attr.name === "href" && !attr.value.startsWith("#"))) copy.removeAttribute(attr.name);
      }
      if (el.tagName === "IMG") copy.setAttribute("src", el.currentSrc || el.src);
      if (el.tagName === "CANVAS") {
        try { copy = document.createElement("img"); copy.src = el.toDataURL(); gaps.push("Canvas pixels captured as a still; renderer not reproduced."); }
        catch { gaps.push("Canvas could not be serialized."); }
      }
      if (el.tagName === "VIDEO") { gaps.push("Video playback is not part of the component fixture."); copy.removeAttribute("src"); }
      if (el.tagName === "SOURCE") copy.removeAttribute("src");
      if (el.tagName === "INPUT" && el.type === "password") copy.removeAttribute("value");
      const cs = getComputedStyle(el);
      // A site's inherited token set can dwarf its element styles. Share it
      // independently so every animated frame does not duplicate those tokens.
      copy.setAttribute("class", intern(safeStyle(cs, false)) + " " + intern(safeStyle(cs, true)));
      copy.setAttribute("data-node", map.get(el));
      // IDs stay local to the standalone iframe (SVG paint servers need them).
      copy.setAttribute("style", "animation:none!important;transition:none!important;" + (isRoot
        ? `position:relative;inset:auto;margin:0;width:${cs.width};height:${cs.height};` : ""));
      nodes.push({ id: map.get(el), tag: el.tagName.toLowerCase(), text: el.children.length ? "" : el.textContent.slice(0,120),
        style: Object.fromEntries(["color", "background-color", "background-image", "border-color", "box-shadow", "outline", "opacity", "transform", "filter", "backdrop-filter", "font-size", "border-radius"].map((p) => [p, cs.getPropertyValue(p)])) });
      for (const part of ["::before", "::after"]) {
        const ps = getComputedStyle(el, part);
        if (ps.content && !["none", "normal", '""'].includes(ps.content)) pseudo.push(`[data-node="${map.get(el)}"]${part}{${safeStyle(ps)}}`);
      }
      for (const child of el.childNodes) { const c = clone(child); if (c) copy.append(c); }
      return copy;
    }
    const html = clone(root, true).outerHTML;
    if (getComputedStyle(root).backdropFilter !== "none") gaps.push("This surface needs a backdrop outside its own DOM; compare against the source screenshot.");
    return { html, nodes, animations, pseudo, box: rect, backdrop: getComputedStyle(document.body).backgroundColor,
      text: root.textContent.trim(), gaps: [...new Set(gaps)], confidence: "observed" };
  }
  async function record(id, durationMs, stepMs) {
    const start = performance.now(), frames = [];
    let next = start;
    await new Promise((done) => {
      let stopped = false;
      const deadline = setTimeout(() => { stopped = true; done(); }, durationMs + stepMs * 2);
      const tick = (now) => {
        if (stopped) return;
        if (now >= next) {
          const frame = snapshot(id);
          if (frame) frames.push({ at: Math.round(now - start), ...frame });
          next = now + stepMs;
        }
        if (now - start >= durationMs) { clearTimeout(deadline); stopped = true; done(); }
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (frames.length) { const origin = frames[0].at; frames.forEach((f) => f.at -= origin); }
    return { durationMs, stepMs, frames, confidence: "observed", kind: "recorded-dom-and-native-animation", note: "Observed component replay, not the original application logic." };
  }
  function fontFaces() {
    const faces = [];
    const walk = (rules, base) => {
      for (const r of rules) {
        if (r.type === CSSRule.FONT_FACE_RULE) faces.push(r.cssText.replace(/url\(["']?([^"')]+)["']?\)/g, (_, url) => `url("${new URL(url, base).href}")`));
        else if (r.cssRules) walk(r.cssRules, base);
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, sheet.href || location.href); } catch {} }
    return [...new Set(faces)];
  }
  window.__cbFixtureCapture = { snapshot, record, fontFaces, styles: () => styles };
}
