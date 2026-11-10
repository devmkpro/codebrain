// Resolve an existing runtime only. No install, browser download or server start.
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadBrowserRuntime() {
  const here = dirname(fileURLToPath(import.meta.url));
  const explicit = process.env.CB_DESIGN_PLAYWRIGHT_MODULE;
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error("CB_DESIGN_PLAYWRIGHT_MODULE must be an absolute module path.");
    const runtime = createRequire(import.meta.url)(explicit);
    if (!runtime.chromium?.launch) throw new Error("The supplied runtime has no Chromium launch capability.");
    return runtime;
  }
  for (const base of [join(here, ".."), process.cwd()]) {
    const require = createRequire(join(base, "package.json"));
    try { return require("playwright"); } catch {}
  }
  throw new Error("Playwright is not available. Supply an existing runtime via CB_DESIGN_PLAYWRIGHT_MODULE or explicitly authorize installing the skill's declared dependency and browser. Nothing was installed.");
}
