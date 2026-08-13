"use strict";

const path = require("node:path");
const fs = require("node:fs");

/* ═══════════════════════════════════════════════════════════════════════════
   CARREGADOR DO better-sqlite3
   ═══════════════════════════════════════════════════════════════════════════

   O Codebrain abre o mesmo banco a partir de dois runtimes com ABIs
   diferentes:

   • Electron (processo main)     — NODE_MODULE_VERSION do Electron
   • Node do sistema (MCP stdio)  — NODE_MODULE_VERSION do Node instalado

   O binário em `node_modules` só serve a um deles. `scripts/prebuild-native.mjs`
   guarda uma cópia com ABI de Node do sistema em `resources/native/`, e este
   loader escolhe a que funciona: tenta o padrão, e só em erro de ABI cai para
   a cópia.

   Extraído de `store.js` para que os testes carreguem o SQLite pelo mesmo
   caminho que a produção — sem isto, `vitest` roda no Node do sistema e
   esbarra no binário compilado para Electron.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Mensagens que caracterizam incompatibilidade de ABI (e não outro erro). */
const ABI_ERROR_PATTERNS = [
  "NODE_MODULE_VERSION",
  "was compiled against",
  "not a valid Win32 application",
  "is not a valid Win32 application",
  "The specified module could not be found",
  "ERR_DLOPEN_FAILED",
];

function isAbiMismatch(err) {
  const message = String(err?.message ?? err);
  return ABI_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Onde procurar o binário com ABI de Node do sistema. */
function bindingCandidates() {
  return [
    // Empacotado: resources/native/ ao lado do app.
    process.resourcesPath
      ? path.join(process.resourcesPath, "native", "better_sqlite3.node")
      : null,
    // Dev: <projeto>/resources/native/
    path.join(__dirname, "..", "..", "resources", "native", "better_sqlite3.node"),
  ].filter(Boolean);
}

let cached = null;

/**
 * Resolve um construtor Database utilizável neste runtime.
 * Resultado memoizado — a checagem envolve abrir bancos de teste.
 *
 * @returns {new (filename: string, options?: object) => any}
 */
function loadDatabase() {
  if (cached) return cached;

  // 1. Binário padrão. Funciona quando o ABI bate (dev sob Electron).
  try {
    const DefaultDatabase = require("better-sqlite3");
    new DefaultDatabase(":memory:").close(); // teste de fumaça
    cached = DefaultDatabase;
    return cached;
  } catch (err) {
    // Erro que não é de ABI é problema real — propaga em vez de mascarar.
    if (!isAbiMismatch(err)) throw err;
  }

  // 2. Cópia prebuilt com ABI de Node do sistema.
  for (const bindingPath of bindingCandidates()) {
    if (!fs.existsSync(bindingPath)) continue;
    try {
      const Database = require("better-sqlite3");
      new Database(":memory:", { nativeBinding: bindingPath }).close();

      // Embrulho que sempre injeta o nativeBinding correto.
      function DatabaseWithBinding(filename, options) {
        return new Database(filename, { ...options, nativeBinding: bindingPath });
      }
      DatabaseWithBinding.prototype = Database.prototype;

      cached = DatabaseWithBinding;
      return cached;
    } catch {
      // Este candidato também não serve — tenta o próximo.
      continue;
    }
  }

  throw new Error(
    "better-sqlite3: ABI incompatível e nenhum binário de Node do sistema encontrado " +
      "em resources/native/. Rode 'npm run prebuild:native' antes de buildar.",
  );
}

module.exports = { loadDatabase, isAbiMismatch };
