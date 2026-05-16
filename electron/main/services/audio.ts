import type { AudioConfig } from "../audio-config-store";
import type { AppContext } from "../context";

export function publicAudioConfig(ctx: AppContext) {
  const cfg = ctx.audioConfigStore.read();
  const { apiKey: _k, ...rest } = cfg;
  return {
    ...rest,
    apiKeySet: cfg.apiKey.trim().length > 0,
    localReady: false,
    clockVoiceAccess: { allowed: true, reason: "allowed" },
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
