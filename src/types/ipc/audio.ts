export interface AudioConfig {
  provider: string;
  baseUrl: string;
  model: string;
  language: string;
  prompt: string;
  outputMode: string;
  chunkMs: number;
  captureMode: string;
  interactionMode: string;
  targetWpm: number;
  apiKeySet: boolean;
  localReady: boolean;
  clockVoiceAccess: { allowed: boolean; reason: string };
}

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}
