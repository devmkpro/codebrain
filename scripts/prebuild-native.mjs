#!/usr/bin/env node

/**
 * prebuild-native.mjs
 *
 * Copies the system Node.js-compiled better-sqlite3 native binary to
 * resources/native/ so it survives the electron-builder rebuild.
 *
 * Problem: electron-builder rebuilds better-sqlite3 for Electron's ABI,
 * overwriting the system Node.js binary. The MCP stdio server runs with
 * system Node.js and needs the system ABI binary.
 *
 * Solution: Copy the working binary BEFORE electron-builder runs.
 * Then store.js falls back to this binary when the default one fails.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/**
 * Confere se o binário abre no Node que está rodando este script.
 *
 * O script antes copiava cego: se `node_modules` já contivesse o binário
 * recompilado para Electron (o que acontece depois de qualquer build ou
 * `electron-rebuild`), ele copiava esse para resources/native/ e o app
 * publicava um "fallback de Node do sistema" que não abre em Node nenhum.
 * O sintoma aparece longe daqui — o servidor MCP stdio morre com
 * NODE_MODULE_VERSION — então vale falhar aqui, alto e cedo.
 */
function loadsUnderCurrentNode(binaryPath) {
  try {
    // dlopen valida o ABI direto, sem depender do wrapper JS do pacote.
    process.dlopen({ exports: {} }, binaryPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const srcBinary = path.join(
  projectRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);

const destDir = path.join(projectRoot, "resources", "native");
const destBinary = path.join(destDir, "better_sqlite3.node");

try {
  if (!fs.existsSync(srcBinary)) {
    console.error(
      "[prebuild-native] Source binary not found:",
      srcBinary
    );
    console.error(
      "[prebuild-native] Run 'npm install' first to compile better-sqlite3."
    );
    process.exit(1);
  }

  // Verificação de ABI antes de copiar. Este script roda sob o Node do
  // sistema, que é exatamente o runtime que o binário precisa atender.
  const check = loadsUnderCurrentNode(srcBinary);
  if (!check.ok) {
    // Antes de bloquear: se resources/native já tem um binário válido de uma
    // rodada anterior, mantê-lo é melhor que abortar o build. Só falhamos
    // quando não há nenhuma cópia boa — aí copiar seria publicar lixo.
    if (fs.existsSync(destBinary) && loadsUnderCurrentNode(destBinary).ok) {
      console.warn("[prebuild-native] node_modules está com o binário de ABI do Electron.");
      console.warn("[prebuild-native] Mantendo o binário válido que já está em resources/native/.");
      const stats = fs.statSync(destBinary);
      console.warn(`[prebuild-native]   ${destBinary} (${(stats.size / 1024).toFixed(1)}KB)`);
      process.exit(0);
    }

    console.error("[prebuild-native] O binário em node_modules NÃO abre no Node do sistema.");
    console.error(`[prebuild-native]   node ${process.version} (NODE_MODULE_VERSION ${process.versions.modules})`);
    console.error(`[prebuild-native]   erro: ${check.error}`);
    console.error("[prebuild-native]");
    console.error("[prebuild-native] Provavelmente ele foi recompilado para o ABI do Electron por um");
    console.error("[prebuild-native] build anterior. Copiar assim publicaria um fallback quebrado e o");
    console.error("[prebuild-native] servidor MCP stdio morreria com NODE_MODULE_VERSION em campo.");
    console.error("[prebuild-native]");
    console.error("[prebuild-native] Corrija com:  npm rebuild better-sqlite3 --build-from-source");
    console.error("[prebuild-native] (e rode 'npx electron-rebuild' depois, para o dev voltar a funcionar)");
    process.exit(1);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(srcBinary, destBinary);

  const stats = fs.statSync(destBinary);
  console.log(
    `[prebuild-native] Copied better-sqlite3 binary (${(stats.size / 1024).toFixed(1)}KB)`
  );
  console.log(`[prebuild-native]   from: ${srcBinary}`);
  console.log(`[prebuild-native]   to:   ${destBinary}`);
} catch (err) {
  console.error("[prebuild-native] Failed:", err.message);
  process.exit(1);
}
