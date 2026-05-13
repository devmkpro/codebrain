import * as fs from "node:fs";
import * as path from "node:path";
import { safeStorage } from "electron";

const ENC_MAGIC = Buffer.from("OC1\0");
const ENCRYPTION_DISABLED = process.env["CODEBRAIN_NO_PROVIDER_ENCRYPTION"] === "1";
const MASKED_SECRET = "********";
const SECRET_ENV_RE = /(API_KEY|AUTH_TOKEN|TOKEN|SECRET|PASSWORD)$/i;

export interface Provider {
  id: string;
  label?: string;
  type?: "oauth" | "api-key" | "env";
  host?: string;
  models?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export const BUILTIN_PROVIDERS: Provider[] = [];

function brokenFlagPath(baseDir: string): string {
  return path.join(baseDir, ".providers-encryption-broken");
}

function markEncryptionBroken(baseDir: string): void {
  try { fs.writeFileSync(brokenFlagPath(baseDir), String(Date.now()), "utf-8"); } catch {}
}

function isEncryptionBroken(baseDir: string): boolean {
  try { return fs.existsSync(brokenFlagPath(baseDir)); } catch { return false; }
}

function encryptionUsable(baseDir: string): boolean {
  if (ENCRYPTION_DISABLED) return false;
  if (isEncryptionBroken(baseDir)) return false;
  return safeStorage.isEncryptionAvailable();
}

function tryDecrypt(buf: Buffer, baseDir: string): string | null {
  if (buf.length <= ENC_MAGIC.length) return null;
  if (!buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const result = safeStorage.decryptString(buf.subarray(ENC_MAGIC.length));
    // Decryption succeeded — clear broken flag if it was set
    try { fs.unlinkSync(brokenFlagPath(baseDir)); } catch {}
    return result;
  } catch (err) {
    console.warn("[providers] safeStorage.decryptString failed:", err);
    markEncryptionBroken(baseDir);
    return null;
  }
}

function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_RE.test(key);
}

function maskProvider(provider: Provider): Provider {
  const env = provider.env
    ? Object.fromEntries(
        Object.entries(provider.env).map(([k, v]) => [k, v && isSecretEnvKey(k) ? MASKED_SECRET : v]),
      )
    : undefined;
  return { ...provider, env };
}

export class ProviderStore {
  private cache: Provider[] = [];
  private suppressNextWatch = false;
  private watcher: fs.FSWatcher | null = null;
  private changeListeners: Array<() => void> = [];
  cliPresence: Record<string, boolean> = { gemini: false, codex: false };

  constructor(private readonly filePath: string) {
    this.load();
    this.startWatching();
  }

  setCliPresence(presence: Record<string, boolean>): void {
    this.cliPresence = { ...presence };
    this.emitChange();
  }

  onChange(cb: () => void): void {
    this.changeListeners.push(cb);
  }

  private emitChange(): void {
    for (const cb of this.changeListeners) {
      try { cb(); } catch {}
    }
  }

  private startWatching(): void {
    try {
      this.watcher = fs.watch(this.filePath, { persistent: false }, () => {
        if (this.suppressNextWatch) { this.suppressNextWatch = false; return; }
        this.load();
        this.emitChange();
      });
    } catch {}
  }

  private get backupPath(): string {
    return this.filePath.replace(/\.json$/, ".backup.json");
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath);
      const baseDir = path.dirname(this.filePath);
      const isEncrypted = raw.length > ENC_MAGIC.length && raw.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC);
      const text = tryDecrypt(raw, baseDir);
      if (text) {
        const parsed = JSON.parse(text);
        this.cache = Array.isArray(parsed) ? parsed : parsed.providers ?? [];
        // Save a plain-text backup for recovery
        try { fs.writeFileSync(this.backupPath, text, "utf-8"); } catch {}
      } else if (isEncrypted) {
        console.warn("[providers] Encrypted file cannot be decrypted — attempting backup recovery");
        this.loadFromBackup();
      } else {
        const parsed = JSON.parse(raw.toString("utf-8"));
        this.cache = Array.isArray(parsed) ? parsed : parsed.providers ?? [];
      }
    } catch {
      this.loadFromBackup();
    }
  }

  private loadFromBackup(): void {
    try {
      const raw = fs.readFileSync(this.backupPath, "utf-8");
      const parsed = JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? parsed : parsed.providers ?? [];
      console.warn("[providers] Recovered from backup:", this.cache.length, "providers");
      // Re-save as plain text so future loads work without backup
      try { fs.writeFileSync(this.filePath, raw, "utf-8"); } catch {}
    } catch {
      this.cache = [];
    }
  }

  private save(): void {
    try {
      const baseDir = path.dirname(this.filePath);
      const json = JSON.stringify(this.cache, null, 2);
      this.suppressNextWatch = true;
      if (encryptionUsable(baseDir)) {
        try {
          const encrypted = safeStorage.encryptString(json);
          const buf = Buffer.concat([ENC_MAGIC, encrypted]);
          fs.writeFileSync(this.filePath, buf);
        } catch (encErr) {
          console.warn("[providers] Encryption failed, falling back to plain text:", encErr);
          markEncryptionBroken(baseDir);
          fs.writeFileSync(this.filePath, json, "utf-8");
        }
      } else {
        fs.writeFileSync(this.filePath, json, "utf-8");
      }
      // Always keep a plain-text backup for recovery
      try { fs.writeFileSync(this.backupPath, json, "utf-8"); } catch {}
    } catch {}
  }

  listPublic(): Provider[] {
    const builtins = [...BUILTIN_PROVIDERS];
    const userProviders = this.cache.filter((p) => !BUILTIN_PROVIDERS.some((b) => b.id === p.id));
    return [...builtins.map(maskProvider), ...userProviders.map(maskProvider)];
  }

  listFull(): Provider[] {
    return [...BUILTIN_PROVIDERS, ...this.cache];
  }

  upsert(provider: Provider): { ok: boolean; error?: string } {
    try {
      const idx = this.cache.findIndex((p) => p.id === provider.id);
      // Preserve real secret values when masked values are sent back from renderer
      if (idx >= 0 && provider.env && this.cache[idx].env) {
        const mergedEnv = { ...provider.env };
        for (const [k, v] of Object.entries(mergedEnv)) {
          if (typeof v === "string" && /^\*+$/.test(v) && this.cache[idx].env![k]) {
            mergedEnv[k] = this.cache[idx].env![k];
          }
        }
        provider = { ...provider, env: mergedEnv };
      }
      if (idx >= 0) this.cache[idx] = provider;
      else this.cache.push(provider);
      this.save();
      this.emitChange();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  remove(id: string): { ok: boolean; error?: string } {
    try {
      this.cache = this.cache.filter((p) => p.id !== id);
      this.save();
      this.emitChange();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  destroy(): void {
    this.watcher?.close();
  }
}
