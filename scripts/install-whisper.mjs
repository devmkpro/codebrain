#!/usr/bin/env node
/**
 * Cross-platform Whisper local installer for Codebrain BrainVoice.
 * Works on Windows, Linux and macOS — uses only Node built-ins.
 *
 * Installs into  ~/.codebrain-app/whisper/  (or a custom --target dir):
 *   bin/<whisper-cli>          (whisper.cpp official prebuilt, when available)
 *   models/ggml-<model>.bin    (ggml model from HuggingFace)
 *
 * Usage (CLI):
 *   node scripts/install-whisper.mjs --model small [--target <dir>]
 *
 * Usage (programmatic, from Electron main):
 *   import { installWhisper } from "../../scripts/install-whisper.mjs";
 *   await installWhisper({ model: "small", onProgress: (p) => ... });
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, chmodSync, renameSync } from "node:fs";
import { rm, mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";

const PLATFORM = process.platform; // 'win32' | 'linux' | 'darwin'
const IS_WIN = PLATFORM === "win32";

export function whisperHomeDir() {
  return path.join(os.homedir(), ".codebrain-app", "whisper");
}

const MODELS = ["tiny", "base", "small", "medium", "large-v3"];

function log(onProgress, msg) {
  if (onProgress) onProgress(msg);
  else process.stdout.write(msg + "\n");
}

/** Follow redirects and download a URL to a file. */
async function download(url, destPath, onProgress, label) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, { headers: { "User-Agent": "codebrain" }, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`download falhou ${res.status} ${current}`);
    const total = Number(res.headers.get("content-length") || 0);
    let received = 0;
    let lastPct = -1;
    const reader = res.body;
    const out = createWriteStream(destPath);
    const ProgressStream = (await import("node:stream")).Transform;
    const tick = new ProgressStream({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (total && onProgress) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            log(onProgress, `[${label}] ${pct}% (${(received / 1e6).toFixed(0)}MB)`);
          }
        }
        cb(null, chunk);
      },
    });
    await pipeline(reader, tick, out);
    return;
  }
  throw new Error(`muitos redirects: ${url}`);
}

function commandExists(name) {
  try {
    const r = spawnSync(IS_WIN ? "where" : "command", IS_WIN ? [name] : ["-v", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
      shell: !IS_WIN,
    });
    const found = r.stdout?.split(/\r?\n/)[0]?.trim();
    return r.status === 0 && found ? found : null;
  } catch {
    return null;
  }
}

/** Pick the right whisper.cpp release asset for the current OS/arch. */
function pickWhisperAsset(assets) {
  const arch = process.arch; // 'x64' | 'arm64'
  const matchers = IS_WIN
    ? [/win.*x64.*\.zip$/i, /bin-x64\.zip$/i, /win.*\.zip$/i]
    : PLATFORM === "darwin"
      ? [new RegExp(`(macos|darwin).*${arch === "arm64" ? "arm64" : "x64"}.*\\.(zip|tar\\.gz)$`, "i"), /(macos|darwin).*\.(zip|tar\.gz)$/i]
      : [new RegExp(`(linux|ubuntu).*${arch === "arm64" ? "arm64" : "x64"}.*\\.(zip|tar\\.gz)$`, "i"), /(linux|ubuntu).*\.(zip|tar\.gz)$/i];
  for (const re of matchers) {
    const a = assets.find((x) => re.test(x.name));
    if (a) return a;
  }
  return null;
}

function extractArchive(archivePath, destDir) {
  if (archivePath.endsWith(".zip")) {
    if (IS_WIN) {
      const r = spawnSync(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`],
        { encoding: "utf8", timeout: 120000 },
      );
      if (r.status !== 0) throw new Error("Expand-Archive falhou: " + (r.stderr || ""));
    } else {
      const r = spawnSync("unzip", ["-o", archivePath, "-d", destDir], { encoding: "utf8", timeout: 120000 });
      if (r.status !== 0) throw new Error("unzip falhou (instale unzip): " + (r.stderr || ""));
    }
  } else if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    const r = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], { encoding: "utf8", timeout: 120000 });
    if (r.status !== 0) throw new Error("tar falhou: " + (r.stderr || ""));
  } else {
    throw new Error("formato de arquivo não suportado: " + archivePath);
  }
}

function findWhisperBinary(dir) {
  const names = IS_WIN
    ? ["whisper-cli.exe", "main.exe", "whisper.exe"]
    : ["whisper-cli", "main", "whisper"];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (names.includes(e.name)) return full;
    }
  }
  return null;
}

/**
 * Main installer. Returns { ok, binary, model, ffmpeg, warnings }.
 * onProgress(msg) is called with human-readable progress lines.
 */
export async function installWhisper(opts = {}) {
  const model = MODELS.includes(opts.model) ? opts.model : "small";
  const root = (opts.target && opts.target.trim()) || whisperHomeDir();
  const onProgress = opts.onProgress;
  const warnings = [];

  const binDir = path.join(root, "bin");
  const modelDir = path.join(root, "models");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(modelDir, { recursive: true });

  log(onProgress, `==> Codebrain Whisper installer (${PLATFORM}/${process.arch})`);
  log(onProgress, `    Destino: ${root}`);

  // ---- 1) whisper.cpp binary ----
  const exeName = IS_WIN ? "whisper-cli.exe" : "whisper-cli";
  let binary = path.join(binDir, exeName);
  if (existsSync(binary)) {
    log(onProgress, `[whisper.cpp] já instalado`);
  } else {
    try {
      log(onProgress, `[whisper.cpp] consultando release oficial...`);
      const rel = await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest", {
        headers: { "User-Agent": "codebrain", accept: "application/vnd.github+json" },
      }).then((r) => r.json());
      const asset = pickWhisperAsset(rel.assets || []);
      if (!asset) throw new Error("nenhum binário pré-compilado para este SO");
      const archivePath = path.join(binDir, asset.name);
      log(onProgress, `[whisper.cpp] baixando ${asset.name}...`);
      await download(asset.browser_download_url, archivePath, onProgress, "whisper.cpp");
      const tmp = await mkdtemp(path.join(os.tmpdir(), "cb-whisper-"));
      extractArchive(archivePath, tmp);
      const found = findWhisperBinary(tmp);
      if (!found) throw new Error("binário não encontrado no zip");
      // copy binary + sibling libs into binDir
      const srcDir = path.dirname(found);
      for (const f of readdirSync(srcDir)) {
        const ext = path.extname(f).toLowerCase();
        if ([".exe", ".dll", ".so", ".dylib", ""].includes(ext) || f === path.basename(found)) {
          try {
            renameSync(path.join(srcDir, f), path.join(binDir, f));
          } catch {
            // cross-device fallback handled by copyFileSync
            const { copyFileSync } = createRequire(import.meta.url)("node:fs");
            copyFileSync(path.join(srcDir, f), path.join(binDir, f));
          }
        }
      }
      if (!existsSync(binary)) {
        const alt = findWhisperBinary(binDir);
        if (alt) binary = alt;
      }
      if (!IS_WIN && existsSync(binary)) chmodSync(binary, 0o755);
      await rm(archivePath, { force: true }).catch(() => {});
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      if (!existsSync(binary)) throw new Error("falha ao instalar whisper-cli");
      log(onProgress, `[whisper.cpp] OK -> ${binary}`);
    } catch (err) {
      // On Linux, prebuilt binaries are often absent — guide to package manager.
      const hint = IS_WIN
        ? ""
        : " Em Linux instale via: 'sudo apt install whisper.cpp' OU compile de github.com/ggml-org/whisper.cpp";
      warnings.push(`whisper.cpp não instalado automaticamente: ${err.message}.${hint}`);
      const onPath = commandExists("whisper-cli") || commandExists("whisper") || commandExists("main");
      if (onPath) {
        binary = onPath;
        log(onProgress, `[whisper.cpp] usando binário do PATH: ${onPath}`);
      } else {
        log(onProgress, `[whisper.cpp] AVISO: ${err.message}${hint}`);
        binary = null;
      }
    }
  }

  // ---- 2) ggml model ----
  const modelFile = path.join(modelDir, `ggml-${model}.bin`);
  if (existsSync(modelFile)) {
    log(onProgress, `[modelo] ggml-${model}.bin já existe`);
  } else {
    log(onProgress, `[modelo] baixando ggml-${model}.bin (pode demorar)...`);
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
    await download(url, modelFile, onProgress, "modelo");
    log(onProgress, `[modelo] OK -> ${modelFile}`);
  }

  // ---- 3) ffmpeg ----
  const ffmpeg = commandExists("ffmpeg");
  if (ffmpeg) {
    log(onProgress, `[ffmpeg] OK: ${ffmpeg}`);
  } else {
    const hint = IS_WIN
      ? "Instale via: winget install Gyan.FFmpeg"
      : PLATFORM === "darwin"
        ? "Instale via: brew install ffmpeg"
        : "Instale via: sudo apt install ffmpeg";
    warnings.push(`ffmpeg não encontrado. ${hint}`);
    log(onProgress, `[ffmpeg] AVISO: não encontrado. ${hint}`);
  }

  log(onProgress, `==> Concluído.`);
  return { ok: true, binary, model: modelFile, ffmpeg: ffmpeg || null, target: root, warnings };
}

// CLI entrypoint
const isMain = (() => {
  try {
    return path.resolve(process.argv[1] || "") === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  installWhisper({ model: get("--model"), target: get("--target") })
    .then((r) => {
      if (r.warnings.length) {
        process.stdout.write("\nAVISOS:\n- " + r.warnings.join("\n- ") + "\n");
      }
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write("ERRO: " + (err?.message || String(err)) + "\n");
      process.exit(1);
    });
}
