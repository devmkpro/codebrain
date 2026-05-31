import * as fs from "node:fs";
import * as path from "node:path";

export const AUDIO_DEFAULTS = {
  provider: "groq" as "groq" | "local",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "",
  model: "whisper-large-v3",
  localBinaryPath: "",
  localModelPath: "",
  localInstallDir: "",
  language: "pt",
  prompt:
    "Codebrain, Claude, Codex, Groq, MCP, Supabase, pnpm, TypeScript, React, Electron, workspace, pane.",
  chunkMs: 2800,
  outputMode: "english" as "english" | "original",
  captureMode: "hold" as "hold" | "toggle",
  interactionMode: "coding" as "coding" | "planning" | "conversation",
  targetWpm: 150,
};

export type AudioConfig = typeof AUDIO_DEFAULTS;

export function clampChunkMs(v: number): number {
  if (!Number.isFinite(v)) return AUDIO_DEFAULTS.chunkMs;
  return Math.max(1100, Math.min(6000, Math.round(v)));
}

export function clampTargetWpm(v: number): number {
  if (!Number.isFinite(v)) return AUDIO_DEFAULTS.targetWpm;
  return Math.max(80, Math.min(240, Math.round(v)));
}

function isConversationMode(mode: string): boolean {
  return mode === "conversation" || mode === "planning";
}

export function normalizeAudioConfig(cfg: AudioConfig): AudioConfig {
  return {
    ...cfg,
    outputMode: isConversationMode(cfg.interactionMode) ? "original" : "english",
  };
}

export class AudioConfigStore {
  constructor(private readonly filePath: string) {}

  read(): AudioConfig {
    try {
      if (!fs.existsSync(this.filePath)) return { ...AUDIO_DEFAULTS };
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AudioConfig>;
      const merged: AudioConfig = {
        ...AUDIO_DEFAULTS,
        ...parsed,
        chunkMs: clampChunkMs((parsed.chunkMs as number) ?? AUDIO_DEFAULTS.chunkMs),
        targetWpm: clampTargetWpm((parsed.targetWpm as number) ?? AUDIO_DEFAULTS.targetWpm),
      };
      return normalizeAudioConfig(merged);
    } catch {
      return { ...AUDIO_DEFAULTS };
    }
  }

  write(cfg: AudioConfig): void {
    const normalized = normalizeAudioConfig({
      ...cfg,
      chunkMs: clampChunkMs(cfg.chunkMs),
      targetWpm: clampTargetWpm(cfg.targetWpm),
    });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(normalized, null, 2), "utf-8");
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {}
  }
}
