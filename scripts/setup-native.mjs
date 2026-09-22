#!/usr/bin/env node

/**
 * setup-native.mjs
 *
 * Deixa os DOIS binários nativos do better-sqlite3 no lugar, na ordem certa.
 *
 * ── Por que dois ────────────────────────────────────────────────────────────
 *
 * O Codebrain abre o mesmo banco a partir de runtimes com ABI diferente:
 *
 *   • processo main do Electron  → NODE_MODULE_VERSION do Electron
 *   • servidor MCP stdio          → NODE_MODULE_VERSION do Node do sistema
 *
 * Um `npm install` resolve só um lado: o `prebuild-install` do better-sqlite3
 * baixa o binário do NODE do sistema. O Electron então não abre o módulo e o
 * app morre no load, antes de qualquer janela:
 *
 *   Error: better-sqlite3: ABI incompatível e nenhum binário de Node do
 *   sistema encontrado em resources/native/
 *
 * ── Por que a ordem importa ─────────────────────────────────────────────────
 *
 * 1. Primeiro copiamos o binário que está em node_modules — que acabou de
 *    chegar do npm e é o de Node do sistema — para `resources/native/`.
 * 2. Só DEPOIS trocamos o de node_modules pelo de ABI do Electron.
 *
 * Invertida, a ordem publica em `resources/native/` um "fallback de Node do
 * sistema" que não abre em Node nenhum, e o sintoma aparece longe daqui: o
 * servidor MCP stdio morre com NODE_MODULE_VERSION em campo.
 *
 * Idempotente: rodar de novo com tudo no lugar não quebra nada —
 * `prebuild-native.mjs` preserva um `resources/native/` já válido, e o
 * download é cacheado.
 *
 * Usa o prebuilt publicado em vez de compilar: não exige Visual Studio nem
 * node-gyp. Se o prebuilt não existir para a combinação, o erro diz como
 * compilar.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function run(label, file, args, cwd) {
  process.stdout.write(`[setup-native] ${label}\n`);
  try {
    const out = execFileSync(file, args, {
      cwd: cwd || projectRoot,
      encoding: "utf-8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (out?.trim()) process.stdout.write(out.replace(/^/gm, "  "));
    return { ok: true };
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    return { ok: false, error: detail || err.message };
  }
}

// ── 1. Snapshot do binário de ABI de Node do sistema ────────────────────────

const step1 = run(
  "copiando o binário de ABI de Node para resources/native/ ...",
  process.execPath,
  [path.join(projectRoot, "scripts", "prebuild-native.mjs")],
);
if (!step1.ok) {
  console.error("[setup-native] falhou ao preparar resources/native/:");
  console.error(step1.error.replace(/^/gm, "  "));
  console.error("[setup-native] rode 'npm install' antes, para o better-sqlite3 existir em node_modules.");
  process.exit(1);
}

// ── 2. Binário de ABI do Electron em node_modules ───────────────────────────

// Versão lida do Electron instalado: fixar aqui apodreceria a cada upgrade.
let electronVersion;
try {
  electronVersion = require("electron/package.json").version;
} catch {
  console.error("[setup-native] electron não está instalado em node_modules — rode 'npm install' primeiro.");
  process.exit(1);
}

const betterSqliteDir = path.join(projectRoot, "node_modules", "better-sqlite3");
const nmBinary = path.join(betterSqliteDir, "build", "Release", "better_sqlite3.node");

function opensUnderThisNode(file) {
  try {
    process.dlopen({ exports: {} }, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * O binário de node_modules já é o do Electron?
 *
 * Checagem em duas pernas, porque "não abre no Node do sistema" sozinho também
 * descreve um arquivo corrompido: ele tem de FALHAR no Node do sistema e ABRIR
 * sob o Electron. Rodar o Electron em modo Node (`ELECTRON_RUN_AS_NODE`) é o
 * único jeito honesto de testar o ABI dele sem abrir janela.
 */
function alreadyElectronAbi() {
  if (!fs.existsSync(nmBinary)) return false;
  if (opensUnderThisNode(nmBinary)) return false;
  let electronExe;
  try {
    electronExe = require("electron");
  } catch {
    return false;
  }
  if (typeof electronExe !== "string" || !fs.existsSync(electronExe)) return false;
  try {
    execFileSync(electronExe, ["-e", "require('better-sqlite3'); process.exit(0)"], {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
      timeout: 30000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

if (alreadyElectronAbi()) {
  console.log("[setup-native] node_modules já está no ABI do Electron — download dispensado.");
} else {
  const prebuildInstall = path.join(projectRoot, "node_modules", "prebuild-install", "bin.js");
  if (!fs.existsSync(prebuildInstall)) {
    console.error("[setup-native] prebuild-install não encontrado; rode 'npm install' primeiro.");
    process.exit(1);
  }

  const step2 = run(
    `baixando o better-sqlite3 de ABI do Electron ${electronVersion} ...`,
    process.execPath,
    [prebuildInstall, "--runtime", "electron", "--target", electronVersion, "--arch", process.arch, "--platform", process.platform],
    betterSqliteDir,
  );
  if (!step2.ok) {
    console.error("[setup-native] não foi possível baixar o prebuilt de ABI do Electron:");
    console.error(step2.error.replace(/^/gm, "  "));
    console.error("[setup-native]");
    if (/EBUSY|EPERM|resource busy|locked/i.test(step2.error)) {
      // Na prática este é o erro mais comum: o app ou o dev server está de pé e
      // mantém o .node carregado, e no Windows um módulo carregado não pode ser
      // sobrescrito.
      console.error("[setup-native] O arquivo está em uso. Feche o Codebrain e pare o 'npm run dev'");
      console.error("[setup-native] (o processo electron mantém o binário carregado) e rode de novo.");
    } else {
      console.error("[setup-native] Alternativa, compilando localmente (exige toolchain de C++):");
      console.error("[setup-native]   npx electron-rebuild -f -w better-sqlite3");
    }
    process.exit(1);
  }
}

// ── 3. Conferir o resultado em vez de confiar nele ──────────────────────────

const nodeAbiBinary = path.join(projectRoot, "resources", "native", "better_sqlite3.node");

const problems = [];
if (!fs.existsSync(nodeAbiBinary)) {
  problems.push("resources/native/better_sqlite3.node não existe");
} else if (!opensUnderThisNode(nodeAbiBinary)) {
  problems.push("resources/native/better_sqlite3.node não abre no Node do sistema (fallback do MCP stdio estaria quebrado)");
}
if (!fs.existsSync(nmBinary)) {
  problems.push("node_modules/better-sqlite3 sem binário compilado");
} else if (opensUnderThisNode(nmBinary)) {
  // Abrir no Node do sistema significa que ele NÃO é de ABI do Electron.
  problems.push("o binário de node_modules ainda é de ABI de Node — o Electron não vai abrir");
}

if (problems.length > 0) {
  console.error("[setup-native] terminou num estado inconsistente:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("[setup-native] pronto:");
console.log(`  node_modules      → ABI do Electron ${electronVersion} (processo main)`);
console.log(`  resources/native  → ABI do Node ${process.version} (servidor MCP stdio e vitest)`);
