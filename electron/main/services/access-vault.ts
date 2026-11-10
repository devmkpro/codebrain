import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  AccessCredential, AccessCredentialInput, AccessHost, AccessHostInput, AccessSource,
  AccessVaultInventory, AccessVaultStatus,
} from "../../../src/types/access-vault";

/** The synchronous interface is supported by Electron 33. Never use plaintext fallback. */
export interface VaultSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export interface SshLaunchPlan {
  executable: "ssh";
  args: string[];
  hostId: string;
  label: string;
}

export interface AccessVaultOptions {
  storagePath: string;
  safeStorage: VaultSafeStorage;
  platform?: NodeJS.Platform;
  /** Trusted main-process callback. Execute argv directly, never via a shell string. */
  openSshPane?: (plan: SshLaunchPlan) => Promise<{ paneId: string }>;
  /** Trusted authorization policy, re-evaluated for EVERY agent connection. */
  approveAgentConnection?: (host: AccessHost, credential: AccessCredential | null) => Promise<boolean>;
}

export class AccessVaultError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "AccessVaultError"; }
}

function fail(code: string, message: string): never { throw new AccessVaultError(code, message); }
const MAX_VAULT_BYTES = 4 * 1024 * 1024;
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_ITEMS = 1000;
const AAD = Buffer.from("CodeBrain/access-vault/v1");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
interface StoredCredential extends AccessCredential { secret: string }
interface VaultDocument { version: 1; credentials: StoredCredential[]; hosts: AccessHost[] }
type Origin = { source: AccessSource };

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_INPUT", "Dados de acesso inválidos.");
}
function fields(value: object, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail("INVALID_INPUT", "O cadastro contém campos não permitidos.");
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail("INVALID_INPUT", "Preencha os campos com valores válidos, sem caracteres de controle.");
  return value.trim();
}
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail("INVALID_ID", "Identificador de acesso inválido.");
  return value as string;
}
function permission(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail("INVALID_INPUT", "Permissão de agente inválida.");
  return value as boolean;
}
function origin(options: Origin): AccessSource {
  if (!options || (options.source !== "user" && options.source !== "agent")) fail("INVALID_SOURCE", "Origem da operação inválida.");
  return options.source;
}

export function validateSshEndpoint(input: Pick<AccessHostInput, "hostname" | "port" | "username">) {
  const hostname = text(input.hostname, 253);
  const dns = hostname.replace(/\.$/, "").split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  if (!isIP(hostname) && !dns) fail("INVALID_HOST", "Informe um hostname ou endereço IP válido, sem opções SSH.");
  const username = text(input.username, 64);
  if (!/^[a-z_][a-z0-9_.-]{0,63}$/i.test(username)) fail("INVALID_USER", "Informe um usuário SSH válido, sem espaços ou opções.");
  const port = input.port === undefined ? 22 : input.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("INVALID_PORT", "A porta SSH deve ser um número entre 1 e 65535.");
  return { hostname, username, port };
}

function credentialMetadata(value: StoredCredential): AccessCredential {
  // Explicit projection: never spread a stored credential into a public result.
  return { id: value.id, label: value.label, kind: value.kind, allowAgentAccess: value.allowAgentAccess,
    hasSecret: true, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function hostMetadata(value: AccessHost): AccessHost {
  return { id: value.id, label: value.label, hostname: value.hostname, port: value.port, username: value.username,
    ...(value.useSshConfig ? { useSshConfig: true } : {}),
    credentialId: value.credentialId, allowAgentAccess: value.allowAgentAccess, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function createAccessVault(options: AccessVaultOptions) {
  const platform = options.platform ?? process.platform;
  let queue: Promise<unknown> = Promise.resolve();
  let connectionPending = false;

  function status(): AccessVaultStatus {
    try {
      if (!options.safeStorage.isEncryptionAvailable()) return { available: false, backend: null, reason: "A criptografia do sistema não está disponível. O cofre permanece bloqueado." };
      if (platform === "win32") return { available: true, backend: "dpapi" };
      if (platform === "darwin") return { available: true, backend: "keychain" };
      if (platform === "linux") {
        const backend = options.safeStorage.getSelectedStorageBackend?.() ?? "unknown";
        if (["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(backend)) return { available: true, backend };
        return { available: false, backend, reason: "O cofre exige um keyring seguro. basic_text e backends desconhecidos são recusados." };
      }
    } catch { /* Do not serialize OS/keychain errors; they may contain sensitive material. */ }
    return { available: false, backend: null, reason: "Não foi possível acessar a criptografia segura do sistema." };
  }
  function requireCrypto() {
    const current = status();
    if (!current.available) fail("CRYPTO_UNAVAILABLE", current.reason!);
  }
  function locked<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }
  function base64(value: unknown, max: number): Buffer {
    if (typeof value !== "string" || value.length > max * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("VAULT_CORRUPT", "O cofre está ilegível ou foi alterado. Nenhum dado foi substituído.");
    const bytes = Buffer.from(value as string, "base64");
    if (bytes.length > max || bytes.toString("base64") !== value) fail("VAULT_CORRUPT", "O cofre está ilegível ou foi alterado. Nenhum dado foi substituído.");
    return bytes;
  }
  function validateDocument(doc: VaultDocument) {
    if (doc?.version !== 1 || !Array.isArray(doc.credentials) || !Array.isArray(doc.hosts) || doc.credentials.length > MAX_ITEMS || doc.hosts.length > MAX_ITEMS) throw new Error("schema");
    const ids = new Set<string>();
    for (const item of doc.credentials) {
      id(item.id);
      if (ids.has(item.id)) throw new Error("duplicate");
      ids.add(item.id);
      text(item.label, 120);
      if (!["api-key", "password", "ssh-key-path"].includes(item.kind) || typeof item.secret !== "string" || !item.secret || Buffer.byteLength(item.secret) > MAX_SECRET_BYTES || typeof item.allowAgentAccess !== "boolean" || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") throw new Error("credential schema");
    }
    const hostIds = new Set<string>();
    for (const host of doc.hosts) {
      id(host.id);
      if (hostIds.has(host.id) || typeof host.allowAgentAccess !== "boolean" || typeof host.createdAt !== "string" || typeof host.updatedAt !== "string") throw new Error("host schema");
      hostIds.add(host.id);
      text(host.label, 120);
      validateSshEndpoint(host);
      if (host.useSshConfig !== undefined && typeof host.useSshConfig !== "boolean") throw new Error("host config mode");
      if (host.credentialId !== null && !ids.has(host.credentialId)) throw new Error("missing credential");
    }
  }

  async function read(): Promise<VaultDocument> {
    requireCrypto();
    let key: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      const stat = await fs.lstat(options.storagePath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (!stat) return { version: 1, credentials: [], hosts: [] };
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_VAULT_BYTES) throw new Error("invalid file");
      const envelope = JSON.parse(await fs.readFile(options.storagePath, "utf8"));
      if (envelope.version !== 1) throw new Error("version");
      const wrapped = base64(envelope.wrappedKey, 8192);
      const iv = base64(envelope.iv, 12);
      const tag = base64(envelope.tag, 16);
      if (iv.length !== 12 || tag.length !== 16) throw new Error("invalid nonce");
      key = base64(options.safeStorage.decryptString(wrapped), 32);
      if (key.length !== 32) throw new Error("invalid key");
      const cipher = createDecipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      cipher.setAuthTag(tag);
      plaintext = Buffer.concat([cipher.update(base64(envelope.ciphertext, MAX_VAULT_BYTES)), cipher.final()]);
      const doc = JSON.parse(plaintext.toString("utf8")) as VaultDocument;
      validateDocument(doc);
      return doc;
    } catch {
      fail("VAULT_CORRUPT", "Não foi possível abrir o cofre com a chave do sistema, ou os dados foram alterados. Nenhum dado foi substituído.");
    } finally { key?.fill(0); plaintext?.fill(0); }
  }

  async function write(doc: VaultDocument) {
    requireCrypto();
    const key = randomBytes(32);
    const plaintext = Buffer.from(JSON.stringify(doc));
    let temporary: string | undefined;
    try {
      if (plaintext.length > MAX_VAULT_BYTES / 2) fail("VAULT_LIMIT", "O cofre atingiu o limite de armazenamento.");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = JSON.stringify({ version: 1, wrappedKey: options.safeStorage.encryptString(key.toString("base64")).toString("base64"),
        iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
      const directory = path.dirname(options.storagePath);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryStat = await fs.lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail("UNSAFE_PATH", "O diretório do cofre não pode ser um link simbólico.");
      temporary = path.join(directory, `.access-vault-${randomUUID()}.tmp`);
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(envelope, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, options.storagePath);
      temporary = undefined;
    } catch (error) {
      if (error instanceof AccessVaultError) throw error;
      fail("VAULT_WRITE_FAILED", "Não foi possível salvar o cofre com segurança. Os dados anteriores foram preservados.");
    } finally {
      key.fill(0); plaintext.fill(0);
      if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  function validateSecret(secret: unknown, kind: AccessCredential["kind"]): string {
    if (typeof secret !== "string" || !secret || Buffer.byteLength(secret) > MAX_SECRET_BYTES || secret.includes("\0")) fail("INVALID_SECRET", "Informe um valor de credencial válido com até 64 KB.");
    if (kind === "ssh-key-path") {
      const absolute = platform === "win32" ? path.win32.isAbsolute(secret) : path.posix.isAbsolute(secret);
      if (!absolute || (platform === "win32" && !/^[a-z]:[\\/]/i.test(secret)) || /[\r\n$%`"<>|]/.test(secret)) fail("INVALID_KEY_PATH", "Informe o caminho absoluto de uma chave local existente, sem caminhos de rede, variáveis ou expansões.");
    }
    return secret as string;
  }

  async function list(options: Origin = { source: "user" }): Promise<AccessVaultInventory> {
    const source = origin(options);
    return locked(async () => {
      const doc = await read();
      const credentials = doc.credentials.filter(item => source === "user" || item.allowAgentAccess);
      const permitted = new Set(credentials.map(item => item.id));
      return { credentials: credentials.map(credentialMetadata), hosts: doc.hosts.filter(item => source === "user" || (item.allowAgentAccess && (!item.credentialId || permitted.has(item.credentialId)))).map(hostMetadata) };
    });
  }

  async function upsertCredential(input: AccessCredentialInput): Promise<AccessCredential> {
    record(input);
    fields(input, ["id", "label", "kind", "secret", "allowAgentAccess"]);
    const label = text(input.label, 120);
    if (input.id !== undefined) id(input.id);
    if (!["api-key", "password", "ssh-key-path"].includes(input.kind)) fail("INVALID_KIND", "Tipo de credencial inválido.");
    return locked(async () => {
      const doc = await read();
      const existing = input.id ? doc.credentials.find(item => item.id === id(input.id)) : undefined;
      if (input.id && !existing) fail("NOT_FOUND", "Credencial não encontrada.");
      if (!existing && doc.credentials.length >= MAX_ITEMS) fail("VAULT_LIMIT", "Limite de credenciais atingido.");
      if (existing && existing.kind !== input.kind && doc.hosts.some(host => host.credentialId === existing.id)) fail("CREDENTIAL_IN_USE", "Desvincule a credencial dos hosts antes de alterar seu tipo.");
      const secret = validateSecret(input.secret === undefined && existing ? existing.secret : input.secret, input.kind);
      const now = new Date().toISOString();
      const item: StoredCredential = { id: existing?.id ?? randomUUID(), label, kind: input.kind, secret,
        hasSecret: true, allowAgentAccess: permission(input.allowAgentAccess, existing?.allowAgentAccess ?? false),
        createdAt: existing?.createdAt ?? now, updatedAt: now };
      doc.credentials = [...doc.credentials.filter(row => row.id !== item.id), item];
      await write(doc);
      return credentialMetadata(item);
    });
  }

  async function deleteCredential(credentialId: string) {
    id(credentialId);
    return locked(async () => {
      const doc = await read();
      if (!doc.credentials.some(item => item.id === credentialId)) fail("NOT_FOUND", "Credencial não encontrada.");
      if (doc.hosts.some(item => item.credentialId === credentialId)) fail("CREDENTIAL_IN_USE", "Desvincule a credencial dos hosts antes de excluí-la.");
      doc.credentials = doc.credentials.filter(item => item.id !== credentialId);
      await write(doc);
    });
  }

  async function upsertHost(input: AccessHostInput, options: Origin = { source: "user" }): Promise<AccessHost> {
    const source = origin(options);
    record(input);
    fields(input, source === "agent" ? ["id", "label", "hostname", "port", "username", "credentialId", "useSshConfig"] : ["id", "label", "hostname", "port", "username", "credentialId", "useSshConfig", "allowAgentAccess"]);
    const endpoint = validateSshEndpoint(input);
    const label = text(input.label, 120);
    if (input.id !== undefined) id(input.id);
    const credentialId = input.credentialId == null ? null : id(input.credentialId);
    return locked(async () => {
      const doc = await read();
      const existing = input.id ? doc.hosts.find(item => item.id === id(input.id)) : undefined;
      if (input.id && !existing) fail("NOT_FOUND", "Host não encontrado.");
      // Bypass is scoped to the endpoint the user authorized. An agent changing
      // its route must not inherit that permission for a different destination.
      const useSshConfig = permission(input.useSshConfig, existing?.useSshConfig ?? false);
      const routeUnchanged = existing && existing.hostname === endpoint.hostname &&
        existing.username === endpoint.username && existing.port === endpoint.port &&
        existing.credentialId === credentialId && Boolean(existing.useSshConfig) === useSshConfig;
      if (!existing && doc.hosts.length >= MAX_ITEMS) fail("VAULT_LIMIT", "Limite de hosts atingido.");
      const credential = credentialId ? doc.credentials.find(item => item.id === credentialId) : null;
      if (credentialId && !credential) fail("NOT_FOUND", "Credencial não encontrada.");
      if (credential?.kind === "api-key") fail("INVALID_CREDENTIAL", "Uma API key não pode autenticar uma conexão SSH.");
      if (source === "agent" && credential && !credential.allowAgentAccess) fail("AGENT_ACCESS_DENIED", "Esta credencial não foi autorizada para agentes.");
      const now = new Date().toISOString();
      const host: AccessHost = { id: existing?.id ?? randomUUID(), label, ...endpoint, credentialId,
        ...(useSshConfig ? { useSshConfig: true } : {}),
        allowAgentAccess: source === "agent" ? Boolean(routeUnchanged && existing?.allowAgentAccess) : permission(input.allowAgentAccess, existing?.allowAgentAccess ?? false),
        createdAt: existing?.createdAt ?? now, updatedAt: now };
      doc.hosts = [...doc.hosts.filter(item => item.id !== host.id), host];
      await write(doc);
      return hostMetadata(host);
    });
  }

  async function deleteHost(hostId: string) {
    id(hostId);
    return locked(async () => {
      const doc = await read();
      if (!doc.hosts.some(item => item.id === hostId)) fail("NOT_FOUND", "Host não encontrado.");
      doc.hosts = doc.hosts.filter(item => item.id !== hostId);
      await write(doc);
    });
  }

  async function connection(hostId: string, source: AccessSource) {
    return locked(async () => {
      const doc = await read();
      const host = doc.hosts.find(item => item.id === hostId);
      if (!host) fail("NOT_FOUND", "Host não encontrado.");
      const credential = host.credentialId ? doc.credentials.find(item => item.id === host.credentialId)! : null;
      if (source === "agent" && (!host.allowAgentAccess || (credential && !credential.allowAgentAccess))) fail("AGENT_ACCESS_DENIED", "O usuário precisa autorizar o host e a credencial na Central.");
      if (source === "agent" && credential?.kind === "password") fail("INTERACTIVE_AUTH_REQUIRED", "Autenticação por senha exige um terminal aberto pelo usuário. A senha salva não é enviada a agentes.");
      const interactive = credential?.kind === "password";
      // Isolated endpoints remain the default. A user-approved alias explicitly
      // opts into the local config's identity and jump route. Explicit host
      // user/port always win, avoiding the Windows username for IP endpoints.
      const args = [...(host.useSshConfig ? [] : ["-F", "none", "-o", "ProxyCommand=none", "-o", "ProxyJump=none"]),
        "-o", "StrictHostKeyChecking=yes", "-o", "PermitLocalCommand=no",
        "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none",
        "-o", "CanonicalizeHostname=no", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", `BatchMode=${interactive ? "no" : "yes"}`];
      if (credential?.kind === "ssh-key-path") {
        const location = validateSecret(credential.secret, "ssh-key-path");
        const stat = await fs.lstat(location).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink()) fail("KEY_UNAVAILABLE", "A chave SSH precisa ser um arquivo local existente, sem link simbólico.");
        args.push("-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes", "-i", location);
      } else {
        // No implicit import/use of the user's default private-key files.
        if (!host.useSshConfig || interactive) args.push("-o", "IdentityFile=none");
        if (interactive) args.push("-o", "IdentityAgent=none", "-o", "PubkeyAuthentication=no");
      }
      args.push("-o", interactive ? "PreferredAuthentications=password,keyboard-interactive" : "PreferredAuthentications=publickey");
      if (!interactive) args.push("-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no");
      args.push("-l", host.username, "-p", String(host.port));
      args.push("--", host.hostname);
      return { host: hostMetadata(host), credential: credential ? credentialMetadata(credential) : null, interactive,
        revision: createHash("sha256").update(JSON.stringify([host, credential])).digest("hex"),
        plan: { executable: "ssh" as const, args, hostId: host.id, label: host.label } };
    });
  }

  async function openSsh(hostId: string, optionsOrigin: Origin = { source: "user" }) {
    id(hostId);
    const source = origin(optionsOrigin);
    if (!options.openSshPane) fail("SSH_UNAVAILABLE", "A abertura do terminal SSH não está disponível nesta versão.");
    if (connectionPending) fail("SSH_BUSY", "Já existe uma solicitação SSH aguardando aprovação ou abertura.");
    connectionPending = true;
    try {
      const initial = await connection(hostId, source);
      if (source === "agent") {
        if (!options.approveAgentConnection) fail("APPROVAL_REQUIRED", "A conexão do agente exige aprovação do usuário no aplicativo.");
        let approved = false;
        try { approved = await options.approveAgentConnection(initial.host, initial.credential) === true; }
        catch { fail("APPROVAL_REQUIRED", "Não foi possível obter aprovação do usuário para a conexão."); }
        if (!approved) fail("APPROVAL_DENIED", "O usuário não autorizou esta conexão SSH.");
      }
      // Revalidate after the native dialog: edits/revocations during approval must win.
      const current = await connection(hostId, source);
      if (initial.revision !== current.revision) fail("ACCESS_CHANGED", "O acesso foi alterado durante a confirmação. Solicite uma nova conexão.");
      let result: { paneId: string };
      try { result = await options.openSshPane(current.plan); }
      catch { fail("SSH_OPEN_FAILED", "Não foi possível abrir o terminal SSH."); }
      if (!result || typeof result.paneId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(result.paneId)) fail("SSH_OPEN_FAILED", "O terminal SSH não retornou um identificador válido.");
      return { paneId: result.paneId, interactive: current.interactive };
    } finally { connectionPending = false; }
  }

  return { status, list, upsertCredential, deleteCredential, upsertHost, deleteHost, openSsh };
}

export type AccessVault = ReturnType<typeof createAccessVault>;
