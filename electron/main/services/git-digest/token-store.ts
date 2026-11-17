/**
 * Tokens do GitLab cifrados pelo chaveiro do sistema (DPAPI no Windows,
 * Keychain no macOS, libsecret/kwallet no Linux). Sem criptografia disponível
 * o token NÃO é gravado: não existe fallback em texto puro.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface TokenSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export interface TokenStoreStatus {
  available: boolean;
  reason?: string;
}

const SAFE_LINUX_BACKENDS = ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"];

export function createTokenStore(filePath: string, safeStorage: TokenSafeStorage, platform: NodeJS.Platform = process.platform) {
  function status(): TokenStoreStatus {
    try {
      if (!safeStorage.isEncryptionAvailable())
        return { available: false, reason: "A criptografia do sistema não está disponível; o token não pode ser salvo." };
      if (platform === "linux") {
        const backend = safeStorage.getSelectedStorageBackend?.() ?? "unknown";
        if (!SAFE_LINUX_BACKENDS.includes(backend))
          return { available: false, reason: `Chaveiro "${backend}" não é seguro. Instale/ative libsecret ou KWallet.` };
      }
      return { available: true };
    } catch {
      return { available: false, reason: "Não foi possível consultar o chaveiro do sistema." };
    }
  }

  function readAll(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(entries: Record<string, string>): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entries), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, filePath);
  }

  return {
    status,
    has(id: string): boolean {
      return typeof readAll()[id] === "string";
    },
    get(id: string): string | null {
      const encoded = readAll()[id];
      if (typeof encoded !== "string" || !status().available) return null;
      try {
        return safeStorage.decryptString(Buffer.from(encoded, "base64"));
      } catch {
        return null;
      }
    },
    set(id: string, token: string): void {
      const current = status();
      if (!current.available) throw new Error(current.reason);
      const entries = readAll();
      entries[id] = safeStorage.encryptString(token).toString("base64");
      writeAll(entries);
    },
    remove(id: string): void {
      const entries = readAll();
      if (!(id in entries)) return;
      delete entries[id];
      writeAll(entries);
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
