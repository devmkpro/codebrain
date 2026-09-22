"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICAÇÃO VISUAL — DESCOBERTA DE ACESSO
   ═══════════════════════════════════════════════════════════════════════════

   Para ver uma página autenticada, o agente precisa entrar. O jeito errado
   de resolver isso é óbvio e tentador: ler `.env`, pegar o hash, tentar uma
   lista de senhas comuns, devolver credencial no resultado da tool. Cada um
   desses passos transforma uma ferramenta de verificação num vazamento.

   As regras deste módulo, e o motivo de cada uma:

   1. O MODELO NUNCA RECEBE UMA SENHA. Nenhuma função aqui devolve segredo em
      valor de retorno — o que sai é `credentialAvailable: true|false` e a
      PROCEDÊNCIA. Resultado de tool vira transcript, transcript vira log, e
      log de agente não é lugar de credencial.

   2. Só dois modos de login existem:
      • `seeder`  — a credencial está declarada no seeder/fixture DO PRÓPRIO
        REPOSITÓRIO. É texto versionado, escrito para desenvolvimento, e é
        lido no instante de digitar no formulário. Não é armazenada, não é
        devolvida, não é logada.
      • `manual`  — ninguém achou credencial de desenvolvimento, então o
        agente abre a tela de login e ESPERA o usuário autenticar no painel
        Browser. É o caminho do "pedir acesso": o humano digita, o agente
        continua na sessão que sobrou.
      Não existe um terceiro modo. Em particular não existe tentar senha.

   3. NUNCA se tenta adivinhar senha. Sem lista, sem variação, sem "admin123".
      Isso é credential stuffing contra o banco do próprio usuário, e o fato
      de ser local não muda o que é.

   4. Hash nunca sai daqui. As colunas que parecem hash são removidas antes
      de qualquer retorno, mesmo sendo hash de banco de desenvolvimento.

   5. Alvo é sempre loopback. Esta ferramenta verifica o que está rodando na
      máquina do desenvolvedor. Autenticar contra host remoto é outro
      problema, com outro risco, e este módulo se recusa a participar dele.

   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { listFiles } = require("./verify-project.js");

/** Colunas que carregam segredo e são removidas de qualquer retorno. */
const SECRET_COLUMNS = [
  "password", "password_hash", "remember_token", "api_token", "secret",
  "two_factor_secret", "two_factor_recovery_codes", "totp_secret",
];

/** Um valor com cara de hash não é devolvido nem que a coluna se disfarce. */
function looksLikeHash(value) {
  if (typeof value !== "string") return false;
  return (
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value) ||       // bcrypt
    /^\$argon2[id]{1,2}\$/.test(value) ||                        // argon2
    /^pbkdf2_[a-z0-9]+\$\d+\$/.test(value) ||                    // django
    /^[a-f0-9]{32,128}$/i.test(value)                            // md5/sha cru
  );
}

/** Remove segredo de uma linha de banco antes de ela virar resultado de tool. */
function scrubRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (SECRET_COLUMNS.includes(String(key).toLowerCase())) continue;
    if (looksLikeHash(value)) continue;
    out[key] = value;
  }
  return out;
}

/* ── Rota de login ─────────────────────────────────────────────────────── */

/**
 * Onde é a tela de login. Procura de verdade nas rotas do projeto antes de
 * chutar o caminho convencional.
 * @param {string} root
 * @param {string[]} frameworks
 */
function findLoginRoutes(root, frameworks) {
  const out = [];
  const add = (route, evidence, confidence = "medium") => {
    if (!out.some((o) => o.route === route)) out.push({ route, evidence, confidence });
  };

  if (frameworks.includes("laravel")) {
    for (const rel of ["routes/web.php", "routes/auth.php"]) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue;
      let text;
      try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
      for (const hit of text.matchAll(/Route::\w+\(\s*['"]([^'"]*login[^'"]*)['"]/gi)) {
        add("/" + hit[1].replace(/^\/+/, ""), `${rel}: rota de login declarada`, "high");
      }
      // Breeze/Fortify/Jetstream registram /login sem aparecer em web.php.
      if (/Fortify|Breeze|Jetstream/i.test(text)) add("/login", `${rel}: starter kit de auth detectado`);
    }
    if (out.length === 0) add("/login", "convenção do Laravel");
  }

  if (frameworks.includes("django")) {
    const urlFiles = listFiles(root, ".py", 4).filter((f) => /urls\.py$/.test(f.replace(/\\/g, "/")));
    for (const file of urlFiles) {
      let text;
      try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
      for (const hit of text.matchAll(/path\(\s*['"]([^'"]*login[^'"]*)['"]/gi)) {
        add("/" + hit[1].replace(/^\/+/, ""), `${path.basename(file)}: path de login`, "high");
      }
      if (/admin\.site\.urls/.test(text)) add("/admin/login/", "django.contrib.admin habilitado", "high");
    }
    if (out.length === 0) add("/accounts/login/", "convenção do Django");
  }

  return out;
}

/* ── Credenciais declaradas no repositório ─────────────────────────────────
   Seeder e fixture são código versionado, escritos para desenvolvimento. É a
   única fonte de senha que este módulo aceita além do próprio usuário.      */

const IDENTITY_RE = /['"]([\w.+-]+@[\w.-]+\.\w{2,}|admin|root|test|user)['"]/i;

/**
 * Varre seeders/fixtures procurando pares identidade + senha declarados.
 *
 * Devolve APENAS a procedência — arquivo, linha, identidade. A senha fica
 * fora do retorno por construção; quem precisa dela chama
 * `readDeclaredPassword`, que é usado dentro do handler no instante de
 * preencher o formulário.
 *
 * @param {string} root
 * @param {string[]} frameworks
 */
function discoverDeclaredCredentials(root, frameworks) {
  const found = [];
  const searchDirs = [];

  if (frameworks.includes("laravel")) {
    searchDirs.push(path.join(root, "database", "seeders"), path.join(root, "database", "factories"));
  }
  if (frameworks.includes("django")) {
    searchDirs.push(path.join(root, "fixtures"));
    // Comandos de management costumam criar o superuser de desenvolvimento.
    for (const f of listFiles(root, ".py", 5)) {
      if (/management[\\/]commands[\\/]/.test(f)) searchDirs.push(path.dirname(f));
    }
  }

  const files = [...new Set(searchDirs.flatMap((dir) => listFiles(dir, null, 3)))]
    .filter((f) => /\.(php|py|json|ya?ml)$/i.test(f));

  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      // Uma linha que ATRIBUI senha literal. Hash e chamada de função não contam:
      // bcrypt($x) não me dá nada para digitar.
      const pwd = lines[i].match(/['"]?password['"]?\s*(?:=>|[:=])\s*['"]([^'"]{3,80})['"]/i);
      if (!pwd) continue;
      if (/^\$|^\{\{|bcrypt|Hash::|make_password|\bfaker\b/i.test(pwd[1])) continue;

      // A identidade costuma estar na vizinhança imediata.
      let identity = null;
      for (let j = Math.max(0, i - 6); j <= Math.min(lines.length - 1, i + 6); j++) {
        const m = lines[j].match(IDENTITY_RE);
        if (m) { identity = m[1]; break; }
      }
      if (!identity) continue;

      found.push({
        identity,
        source: "seeder",
        file: path.relative(root, file).replace(/\\/g, "/"),
        line: i + 1,
        credentialAvailable: true,
      });
    }
  }

  // Mesma identidade declarada em dois seeders: o primeiro basta.
  const seen = new Set();
  return found.filter((f) => {
    const key = f.identity.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Lê a senha declarada para uma identidade, do arquivo versionado.
 *
 * USO INTERNO. O valor vai direto para o preenchimento do formulário e não
 * entra em retorno de tool, em memória compartilhada nem em log. Está numa
 * função separada justamente para que esse limite seja visível em revisão.
 *
 * @returns {string|null}
 */
function readDeclaredPassword(root, identity, credentialRef) {
  if (!credentialRef?.file || !credentialRef?.line) return null;
  const file = path.join(root, credentialRef.file);
  if (!fs.existsSync(file)) return null;
  let lines;
  try { lines = fs.readFileSync(file, "utf-8").split("\n"); } catch { return null; }
  const line = lines[credentialRef.line - 1];
  if (!line) return null;
  const m = line.match(/['"]?password['"]?\s*(?:=>|[:=])\s*['"]([^'"]{3,80})['"]/i);
  return m ? m[1] : null;
}

/* ── Usuários no banco local ───────────────────────────────────────────────
   Duas estratégias, na ordem em que são seguras e baratas:

   1. SQLite: leitura direta do arquivo com o `node:sqlite` embutido. Não
      executa nada do projeto.
   2. Outro driver: a CLI DO PRÓPRIO FRAMEWORK, que já sabe a configuração e
      as credenciais sem que este código precise lê-las. `method` sempre diz
      qual caminho foi usado, porque bootar o app é efeito colateral e o
      usuário tem o direito de saber que aconteceu.                          */

/** Lê chaves não-secretas do .env. Valor de senha nunca é retornado. */
function readEnvKeys(root, keys) {
  const file = path.join(root, ".env");
  const out = {};
  if (!fs.existsSync(file)) return out;
  let text;
  try { text = fs.readFileSync(file, "utf-8"); } catch { return out; }
  for (const key of keys) {
    if (/password|secret|token|key$/i.test(key)) continue; // barreira explícita
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, "m"));
    if (m) out[key] = m[1].trim();
  }
  return out;
}

function querySqlite(dbFile, sql) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
}

/**
 * Lista usuários e papéis do banco LOCAL de desenvolvimento.
 * @param {{ root: string, frameworks: string[], allowFrameworkCli?: boolean, limit?: number }} args
 */
function listDbUsers({ root, frameworks, allowFrameworkCli = true, limit = 25 }) {
  const notes = [];

  if (frameworks.includes("laravel")) {
    const env = readEnvKeys(root, ["DB_CONNECTION", "DB_DATABASE"]);
    if ((env.DB_CONNECTION || "").toLowerCase() === "sqlite") {
      const dbFile = env.DB_DATABASE && path.isAbsolute(env.DB_DATABASE)
        ? env.DB_DATABASE
        : path.join(root, env.DB_DATABASE || "database/database.sqlite");
      if (fs.existsSync(dbFile)) {
        try {
          const rows = querySqlite(dbFile, `SELECT * FROM users LIMIT ${Number(limit) || 25}`);
          return { ok: true, method: "sqlite-direct", users: rows.map(scrubRow), notes };
        } catch (e) { notes.push(`sqlite direto falhou: ${e.message}`); }
      } else {
        notes.push("DB_CONNECTION=sqlite mas o arquivo do banco não existe — rode as migrations");
      }
    }
    if (!allowFrameworkCli) {
      return { ok: false, error: "banco não-sqlite exige allow_framework_cli=true (roda `php artisan`, o que boota a aplicação)", notes };
    }
    // Sem shell: argumentos vão direto ao processo, então não há escape a errar.
    const snippet =
      "echo json_encode(DB::table('users')->limit(" + (Number(limit) || 25) + ")->get());";
    try {
      const out = execFileSync("php", ["artisan", "tinker", "--execute", snippet], {
        cwd: root, encoding: "utf-8", timeout: 30000, windowsHide: true,
      });
      const json = out.slice(out.indexOf("["), out.lastIndexOf("]") + 1);
      const rows = JSON.parse(json);
      return { ok: true, method: "php artisan tinker (aplicação bootada)", users: rows.map(scrubRow), notes };
    } catch (e) {
      return { ok: false, error: `artisan tinker falhou: ${e.message}`, method: "php artisan tinker", notes };
    }
  }

  if (frameworks.includes("django")) {
    if (!allowFrameworkCli) {
      return { ok: false, error: "Django exige allow_framework_cli=true (roda `manage.py shell`)", notes };
    }
    const snippet = [
      "import json",
      "from django.contrib.auth import get_user_model",
      "U = get_user_model()",
      "f = ['id', U.USERNAME_FIELD, 'is_staff', 'is_superuser', 'is_active']",
      "rows = list(U.objects.values(*[x for x in dict.fromkeys(f)])[:" + (Number(limit) || 25) + "])",
      "for r in rows: r['groups'] = list(U.objects.get(pk=r['id']).groups.values_list('name', flat=True))",
      "print(json.dumps(rows, default=str))",
    ].join("\n");
    for (const py of ["python", "python3", "py"]) {
      try {
        const out = execFileSync(py, ["manage.py", "shell", "-c", snippet], {
          cwd: root, encoding: "utf-8", timeout: 30000, windowsHide: true,
        });
        const json = out.slice(out.indexOf("["), out.lastIndexOf("]") + 1);
        return { ok: true, method: `${py} manage.py shell`, users: JSON.parse(json).map(scrubRow), notes };
      } catch (e) { notes.push(`${py}: ${e.message.split("\n")[0]}`); }
    }
    return { ok: false, error: "nenhum interpretador Python conseguiu rodar manage.py shell", notes };
  }

  return { ok: false, error: "listagem de usuários só é suportada em Laravel e Django", notes };
}

/* ── Escolha do papel ──────────────────────────────────────────────────────
   "Um login de admin ou de um papel que faça sentido no contexto da feature"
   é uma decisão, não um lookup. O que este código faz é pontuar e MOSTRAR o
   porquê; a escolha final é do agente, com o ranking na mão.                */

/** Campos de uma linha de usuário que podem indicar papel. */
const ROLE_FIELDS = ["role", "roles", "type", "user_type", "profile", "groups", "is_staff", "is_superuser", "is_admin"];

/** Sinais de papel administrativo, por valor. */
const ADMIN_SIGNALS = ["admin", "administrator", "superuser", "super-admin", "owner", "root", "staff", "gestor", "gerente"];

/**
 * Ordena candidatos pelo encaixe no contexto da feature.
 *
 * `featureContext` é texto livre — o título da tarefa, o resumo do diff. As
 * palavras dele são comparadas com os papéis do usuário: uma feature de
 * "painel do motorista" prefere um usuário com papel `driver`/`motorista` a
 * um admin, porque é a tela DELE que mudou.
 *
 * @param {{ users: object[], featureContext?: string }} args
 */
function rankForFeature({ users, featureContext = "" }) {
  const words = String(featureContext)
    .toLowerCase()
    .split(/[^a-z0-9á-úà-ùâ-ûã-õç]+/i)
    .filter((w) => w.length >= 4);

  const ranked = (users || []).map((user) => {
    const roleValues = [];
    for (const field of ROLE_FIELDS) {
      const v = user[field];
      if (v === undefined || v === null) continue;
      if (typeof v === "boolean") { if (v) roleValues.push(field); continue; }
      if (Array.isArray(v)) { roleValues.push(...v.map(String)); continue; }
      if (typeof v === "number") { roleValues.push(`${field}=${v}`); continue; }
      roleValues.push(String(v));
    }
    const roleText = roleValues.join(" ").toLowerCase();

    let score = 0;
    const why = [];

    const contextHit = words.find((w) => roleText.includes(w));
    if (contextHit) { score += 50; why.push(`papel casa com "${contextHit}" do contexto da feature`); }

    const adminHit = ADMIN_SIGNALS.find((s) => roleText.includes(s));
    if (adminHit) { score += 20; why.push(`papel administrativo (${adminHit})`); }

    if (user.is_active === false || user.active === false) { score -= 100; why.push("usuário inativo"); }

    const identity = user.email || user.username || user.name || (user.id != null ? `id:${user.id}` : "(sem identidade)");
    return { identity, roles: roleValues, score, why: why.length ? why : ["nenhum sinal de papel encontrado"], user };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

module.exports = {
  findLoginRoutes,
  discoverDeclaredCredentials,
  readDeclaredPassword,
  listDbUsers,
  rankForFeature,
  scrubRow,
  looksLikeHash,
  readEnvKeys,
  SECRET_COLUMNS,
  ADMIN_SIGNALS,
};
