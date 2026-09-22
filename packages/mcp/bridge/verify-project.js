"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICAÇÃO VISUAL — DETECÇÃO DE PROJETO, SERVIDOR E ROTAS
   ═══════════════════════════════════════════════════════════════════════════

   Este módulo responde três perguntas antes de qualquer navegador abrir:

   1. Que projeto é este?      (Laravel, Django, Next, Vite/SPA, Nuxt…)
   2. Onde ele está servindo?  (porta viva + URL base)
   3. Que PÁGINAS a alteração desta sessão pode ter mexido?

   A terceira é a única difícil, e é onde mora a honestidade deste código:
   mapear arquivo → rota é heurística em todo framework que não usa
   roteamento por sistema de arquivos. Então nada aqui devolve certeza: cada
   candidato sai com `confidence` e com a `evidence` que o justificou — a
   linha de `routes/web.php`, a entrada de `urls.py`, o caminho do App
   Router. Um agente que receba isso pode decidir o que abrir; um agente que
   recebesse uma lista sem procedência abriria a página errada e diria que
   verificou.

   Nada aqui executa o projeto nem toca em rede além de um probe TCP/HTTP em
   loopback.

   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");

/* ── Classificação de arquivo ──────────────────────────────────────────────
   O gatilho da verificação visual é "houve alteração de front-end". Isso não
   é só extensão: um controller Laravel que troca a variável passada para a
   view muda a página, e um `urls.py` muda qual página existe. Por isso há
   três classes, não duas — `render` é o backend que produz HTML e também
   merece um olhar na página.                                                */

const FRONTEND_EXT = new Set([
  ".tsx", ".jsx", ".vue", ".svelte", ".astro",
  ".css", ".scss", ".sass", ".less", ".styl",
  ".html", ".htm",
]);

/** `.js`/`.ts` só contam como front-end dentro de um diretório de UI. */
const AMBIGUOUS_EXT = new Set([".js", ".ts", ".mjs", ".cjs"]);

const UI_DIR_HINTS = [
  "src/", "app/", "pages/", "components/", "layouts/", "views/",
  "resources/js/", "resources/views/", "resources/css/", "resources/sass/",
  "templates/", "static/", "assets/", "public/", "styles/", "theme/",
];

/** Caminhos que produzem HTML no servidor. */
const RENDER_HINTS = [
  "resources/views/",      // blade
  "templates/",            // django / jinja
  "app/http/controllers/", // laravel
  "views.py", "urls.py",   // django
  "routes/web.php", "routes/",
];

const IGNORE_SEGMENTS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage",
  "__pycache__", ".venv", "venv", "vendor", "storage", ".cache",
]);

/**
 * Classifica um caminho relativo do repositório.
 * @param {string} relPath
 * @returns {{ kind: "frontend"|"render"|"backend"|"ignored", reason: string }}
 */
function classifyChange(relPath) {
  const p = String(relPath).replace(/\\/g, "/");
  const lower = p.toLowerCase();

  for (const seg of p.split("/")) {
    if (IGNORE_SEGMENTS.has(seg)) return { kind: "ignored", reason: `dentro de ${seg}` };
  }
  // Lockfile mexe em dependência, não em tela.
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock)$/.test(lower)) {
    return { kind: "ignored", reason: "lockfile" };
  }
  if (/\.(test|spec)\.[a-z]+$/.test(lower) || /(^|\/)tests?\//.test(lower)) {
    return { kind: "ignored", reason: "arquivo de teste" };
  }

  const ext = path.posix.extname(lower);

  // Blade é .blade.php — extname devolve .php, então checa antes.
  if (lower.endsWith(".blade.php")) return { kind: "frontend", reason: "template blade" };

  if (FRONTEND_EXT.has(ext)) return { kind: "frontend", reason: `extensão ${ext}` };

  if (AMBIGUOUS_EXT.has(ext)) {
    const hint = UI_DIR_HINTS.find((h) => lower.includes(h));
    if (hint) return { kind: "frontend", reason: `${ext} em ${hint}` };
    return { kind: "backend", reason: `${ext} fora de diretório de UI` };
  }

  const renderHint = RENDER_HINTS.find((h) => lower.includes(h));
  if (renderHint) return { kind: "render", reason: `produz HTML (${renderHint})` };

  if (ext === ".php" || ext === ".py" || ext === ".rb" || ext === ".go" || ext === ".rs") {
    return { kind: "backend", reason: `código de servidor (${ext})` };
  }

  return { kind: "ignored", reason: "não afeta interface" };
}

/* ── Detecção de framework ─────────────────────────────────────────────── */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

/**
 * Que frameworks vivem neste repositório. Devolve lista porque um monorepo
 * Laravel + Vite é o caso comum, não a exceção.
 * @param {string} root
 * @returns {{ frameworks: string[], packageJson: object|null, evidence: Record<string,string> }}
 */
function detectFrameworks(root) {
  const frameworks = [];
  const evidence = {};
  const pkg = readJson(path.join(root, "package.json"));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  if (exists(root, "artisan") && exists(root, "composer.json")) {
    frameworks.push("laravel");
    evidence.laravel = "artisan + composer.json";
  }
  if (exists(root, "manage.py")) {
    frameworks.push("django");
    evidence.django = "manage.py";
  }
  if (deps.next) { frameworks.push("next"); evidence.next = "dependência next"; }
  if (deps.nuxt || deps.nuxt3) { frameworks.push("nuxt"); evidence.nuxt = "dependência nuxt"; }
  if (deps["@sveltejs/kit"]) { frameworks.push("sveltekit"); evidence.sveltekit = "dependência @sveltejs/kit"; }
  if (deps.expo) { frameworks.push("expo"); evidence.expo = "dependência expo"; }
  if (deps.vite && !deps.next && !deps.nuxt) { frameworks.push("vite"); evidence.vite = "dependência vite"; }
  if (deps["react-scripts"]) { frameworks.push("cra"); evidence.cra = "dependência react-scripts"; }

  return { frameworks, packageJson: pkg, evidence };
}

/* ── Detecção de servidor ──────────────────────────────────────────────────
   Duas etapas deliberadamente separadas: PALPITE (ler config) e PROVA
   (bater na porta). Um palpite sem prova faz o agente tirar print de
   connection-refused e chamar isso de regressão.                           */

/** Portas padrão por framework, em ordem de probabilidade. */
const DEFAULT_PORTS = {
  laravel: [8000, 80],
  django: [8000],
  next: [3000],
  nuxt: [3000],
  sveltekit: [5173],
  vite: [5173, 4173],
  cra: [3000],
  expo: [8081, 19006],
};

/** Lê a porta declarada em config, quando houver. Não estoura se não houver. */
function configuredPorts(root, frameworks) {
  const ports = [];
  const push = (value) => {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !ports.includes(n)) ports.push(n);
  };

  // APP_URL do Laravel, e um .env genérico com PORT.
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    try {
      // Lê só as chaves de URL/porta. Nada de segredo é extraído ou devolvido.
      const text = fs.readFileSync(envPath, "utf-8");
      const appUrl = text.match(/^\s*APP_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
      if (appUrl) {
        const m = appUrl.match(/:(\d{2,5})(\/|$)/);
        if (m) push(m[1]);
      }
      const port = text.match(/^\s*(?:PORT|VITE_PORT|SERVER_PORT)\s*=\s*"?(\d{2,5})"?/m)?.[1];
      if (port) push(port);
    } catch { /* .env ilegível não é motivo para falhar a detecção */ }
  }

  // vite.config.* costuma trazer server.port literal.
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const m = fs.readFileSync(file, "utf-8").match(/port\s*:\s*(\d{2,5})/);
      if (m) push(m[1]);
    } catch { /* ignora */ }
  }

  for (const fw of frameworks) for (const p of DEFAULT_PORTS[fw] || []) push(p);
  return ports;
}

/** A porta aceita conexão? Probe TCP puro, com timeout curto. */
function probePort(port, host = "127.0.0.1", timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

/** GET na raiz para saber se responde HTTP e com que status/título. */
function probeHttp(port, host = "127.0.0.1", timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => { if (body.length < 4096) body += chunk; });
      res.on("end", () => {
        resolve({
          ok: true,
          status: res.statusCode,
          title: body.match(/<title[^>]*>([^<]{0,120})/i)?.[1]?.trim() || null,
          server: res.headers["server"] || null,
          poweredBy: res.headers["x-powered-by"] || null,
        });
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
  });
}

/**
 * Descobre servidores de desenvolvimento vivos neste projeto.
 *
 * Só loopback: esta ferramenta existe para verificar o que o desenvolvedor
 * está rodando na própria máquina. Um alvo remoto seria outro problema, com
 * outro risco, e não é resolvido aqui.
 *
 * @param {string} root
 * @param {string[]} frameworks
 * @param {number[]} [extraPorts]
 */
async function detectServers(root, frameworks, extraPorts = []) {
  const candidates = [...new Set([...extraPorts, ...configuredPorts(root, frameworks)])];
  const live = [];
  for (const port of candidates) {
    if (!(await probePort(port))) continue;
    const httpInfo = await probeHttp(port);
    live.push({
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      responds: httpInfo.ok === true,
      status: httpInfo.status ?? null,
      title: httpInfo.title ?? null,
      hint: httpInfo.poweredBy || httpInfo.server || null,
      error: httpInfo.ok ? null : httpInfo.error,
    });
  }
  return { candidates, live };
}

/* ── Mapeamento arquivo → rota ─────────────────────────────────────────────
   Por framework, do mais determinístico para o mais heurístico.            */

/** Next App Router / Pages Router: o caminho É a rota. Confiança alta. */
function nextRoutes(relPath) {
  const p = relPath.replace(/\\/g, "/");
  // O segmento é opcional: `app/page.tsx` é a raiz e não tem diretório entre
  // `app/` e o arquivo.
  let m = p.match(/(?:^|\/)app\/(?:(.*)\/)?(page|layout)\.(tsx|ts|jsx|js)$/);
  if (m) {
    const segments = (m[1] || "")
      .split("/")
      .filter(Boolean)
      // (grupo) é organizacional e não aparece na URL.
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, ":$1*").replace(/^\[(.+)\]$/, ":$1"));
    const route = "/" + segments.join("/");
    return [{ route: route === "/" ? "/" : route.replace(/\/+$/, ""), confidence: "high", evidence: "Next App Router: caminho do arquivo" }];
  }
  m = p.match(/(?:^|\/)pages\/(.*)\.(tsx|ts|jsx|js)$/);
  if (m && !m[1].startsWith("api/") && !m[1].startsWith("_")) {
    let route = "/" + m[1].replace(/\/index$/, "").replace(/^index$/, "");
    route = route.replace(/\[\.\.\.(.+?)\]/g, ":$1*").replace(/\[(.+?)\]/g, ":$1");
    return [{ route: route === "/" ? "/" : route.replace(/\/+$/, ""), confidence: "high", evidence: "Next Pages Router: caminho do arquivo" }];
  }
  return [];
}

/** SvelteKit: `src/routes/x/+page.svelte` → `/x`. */
function svelteKitRoutes(relPath) {
  const p = relPath.replace(/\\/g, "/");
  const m = p.match(/(?:^|\/)src\/routes\/(.*)\/\+page\.svelte$/);
  if (!m) {
    if (/(?:^|\/)src\/routes\/\+page\.svelte$/.test(p)) {
      return [{ route: "/", confidence: "high", evidence: "SvelteKit: rota raiz" }];
    }
    return [];
  }
  const route = "/" + m[1].split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/");
  return [{ route, confidence: "high", evidence: "SvelteKit: caminho do arquivo" }];
}

/**
 * Laravel: `resources/views/admin/users/index.blade.php` → nome de view
 * `admin.users.index`. Procura esse nome em routes/*.php e devolve o URI da
 * rota que o referencia. Quando só um controller referencia a view, procura
 * o controller nas rotas — dois saltos, confiança menor.
 */
function laravelRoutes(root, relPath) {
  const p = relPath.replace(/\\/g, "/");
  const m = p.match(/resources\/views\/(.+)\.blade\.php$/);
  if (!m) return [];
  const viewName = m[1].replace(/\//g, ".");
  const out = [];

  const routeFiles = ["routes/web.php", "routes/admin.php"]
    .map((f) => path.join(root, f))
    .filter((f) => fs.existsSync(f));

  for (const file of routeFiles) {
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
    // Route::get('/uri', fn () => view('nome')) e Route::view('/uri', 'nome')
    const direct = new RegExp(
      `Route::(?:get|view)\\(\\s*['"]([^'"]*)['"][^;]*?['"]${viewName.replace(/\./g, "\\.")}['"]`,
      "g",
    );
    for (const hit of text.matchAll(direct)) {
      out.push({
        route: "/" + hit[1].replace(/^\/+/, ""),
        confidence: "high",
        evidence: `${path.basename(file)}: rota referencia view('${viewName}')`,
      });
    }
  }

  if (out.length === 0) {
    // Salto pelo controller: quem renderiza esta view?
    const controllersDir = path.join(root, "app", "Http", "Controllers");
    const controllers = listFiles(controllersDir, ".php", 4);
    for (const controller of controllers) {
      let text;
      try { text = fs.readFileSync(controller, "utf-8"); } catch { continue; }
      if (!text.includes(`'${viewName}'`) && !text.includes(`"${viewName}"`)) continue;
      const className = path.basename(controller, ".php");
      for (const file of routeFiles) {
        let routeText;
        try { routeText = fs.readFileSync(file, "utf-8"); } catch { continue; }
        const usage = new RegExp(`Route::\\w+\\(\\s*['"]([^'"]*)['"][^;]*${className}`, "g");
        for (const hit of routeText.matchAll(usage)) {
          out.push({
            route: "/" + hit[1].replace(/^\/+/, ""),
            confidence: "medium",
            evidence: `${className} renderiza '${viewName}'; rota em ${path.basename(file)}`,
          });
        }
      }
    }
  }

  return dedupeRoutes(out);
}

/**
 * Django: `templates/app/foo.html` → procura o template em views.py para
 * achar o nome da view, e o nome da view em urls.py para achar o path.
 */
function djangoRoutes(root, relPath) {
  const p = relPath.replace(/\\/g, "/");
  const m = p.match(/templates\/(.+\.html)$/);
  if (!m) return [];
  const templateName = m[1];
  const out = [];

  const viewFiles = listFiles(root, ".py", 4).filter((f) => /views\.py$/.test(f.replace(/\\/g, "/")));
  const urlFiles = listFiles(root, ".py", 4).filter((f) => /urls\.py$/.test(f.replace(/\\/g, "/")));

  const viewNames = new Set();
  for (const file of viewFiles) {
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
    if (!text.includes(templateName)) continue;
    // Função ou classe que menciona o template: pega a última definição antes da menção.
    const idx = text.indexOf(templateName);
    const before = text.slice(0, idx);
    const fn = [...before.matchAll(/^\s*(?:def|class)\s+(\w+)/gm)].pop();
    if (fn) viewNames.add(fn[1]);
  }

  for (const file of urlFiles) {
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
    for (const name of viewNames) {
      const usage = new RegExp(`path\\(\\s*['"]([^'"]*)['"][^)]*\\b${name}\\b`, "g");
      for (const hit of text.matchAll(usage)) {
        out.push({
          route: "/" + hit[1].replace(/^\/+/, ""),
          confidence: "medium",
          evidence: `${name} usa ${templateName}; path em ${path.basename(file)}`,
        });
      }
    }
  }

  return dedupeRoutes(out);
}

/**
 * SPA genérica (Vite/CRA/React Router): procura o nome do componente numa
 * configuração de rotas. Confiança baixa por construção — é busca textual.
 */
function spaRoutes(root, relPath) {
  const base = path.basename(relPath).replace(/\.(tsx|jsx|ts|js|vue|svelte)$/, "");
  if (!base || base.length < 3) return [];
  const out = [];
  const candidates = listFiles(path.join(root, "src"), null, 3)
    .filter((f) => /(router|routes|App)\.(tsx|ts|jsx|js|vue)$/i.test(path.basename(f)));

  for (const file of candidates) {
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
    if (!text.includes(base)) continue;
    const near = new RegExp(`path\\s*[:=]\\s*['"]([^'"]*)['"][\\s\\S]{0,200}?${base}`, "g");
    for (const hit of text.matchAll(near)) {
      out.push({
        route: hit[1].startsWith("/") ? hit[1] : `/${hit[1]}`,
        confidence: "low",
        evidence: `${path.basename(file)} associa "${base}" a esta rota (busca textual)`,
      });
    }
  }
  return dedupeRoutes(out);
}

/** Lista arquivos com extensão, ignorando diretórios de build. */
function listFiles(dir, ext, maxDepth) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_SEGMENTS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (!ext || entry.name.endsWith(ext)) out.push(full);
    }
  })(dir, 0);
  return out;
}

function dedupeRoutes(list) {
  const seen = new Map();
  const rank = { high: 3, medium: 2, low: 1 };
  for (const item of list) {
    const prev = seen.get(item.route);
    if (!prev || rank[item.confidence] > rank[prev.confidence]) seen.set(item.route, item);
  }
  return [...seen.values()];
}

/**
 * Rotas candidatas para um conjunto de arquivos alterados.
 *
 * Nunca devolve lista vazia quando há alteração de front-end: cai em `/`
 * com confiança `fallback`, porque abrir a home e comparar é melhor que não
 * abrir nada — e o rótulo diz ao agente que ele está no escuro.
 *
 * @param {{ root: string, files: string[], frameworks: string[] }} args
 */
function mapRoutes({ root, files, frameworks }) {
  const perFile = [];
  let anyFrontend = false;

  for (const file of files) {
    const cls = classifyChange(file);
    if (cls.kind === "ignored" || cls.kind === "backend") {
      perFile.push({ file, kind: cls.kind, reason: cls.reason, routes: [] });
      continue;
    }
    anyFrontend = true;

    let routes = [];
    if (frameworks.includes("next")) routes = routes.concat(nextRoutes(file));
    if (frameworks.includes("sveltekit")) routes = routes.concat(svelteKitRoutes(file));
    if (frameworks.includes("laravel")) routes = routes.concat(laravelRoutes(root, file));
    if (frameworks.includes("django")) routes = routes.concat(djangoRoutes(root, file));
    if (routes.length === 0 && (frameworks.includes("vite") || frameworks.includes("cra"))) {
      routes = spaRoutes(root, file);
    }
    perFile.push({ file, kind: cls.kind, reason: cls.reason, routes: dedupeRoutes(routes) });
  }

  const all = dedupeRoutes(perFile.flatMap((f) => f.routes));
  if (all.length === 0 && anyFrontend) {
    all.push({
      route: "/",
      confidence: "fallback",
      evidence: "nenhuma rota pôde ser derivada dos arquivos alterados; a home é o único alvo seguro",
    });
  }

  return { files: perFile, routes: all, anyFrontend };
}

module.exports = {
  classifyChange,
  detectFrameworks,
  detectServers,
  probePort,
  probeHttp,
  configuredPorts,
  mapRoutes,
  nextRoutes,
  svelteKitRoutes,
  laravelRoutes,
  djangoRoutes,
  spaRoutes,
  listFiles,
  DEFAULT_PORTS,
};
