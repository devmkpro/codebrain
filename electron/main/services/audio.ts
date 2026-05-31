import { spawnSync, execFile } from "node:child_process";
import { promises as fsp, existsSync, readdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { AudioConfig } from "../audio-config-store";
import type { AppContext } from "../context";

const execFileAsync = promisify(execFile);

const WHISPER_BINARY_NAMES = ["whisper-cli", "whisper.cpp", "whisper-cpp", "main"];

/** Default folder where Codebrain expects a self-installed whisper.cpp build + models. */
export function whisperHomeDir(): string {
  return path.join(os.homedir(), ".codebrain-app", "whisper");
}

/** Probe well-known install folders for a whisper.cpp binary (no PATH needed). */
function probeWhisperFolders(extraRoot?: string): string | null {
  const exe = process.platform === "win32";
  const roots = [extraRoot?.trim(), whisperHomeDir()].filter(Boolean) as string[];
  const candidateDirs = roots.flatMap((home) => [
    home,
    path.join(home, "bin"),
    path.join(home, "Release"),
    path.join(home, "build", "bin"),
  ]);
  for (const dir of candidateDirs) {
    for (const name of WHISPER_BINARY_NAMES) {
      const full = path.join(dir, exe ? `${name}.exe` : name);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/** Resolve the whisper.cpp binary: explicit config path, then PATH, then ~/.codebrain-app/whisper. */
export function resolveLocalWhisperBinary(cfg: AudioConfig): string | null {
  const explicit = cfg.localBinaryPath.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const binary of WHISPER_BINARY_NAMES) {
    try {
      const result = spawnSync(
        process.platform === "win32" ? "where" : "command",
        process.platform === "win32" ? [binary] : ["-v", binary],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1200,
          shell: process.platform !== "win32",
        },
      );
      const found = result.stdout?.split(/\r?\n/)[0]?.trim();
      if (result.status === 0 && found && existsSync(found)) return found;
    } catch {
      // ignore probe failures
    }
  }
  return probeWhisperFolders(cfg.localInstallDir);
}

/** Auto-pick a ggml model from the whisper home dir if user didn't configure one. */
export function resolveLocalModel(cfg: AudioConfig): string | null {
  const explicit = cfg.localModelPath.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const roots = [cfg.localInstallDir?.trim(), whisperHomeDir()].filter(Boolean) as string[];
  for (const root of roots) {
    const dir = path.join(root, "models");
    if (!existsSync(dir)) continue;
    try {
      const bins = readdirSync(dir)
        .filter((f) => f.startsWith("ggml-") && f.endsWith(".bin"))
        .sort();
      if (bins.length > 0) return path.join(dir, bins[0]);
    } catch {
      // ignore
    }
  }
  return null;
}

function resolveFfmpeg(): string | null {
  const found = spawnSync(
    process.platform === "win32" ? "where" : "command",
    process.platform === "win32" ? ["ffmpeg"] : ["-v", "ffmpeg"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1200,
      shell: process.platform !== "win32",
    },
  ).stdout?.split(/\r?\n/)[0]?.trim();
  return found && existsSync(found) ? found : null;
}

export interface HardwareInfo {
  cpuModel: string;
  cpuCores: number;
  totalRamGb: number;
  /** "strong" → local recommended; "weak" → Groq recommended. */
  tier: "strong" | "ok" | "weak";
  recommendation: "local" | "groq";
  reason: string;
  recommendedModel: "tiny" | "base" | "small" | "medium" | "large-v3";
}

/** Inspect CPU/RAM and recommend local whisper vs Groq cloud. */
export function detectHardware(): HardwareInfo {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || "unknown CPU";
  const cpuCores = cpus.length || 1;
  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;

  let tier: HardwareInfo["tier"];
  let recommendedModel: HardwareInfo["recommendedModel"];
  if (cpuCores >= 8 && totalRamGb >= 16) {
    tier = "strong";
    recommendedModel = "medium";
  } else if (cpuCores >= 4 && totalRamGb >= 8) {
    tier = "ok";
    recommendedModel = "small";
  } else {
    tier = "weak";
    recommendedModel = "base";
  }

  const recommendation: HardwareInfo["recommendation"] = tier === "weak" ? "groq" : "local";
  const reason =
    tier === "weak"
      ? `${cpuCores} núcleos / ${totalRamGb}GB RAM — hardware modesto. Recomendamos Groq (cloud) para transcrição rápida e sem travar a máquina.`
      : tier === "ok"
        ? `${cpuCores} núcleos / ${totalRamGb}GB RAM — bom para Whisper local com modelo "small".`
        : `${cpuCores} núcleos / ${totalRamGb}GB RAM — ótimo para Whisper local, até modelo "medium" roda fluido.`;

  return { cpuModel, cpuCores, totalRamGb, tier, recommendation, reason, recommendedModel };
}

export interface InstallWhisperArgs {
  targetDir?: string;
  model?: "tiny" | "base" | "small" | "medium" | "large-v3";
}

export interface InstallWhisperResult {
  ok: boolean;
  output?: string;
  error?: string;
  binary?: string | null;
  modelPath?: string | null;
  ffmpeg?: string | null;
  target?: string;
  warnings?: string[];
}

/**
 * Cross-platform install (Windows/Linux/macOS) by importing the Node installer.
 * `onProgress` streams human-readable lines to the renderer.
 */
export async function installWhisper(
  args: InstallWhisperArgs,
  scriptPath: string,
  onProgress?: (line: string) => void,
): Promise<InstallWhisperResult> {
  if (!existsSync(scriptPath)) return { ok: false, error: `installer não encontrado: ${scriptPath}` };
  try {
    const url = process.platform === "win32" ? `file:///${scriptPath.replace(/\\/g, "/")}` : `file://${scriptPath}`;
    const mod: {
      installWhisper: (o: {
        model?: string;
        target?: string;
        onProgress?: (m: string) => void;
      }) => Promise<{
        ok: boolean;
        binary?: string | null;
        model?: string | null;
        ffmpeg?: string | null;
        target?: string;
        warnings?: string[];
      }>;
    } = await import(url);
    const lines: string[] = [];
    const collect = (m: string) => {
      lines.push(m);
      onProgress?.(m);
    };
    const r = await mod.installWhisper({
      model: args.model,
      target: args.targetDir?.trim() || undefined,
      onProgress: collect,
    });
    return {
      ok: r.ok,
      output: lines.join("\n").slice(-6000),
      binary: r.binary ?? null,
      modelPath: r.model ?? null,
      ffmpeg: r.ffmpeg ?? null,
      target: r.target,
      warnings: r.warnings ?? [],
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function publicAudioConfig(ctx: AppContext) {
  const cfg = ctx.audioConfigStore.read();
  const { apiKey: _k, ...rest } = cfg;
  const localReady = Boolean(resolveLocalWhisperBinary(cfg)) && Boolean(resolveLocalModel(cfg));
  const access = { allowed: true, reason: "allowed" };
  return {
    ...rest,
    apiKeySet: cfg.apiKey.trim().length > 0,
    localReady,
    // Store reads `BrainVoiceAccess`; keep `clockVoiceAccess` as a legacy alias.
    BrainVoiceAccess: access,
    clockVoiceAccess: access,
  };
}

export function buildAudioPrompt(outputMode: string, basePrompt: string, context: string): string {
  const parts = [
    outputMode === "english"
      ? "The audio is usually Brazilian Portuguese dictation for a software task. Translate it to clear English without adding commentary."
      : "",
    basePrompt.trim(),
    context
      ? `${outputMode === "english" ? "Previous translated context" : "Previous context"}: ${context}`
      : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 900);
}

export async function transcribeWithGroq(
  args: { bytes: ArrayBuffer | Buffer; mimeType?: string; context?: string },
  cfg: AudioConfig,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!cfg.apiKey.trim()) return { ok: false, error: "groq api key missing" };

  const bytes = Buffer.isBuffer(args.bytes) ? args.bytes : Buffer.from(args.bytes as ArrayBuffer);
  if (bytes.length === 0) return { ok: false, error: "empty audio" };

  const mimeType = args.mimeType || "audio/webm";
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("wav")
        ? "wav"
        : "webm";
  const route = cfg.outputMode === "english" ? "translations" : "transcriptions";
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/audio/${route}`;
  const context = typeof args.context === "string" ? args.context.trim() : "";
  const prompt = buildAudioPrompt(cfg.outputMode, cfg.prompt, context);

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), `codebrain-voice.${ext}`);
  form.append("model", cfg.model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (cfg.outputMode !== "english" && cfg.language.trim())
    form.append("language", cfg.language.trim());
  if (prompt) form.append("prompt", prompt);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `groq ${res.status}: ${body.slice(0, 220)}` };
    }
    const data = (await res.json().catch(() => null)) as { text?: string } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeWithLocal(
  args: { bytes: ArrayBuffer | Buffer; mimeType?: string; context?: string },
  cfg: AudioConfig,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const bytes = Buffer.isBuffer(args.bytes) ? args.bytes : Buffer.from(args.bytes as ArrayBuffer);
  if (bytes.length === 0) return { ok: false, error: "empty audio" };

  const binary = resolveLocalWhisperBinary(cfg);
  if (!binary) return { ok: false, error: "configure whisper.cpp binary path in Voice settings" };

  const modelPath = resolveLocalModel(cfg);
  if (!modelPath)
    return { ok: false, error: "configure local whisper model path in Voice settings" };

  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return { ok: false, error: "ffmpeg not found; required for local voice chunks" };

  const mimeType = args.mimeType || "audio/webm";
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("wav")
        ? "wav"
        : "webm";

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "codebrain-voice-"));
  const inputPath = path.join(dir, `input.${ext}`);
  const wavPath = path.join(dir, "input.wav");
  const outBase = path.join(dir, "transcript");
  const outPath = `${outBase}.txt`;

  try {
    await fsp.writeFile(inputPath, bytes);
    await execFileAsync(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", wavPath],
      { timeout: 20_000, maxBuffer: 256_000 },
    );

    const whisperArgs = [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      cfg.language.trim() || "pt",
      "-otxt",
      "-of",
      outBase,
      "-nt",
      "-np",
    ];
    if (cfg.outputMode === "english") whisperArgs.push("-tr");
    if (cfg.prompt.trim()) whisperArgs.push("--prompt", cfg.prompt.trim().slice(0, 220));

    const result = await execFileAsync(binary, whisperArgs, { timeout: 60_000, maxBuffer: 2_000_000 });
    const output = existsSync(outPath)
      ? await fsp.readFile(outPath, "utf8")
      : `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    return {
      ok: true,
      text: output
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `local whisper failed: ${msg.slice(0, 220)}` };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
