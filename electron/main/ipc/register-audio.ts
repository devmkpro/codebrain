import { ipcMain, app } from "electron";
import * as path from "node:path";
import type { AppContext } from "../context";
import type { AudioConfig } from "../audio-config-store";
import {
  publicAudioConfig,
  transcribeWithGroq,
  transcribeWithLocal,
  detectHardware,
  installWhisper,
  type InstallWhisperArgs,
} from "../services/audio";

function whisperInstallerPath(): string {
  // Cross-platform Node installer (.mjs) — works on Windows/Linux/macOS.
  // dev: <repo>/scripts/install-whisper.mjs ; packaged: resources/scripts/install-whisper.mjs
  if (app.isPackaged) return path.join(process.resourcesPath, "scripts", "install-whisper.mjs");
  return path.join(app.getAppPath(), "scripts", "install-whisper.mjs");
}

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
      ...(patch.localBinaryPath !== undefined && { localBinaryPath: patch.localBinaryPath.trim() }),
      ...(patch.localModelPath !== undefined && { localModelPath: patch.localModelPath.trim() }),
      ...(patch.localInstallDir !== undefined && { localInstallDir: patch.localInstallDir.trim() }),
      ...(patch.language !== undefined && { language: patch.language.trim() }),
      ...(patch.prompt !== undefined && { prompt: patch.prompt.trim() }),
      ...(patch.chunkMs !== undefined && { chunkMs: patch.chunkMs }),
      ...(patch.outputMode !== undefined && { outputMode: patch.outputMode }),
      ...(patch.captureMode !== undefined && { captureMode: patch.captureMode }),
      ...(patch.interactionMode !== undefined && { interactionMode: patch.interactionMode }),
      ...(patch.targetWpm !== undefined && { targetWpm: patch.targetWpm }),
    };
    ctx.audioConfigStore.write(next);
    return { ok: true, config: publicAudioConfig(ctx) };
  });

  ipcMain.handle("audio:transcribe", async (_event, args: { bytes: ArrayBuffer; mimeType?: string; context?: string }) => {
    const cfg = ctx.audioConfigStore.read();
    if (cfg.provider === "local") return transcribeWithLocal(args, cfg);
    return transcribeWithGroq(args, cfg);
  });

  ipcMain.handle("audio:hardwareInfo", () => {
    try {
      return { ok: true, hardware: detectHardware() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("audio:installWhisper", async (event, args: InstallWhisperArgs) => {
    const res = await installWhisper(args ?? {}, whisperInstallerPath(), (line) => {
      try {
        event.sender.send("audio:installProgress", line);
      } catch {
        // renderer may have closed
      }
    });
    if (res.ok) {
      // Persist install dir (custom or default) so detection finds it next time.
      const dir = args?.targetDir?.trim() || res.target;
      if (dir) {
        const current = ctx.audioConfigStore.read();
        ctx.audioConfigStore.write({ ...current, localInstallDir: dir, provider: "local" });
      }
      return {
        ok: true,
        output: res.output,
        warnings: res.warnings,
        config: publicAudioConfig(ctx),
      };
    }
    return res;
  });
}
