// @vitest-environment node

/* Testes da verificação visual de front-end.

   Fixtures REAIS em disco (projeto Laravel/Django falso, repositório git de
   verdade, servidor HTTP efêmero) porque o valor destes módulos está
   inteiramente em ler projeto real: um mock de `fs` validaria o mock. Duas
   regressões foram pegas exatamente assim durante a implementação — `app/
   page.tsx` que não resolvia para `/`, e classe utilitária vazando como
   marcador de texto. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";

import {
  classifyChange,
  configuredPorts,
  detectFrameworks,
  detectServers,
  djangoRoutes,
  laravelRoutes,
  mapRoutes,
  nextRoutes,
  probePort,
  svelteKitRoutes,
} from "./verify-project.js";

import {
  discoverDeclaredCredentials,
  findLoginRoutes,
  looksLikeHash,
  rankForFeature,
  readDeclaredPassword,
  readEnvKeys,
  scrubRow,
} from "./verify-auth.js";

import { changedFiles, extractMarkers, slugForRoute } from "./verify-handlers.js";
import { isLocalTarget } from "../../memory/verify-store.js";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

let ROOT;
const LARAVEL = () => path.join(ROOT, "laravel");
const DJANGO = () => path.join(ROOT, "dj");
const REPO = () => path.join(ROOT, "repo");

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "codebrain-verify-"));

  // Laravel
  write("laravel/artisan", "#!/usr/bin/env php\n");
  write("laravel/composer.json", JSON.stringify({ require: { "laravel/framework": "^11" } }));
  write("laravel/resources/views/admin/panel.blade.php", "<h1>Painel</h1>");
  write("laravel/resources/views/motorista/ganhos.blade.php", "<h1>Ganhos</h1>");
  write("laravel/routes/web.php", [
    "<?php",
    "Route::view('/painel', 'admin.panel');",
    "Route::get('/motorista/ganhos', [GanhosController::class, 'index']);",
  ].join("\n"));
  write("laravel/app/Http/Controllers/GanhosController.php", [
    "<?php",
    "class GanhosController {",
    "  public function index() { return view('motorista.ganhos'); }",
    "}",
  ].join("\n"));
  write("laravel/database/seeders/DatabaseSeeder.php", [
    "<?php",
    "class DatabaseSeeder {",
    "  public function run() {",
    "    User::create(['email' => 'admin@teste.local', 'password' => 'segredo-dev', 'role' => 'admin']);",
    "    User::create(['email' => 'hash@teste.local', 'password' => bcrypt('naopega')]);",
    "  }",
    "}",
  ].join("\n"));
  write("laravel/.env", "APP_URL=http://localhost:8123\nDB_CONNECTION=sqlite\nDB_DATABASE=database/db.sqlite\nDB_PASSWORD=naodevesair\n");

  // Django
  write("dj/manage.py", "#!/usr/bin/env python\n");
  write("dj/app/templates/app/relatorio.html", "<h1>Relatorio</h1>");
  write("dj/app/views.py", "def relatorio(request):\n    return render(request, 'app/relatorio.html')\n");
  write("dj/app/urls.py", "urlpatterns = [\n    path('relatorios/', relatorio, name='relatorio'),\n]\n");

  // Repositório git com uma alteração de front-end não commitada.
  fs.mkdirSync(REPO(), { recursive: true });
  const g = (args) => execFileSync("git", args, { cwd: REPO(), encoding: "utf-8", windowsHide: true });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t.t"]);
  g(["config", "user.name", "t"]);
  write("repo/src/components/Panel.tsx", "export const Panel = () => <div></div>;\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "base"]);
  write("repo/src/components/Panel.tsx", [
    "export const Panel = () => (",
    "  <div className='flex items-center gap-2 rounded-lg'>",
    "    <h1>Painel do motorista</h1>",
    "    <span>{total}</span>",
    "    <button aria-label='Abrir ganhos do dia'>Ver ganhos</button>",
    "  </div>",
    ");",
  ].join("\n"));
  write("repo/novo.tsx", "<p>novo arquivo</p>");
});

afterAll(() => {
  if (ROOT) fs.rmSync(ROOT, { recursive: true, force: true });
});

/* ── Classificação ─────────────────────────────────────────────────────── */

describe("classifyChange", () => {
  it.each([
    ["resources/views/admin/panel.blade.php", "frontend"],
    ["src/components/Card.tsx", "frontend"],
    ["resources/sass/app.scss", "frontend"],
    ["src/lib/format.ts", "frontend"],
    ["scripts/build-exe.js", "backend"],
    ["app/Http/Controllers/PanelController.php", "render"],
    ["myapp/urls.py", "render"],
    ["myapp/models.py", "backend"],
    ["node_modules/react/index.js", "ignored"],
    ["package-lock.json", "ignored"],
    ["src/components/Card.test.tsx", "ignored"],
  ])("%s → %s", (file, kind) => {
    expect(classifyChange(file).kind).toBe(kind);
  });
});

/* ── Rotas por sistema de arquivos ─────────────────────────────────────── */

describe("nextRoutes", () => {
  it.each([
    ["app/dashboard/page.tsx", "/dashboard"],
    ["app/page.tsx", "/"],
    ["app/(marketing)/pricing/page.tsx", "/pricing"],
    ["pages/users/[id].tsx", "/users/:id"],
    ["pages/index.tsx", "/"],
  ])("%s → %s", (file, route) => {
    expect(nextRoutes(file)[0]?.route).toBe(route);
  });

  it("rota de API não é página", () => {
    expect(nextRoutes("pages/api/hook.ts")).toHaveLength(0);
  });
});

describe("svelteKitRoutes", () => {
  it("resolve pelo caminho", () => {
    expect(svelteKitRoutes("src/routes/conta/+page.svelte")[0].route).toBe("/conta");
  });
});

/* ── Rotas heurísticas ─────────────────────────────────────────────────── */

describe("laravelRoutes", () => {
  it("resolve blade citada direto numa rota, com confiança alta", () => {
    const [hit] = laravelRoutes(LARAVEL(), "resources/views/admin/panel.blade.php");
    expect(hit).toMatchObject({ route: "/painel", confidence: "high" });
    expect(hit.evidence).toContain("web.php");
  });

  it("resolve pelo controller em dois saltos, com confiança média", () => {
    const [hit] = laravelRoutes(LARAVEL(), "resources/views/motorista/ganhos.blade.php");
    expect(hit).toMatchObject({ route: "/motorista/ganhos", confidence: "medium" });
  });
});

describe("djangoRoutes", () => {
  it("vai do template à view e da view ao path", () => {
    expect(djangoRoutes(DJANGO(), "app/templates/app/relatorio.html")[0].route).toBe("/relatorios/");
  });
});

describe("detectFrameworks", () => {
  it("reconhece laravel e django pelos marcos do projeto", () => {
    expect(detectFrameworks(LARAVEL()).frameworks).toContain("laravel");
    expect(detectFrameworks(DJANGO()).frameworks).toContain("django");
  });
});

describe("configuredPorts", () => {
  it("lê a porta do APP_URL antes de cair no padrão", () => {
    expect(configuredPorts(LARAVEL(), ["laravel"])[0]).toBe(8123);
  });
});

describe("mapRoutes", () => {
  it("deriva rota do front-end e ignora backend", () => {
    const res = mapRoutes({
      root: LARAVEL(),
      files: ["resources/views/admin/panel.blade.php", "app/Models/User.php", "node_modules/x/y.js"],
      frameworks: ["laravel"],
    });
    expect(res.routes.map((r) => r.route)).toContain("/painel");
    expect(res.anyFrontend).toBe(true);
    expect(res.files.find((f) => f.file.includes("Models")).routes).toHaveLength(0);
  });

  it("cai na home quando nada resolve, e rotula isso como fallback", () => {
    const res = mapRoutes({ root: ROOT, files: ["src/components/Solto.tsx"], frameworks: [] });
    expect(res.routes[0]).toMatchObject({ route: "/", confidence: "fallback" });
  });

  it("alteração só de backend não gera alvo nenhum", () => {
    const res = mapRoutes({ root: ROOT, files: ["app/Models/User.php"], frameworks: ["laravel"] });
    expect(res.anyFrontend).toBe(false);
    expect(res.routes).toHaveLength(0);
  });
});

/* ── Acesso: o que pode e o que não pode sair ──────────────────────────── */

describe("descoberta de credencial", () => {
  it("acha a credencial declarada no seeder sem devolver o valor", () => {
    const creds = discoverDeclaredCredentials(LARAVEL(), ["laravel"]);
    expect(creds.map((c) => c.identity)).toContain("admin@teste.local");
    expect(JSON.stringify(creds)).not.toContain("segredo-dev");
  });

  it("ignora senha passada por função de hash", () => {
    const creds = discoverDeclaredCredentials(LARAVEL(), ["laravel"]);
    expect(creds.map((c) => c.identity)).not.toContain("hash@teste.local");
  });

  it("a leitura interna devolve a senha, e só a partir da procedência correta", () => {
    const creds = discoverDeclaredCredentials(LARAVEL(), ["laravel"]);
    const ref = creds.find((c) => c.identity === "admin@teste.local");
    expect(readDeclaredPassword(LARAVEL(), "admin@teste.local", ref)).toBe("segredo-dev");
    // Referência inventada não produz credencial.
    expect(readDeclaredPassword(LARAVEL(), "admin@teste.local", { file: ref.file, line: 999 })).toBeNull();
  });
});

describe("readEnvKeys", () => {
  it("entrega configuração e recusa chave de segredo", () => {
    const env = readEnvKeys(LARAVEL(), ["DB_CONNECTION", "DB_PASSWORD"]);
    expect(env.DB_CONNECTION).toBe("sqlite");
    expect(env.DB_PASSWORD).toBeUndefined();
  });
});

describe("findLoginRoutes", () => {
  it("cai na convenção do framework quando nada é declarado", () => {
    expect(findLoginRoutes(LARAVEL(), ["laravel"])[0].route).toBe("/login");
  });
});

describe("scrubRow", () => {
  it("remove segredo por nome de coluna e por forma do valor", () => {
    const out = scrubRow({
      id: 1,
      email: "a@b.c",
      role: "admin",
      password: "$2y$10$" + "a".repeat(53),
      remember_token: "xyz",
      custom_field: "$argon2id$v=19$m=1",
    });
    expect(out).toEqual({ id: 1, email: "a@b.c", role: "admin" });
  });
});

describe("looksLikeHash", () => {
  it.each([
    ["$2y$10$" + "b".repeat(53), true],
    ["pbkdf2_sha256$600000$abc$def", true],
    ["Painel do motorista", false],
  ])("%s → %s", (value, expected) => {
    expect(looksLikeHash(value)).toBe(expected);
  });
});

describe("rankForFeature", () => {
  const users = [
    { id: 1, email: "admin@x.com", role: "admin" },
    { id: 2, email: "motorista@x.com", role: "motorista" },
    { id: 3, email: "inativo@x.com", role: "motorista", is_active: false },
  ];

  it("prefere o papel do contexto da feature ao admin", () => {
    const ranked = rankForFeature({ users, featureContext: "tela de ganhos do motorista" });
    expect(ranked[0].identity).toBe("motorista@x.com");
    expect(ranked[0].why.join(" ")).toContain("motorista");
  });

  it("joga usuário inativo para o fim", () => {
    const ranked = rankForFeature({ users, featureContext: "motorista" });
    expect(ranked.at(-1).identity).toBe("inativo@x.com");
  });

  it("sem contexto, o administrativo lidera", () => {
    const ranked = rankForFeature({
      users: [{ id: 1, email: "u@x.com", role: "user" }, { id: 2, email: "a@x.com", is_superuser: true }],
      featureContext: "",
    });
    expect(ranked[0].identity).toBe("a@x.com");
  });
});

describe("isLocalTarget", () => {
  it.each([
    ["http://127.0.0.1:8000", true],
    ["http://localhost:3000", true],
    ["http://192.168.0.10:8080", true],
    ["http://10.1.2.3", true],
    ["https://app.cliente.com", false],
    ["não é url", false],
  ])("%s → %s", (url, expected) => {
    expect(isLocalTarget(url)).toBe(expected);
  });
});

/* ── git: o que mudou e o que procurar na tela ─────────────────────────── */

describe("extractMarkers", () => {
  it("extrai frase visível e descarta sintaxe", () => {
    const markers = extractMarkers(REPO(), null);
    expect(markers).toContain("Painel do motorista");
    expect(markers).toContain("Abrir ganhos do dia");
    expect(markers.some((m) => m.includes("items-center"))).toBe(false);
    expect(markers.some((m) => m.includes("{total}"))).toBe(false);
  });
});

describe("changedFiles", () => {
  it("vê modificação e arquivo novo ainda não rastreado", () => {
    const files = changedFiles(REPO(), null);
    expect(files).toContain("src/components/Panel.tsx");
    expect(files).toContain("novo.tsx");
  });
});

describe("slugForRoute", () => {
  it("gera nome de arquivo estável para o print", () => {
    expect(slugForRoute("/motorista/ganhos")).toBe("motorista_ganhos");
    expect(slugForRoute("/")).toBe("root");
  });
});

/* ── Servidor: palpite versus prova ────────────────────────────────────── */

describe("detectServers", () => {
  let server;
  let port;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>Painel do motorista</title></head><body>ok</body></html>");
    });
    // Porta 0 = efêmera: um número fixo tornaria o teste dependente do que já
    // está rodando na máquina.
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  afterAll(() => server?.close());

  it("prova a porta viva e lê o título da página", async () => {
    const res = await detectServers(ROOT, [], [port]);
    const live = res.live.find((l) => l.port === port);
    expect(live).toMatchObject({ responds: true, status: 200, title: "Painel do motorista" });
    expect(live.baseUrl).toBe(`http://127.0.0.1:${port}`);
  });

  it("porta fechada não entra como viva", async () => {
    expect(await probePort(port + 1, "127.0.0.1", 200)).toBe(false);
  });
});
