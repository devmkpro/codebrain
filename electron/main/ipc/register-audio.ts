import { ipcMain } from "electron";
import type { AppContext } from "../context";
import type { AudioConfig } from "../audio-config-store";
import { publicAudioConfig, transcribeWithGroq } from "../services/audio";

export function registerAudioHandlers(ctx: AppContext): void {
  ipcMain.handle("audio:getConfig", () => publicAudioConfig(ctx));

  ipcMain.handle("audio:saveConfig", async (_event, patchInput: Partial<AudioConfig>) => {
    if (!patchInput || typeof patchInput !== "object") return { ok: false, error: "invalid config" };
    const current = ctx.audioConfigStore.read();
    const patch = patchInput as Partial<AudioConfig>;
    const next: AudioConfig = {
      ...current,
      ...(patch.provider !== undefined && { provider: patch.provider }),
      ...(patch.baseUrl !== undefined && { baseUrl: patch.baseUrl.trim() }),
      ...(patch.apiKey !== undefined && !/^\*+$/.test(patch.apiKey) ? { apiKey: patch.apiKey.trim() } : {}),
      ...(patch.model !== undefined && { model: patch.model.trim() }),
      ...(patch.language !== undefined && { language: patch.language.trim() }),
      ...(patch.prompt !== undefined && { prompt: patch.prompt.trim() }),
      ...(patch.chunkMs !== undefined && { chunkMs: patch.chunkMs }),
      ...(patch.captureMode !== undefined && { captureMode: patch.captureMode }),
      ...(patch.interactionMode !== undefined && { interactionMode: patch.interactionMode }),
      ...(patch.targetWpm !== undefined && { targetWpm: patch.targetWpm }),
    };
    ctx.audioConfigStore.write(next);
    return { ok: true, config: publicAudioConfig(ctx) };
  });

  ipcMain.handle("audio:transcribe", async (_event, args: { bytes: ArrayBuffer; mimeType?: string; context?: string }) => {
    const cfg = ctx.audioConfigStore.read();
    if (cfg.provider === "groq") return transcribeWithGroq(args, cfg);
    return { ok: false, error: "local whisper not configured — use Groq provider" };
  });
}
