// @vitest-environment node
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccessVault, validateSshEndpoint, type AccessVaultOptions, type VaultSafeStorage } from "./access-vault";

// Authenticated mock OS keystore: tests the vault boundary, not DPAPI itself.
function testSafeStorage(): VaultSafeStorage {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: value => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString: bytes => {
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
}

const hostInput = { label: "Fixture host", hostname: "fixture.example.invalid", username: "tester", port: 2222 };

describe("access vault", () => {
  let fixture: string;
  let options: AccessVaultOptions;
  beforeEach(async () => {
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), "cb-access-vault-"));
    options = { storagePath: path.join(fixture, "vault.enc"), safeStorage: testSafeStorage(), platform: process.platform === "win32" ? "win32" : "darwin",
      openSshPane: vi.fn().mockResolvedValue({ paneId: "ssh-fixture-1" }), approveAgentConnection: vi.fn().mockResolvedValue(true) };
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(fixture, { recursive: true, force: true }); });

  it("opens loopback-only forwards through an authorized host and rejects invalid ports", async () => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost({ ...hostInput, allowAgentAccess: true });
    await vault.openSsh(host.id, { source: "agent", forward: { direction: "remote", listenPort: 11435, targetPort: 11434 } });
    const plan = (options.openSshPane as any).mock.calls[0][0];
    expect(plan.tunnel).toBe(true);
    expect(plan.args).toContain("ExitOnForwardFailure=yes");
    expect(plan.args).toContain("-N");
    expect(plan.args).toContain("-R");
    expect(plan.args).toContain("127.0.0.1:11435:127.0.0.1:11434");
    expect(plan.args.slice(-2)).toEqual(["--", hostInput.hostname]);
    await expect(vault.openSsh(host.id, { source: "agent", forward: { direction: "local", listenPort: 0, targetPort: 11434 } })).rejects.toMatchObject({ code: "INVALID_FORWARD" });
    const denied = await vault.upsertHost({ ...hostInput, label: "denied", allowAgentAccess: false });
    await expect(vault.openSsh(denied.id, { source: "agent", forward: { direction: "local", listenPort: 11435, targetPort: 11434 } })).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED" });
  });

  it("stores SSM routing and revokes agent access when its route changes", async () => {
    const vault = createAccessVault(options);
    const ssmTunnel = { instanceId: "i-0123456789abcdef0", region: "sa-east-1", profile: "fixture", localPort: 2221 };
    const host = await vault.upsertHost({ ...hostInput, ssmTunnel, allowAgentAccess: true });
    expect((await vault.list()).hosts[0].ssmTunnel).toEqual(ssmTunnel);
    await vault.openSsh(host.id, { source: "agent" });
    const plan = (options.openSshPane as any).mock.calls[0][0];
    expect(plan.ssmTunnel).toEqual(ssmTunnel);
    expect(plan.ssmRemotePort).toBe(2222);
    expect(plan.args.slice(-5)).toEqual(["tester", "-p", "2221", "--", "127.0.0.1"]);
    const changed = await vault.upsertHost({ ...hostInput, id: host.id, ssmTunnel: { ...ssmTunnel, localPort: 2223 } }, { source: "agent" });
    expect(changed.allowAgentAccess).toBe(false);
    await expect(vault.upsertHost({ ...hostInput, ssmTunnel: { ...ssmTunnel, instanceId: "i-evil;echo" } })).rejects.toMatchObject({ code: "INVALID_SSM" });
  });

  it("roundtrips encrypted data and never serializes secrets in public CRUD/list results", async () => {
    const secret = "TEST-ONLY-API-SECRET-852b";
    const vault = createAccessVault(options);
    const credential = await vault.upsertCredential({ label: "API fixture", kind: "api-key", secret });
    expect(credential).toMatchObject({ kind: "api-key", hasSecret: true, allowAgentAccess: false });
    const host = await vault.upsertHost(hostInput);
    expect(host.allowAgentAccess).toBe(false);
    const updated = await vault.upsertCredential({ id: credential.id, label: "Renamed", kind: "api-key" });
    const inventory = await createAccessVault(options).list();
    expect(inventory.credentials).toEqual([updated]);
    expect(inventory.hosts).toEqual([host]);
    const publicJson = JSON.stringify([credential, updated, inventory]);
    expect(publicJson).not.toContain(secret);
    expect(publicJson).not.toContain('"secret"');
    const file = await fs.readFile(options.storagePath, "utf8");
    for (const value of [secret, hostInput.hostname, "Renamed"]) expect(file).not.toContain(value);
    expect(Object.keys(JSON.parse(file)).sort()).toEqual(["ciphertext", "iv", "tag", "version", "wrappedKey"]);
    expect((vault as any).getSecret).toBeUndefined();
    expect((vault as any).reveal).toBeUndefined();
    expect((await fs.readdir(fixture))).toEqual(["vault.enc"]);
    if (process.platform !== "win32") expect((await fs.stat(options.storagePath)).mode & 0o777).toBe(0o600);
  });

  it("updates and deletes only the selected records, and refuses deleting linked credentials", async () => {
    const vault = createAccessVault(options);
    const credential = await vault.upsertCredential({ label: "Password", kind: "password", secret: "fixture-password" });
    const host = await vault.upsertHost({ ...hostInput, credentialId: credential.id });
    await expect(vault.deleteCredential(credential.id)).rejects.toMatchObject({ code: "CREDENTIAL_IN_USE" });
    await expect(vault.upsertCredential({ id: credential.id, label: credential.label, kind: "api-key", secret: "new" })).rejects.toMatchObject({ code: "CREDENTIAL_IN_USE" });
    await vault.deleteHost(host.id);
    await vault.deleteCredential(credential.id);
    expect(await vault.list()).toEqual({ hosts: [], credentials: [] });
  });

  it("serializes concurrent writes without losing unrelated records", async () => {
    const vault = createAccessVault(options);
    await Promise.all(Array.from({ length: 8 }, (_, i) => vault.upsertCredential({ label: `Fixture ${i}`, kind: "password", secret: `fixture-${i}` })));
    expect((await vault.list()).credentials).toHaveLength(8);
  });

  it.each(["ciphertext", "wrappedKey", "iv", "tag"])("refuses tampered %s and preserves the original file", async field => {
    const vault = createAccessVault(options);
    await vault.upsertCredential({ label: "Fixture", kind: "password", secret: "only-test" });
    const envelope = JSON.parse(await fs.readFile(options.storagePath, "utf8"));
    const bytes = Buffer.from(envelope[field], "base64"); bytes[0] ^= 1; envelope[field] = bytes.toString("base64");
    const tampered = JSON.stringify(envelope);
    await fs.writeFile(options.storagePath, tampered);
    await expect(vault.list()).rejects.toMatchObject({ code: "VAULT_CORRUPT" });
    await expect(vault.upsertHost(hostInput)).rejects.toMatchObject({ code: "VAULT_CORRUPT" });
    expect(await fs.readFile(options.storagePath, "utf8")).toBe(tampered);
  });

  it("does not reset a vault when the OS encryption key changes", async () => {
    await createAccessVault(options).upsertCredential({ label: "Fixture", kind: "password", secret: "only-test" });
    await expect(createAccessVault({ ...options, safeStorage: testSafeStorage() }).list()).rejects.toMatchObject({ code: "VAULT_CORRUPT" });
  });

  it.each(["basic_text", "unknown", "future_backend"])("refuses unsafe Linux keystore backend %s without writing", async backend => {
    const vault = createAccessVault({ ...options, platform: "linux", safeStorage: { ...options.safeStorage, getSelectedStorageBackend: () => backend } });
    expect(vault.status().available).toBe(false);
    await expect(vault.upsertCredential({ label: "Fixture", kind: "password", secret: "must-not-save" })).rejects.toMatchObject({ code: "CRYPTO_UNAVAILABLE" });
    expect(await fs.readdir(fixture)).toEqual([]);
  });

  it("refuses unavailable OS encryption and never invokes encryption or falls back to plaintext", async () => {
    const encrypt = vi.fn();
    const vault = createAccessVault({ ...options, safeStorage: { ...options.safeStorage, isEncryptionAvailable: () => false, encryptString: encrypt } });
    await expect(vault.upsertHost(hostInput)).rejects.toMatchObject({ code: "CRYPTO_UNAVAILABLE" });
    expect(encrypt).not.toHaveBeenCalled();
    expect(await fs.readdir(fixture)).toEqual([]);
  });

  it("sanitizes encryption exceptions instead of returning raw secret-bearing errors", async () => {
    const secret = "NEVER-SERIALIZE-THIS";
    const vault = createAccessVault({ ...options, safeStorage: { ...options.safeStorage, encryptString: () => { throw new Error(secret); } } });
    let error: any;
    try { await vault.upsertCredential({ label: "Fixture", kind: "password", secret }); } catch (caught) { error = caught; }
    expect(error.code).toBe("VAULT_WRITE_FAILED");
    expect(error.message).not.toContain(secret);
    expect(await fs.readdir(fixture)).toEqual([]);
  });

  it.each(["allowAgentAccess", "secret", "password", "privateKey", "args", "command"])("rejects the forbidden agent field %s", async field => {
    await expect(createAccessVault(options).upsertHost({ ...hostInput, [field]: true } as any, { source: "agent" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("lets agents maintain connection metadata without granting new permissions", async () => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost(hostInput, { source: "agent" });
    expect(host.allowAgentAccess).toBe(false);
    expect((await vault.list({ source: "agent" })).hosts).toEqual([]);
    await vault.upsertHost({ ...hostInput, id: host.id, allowAgentAccess: true });
    expect((await vault.list({ source: "agent" })).hosts).toHaveLength(1);
    const changed = await vault.upsertHost({ ...hostInput, id: host.id, hostname: "redirect.example.invalid" }, { source: "agent" });
    expect(changed.allowAgentAccess).toBe(false);
    expect(options.openSshPane).not.toHaveBeenCalled();
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED" });
    await vault.upsertHost({ ...hostInput, id: host.id, hostname: changed.hostname, allowAgentAccess: true });
    await expect(vault.openSsh(host.id, { source: "agent" })).resolves.toMatchObject({ paneId: "ssh-fixture-1", interactive: false, connectionState: "starting" });
    expect(options.approveAgentConnection).toHaveBeenCalledWith(expect.objectContaining({ hostname: "redirect.example.invalid" }), null);
  });

  it("requires credential authorization as well as host authorization for agent access", async () => {
    const vault = createAccessVault(options);
    const credential = await vault.upsertCredential({ label: "Hidden", kind: "password", secret: "test-only" });
    await expect(vault.upsertHost({ ...hostInput, credentialId: credential.id }, { source: "agent" })).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED" });
    const host = await vault.upsertHost({ ...hostInput, credentialId: credential.id, allowAgentAccess: true });
    expect(await vault.list({ source: "agent" })).toEqual({ hosts: [], credentials: [] });
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED" });
    expect(options.approveAgentConnection).not.toHaveBeenCalled();
  });

  it("requires a fresh native approval on EVERY agent connection", async () => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost({ ...hostInput, allowAgentAccess: true });
    await vault.openSsh(host.id, { source: "agent" });
    await vault.openSsh(host.id, { source: "agent" });
    expect(options.approveAgentConnection).toHaveBeenCalledTimes(2);
    expect(options.openSshPane).toHaveBeenCalledTimes(2);
    const plan = (options.openSshPane as any).mock.calls[0][0];
    expect(plan.executable).toBe("ssh");
    for (const value of ["StrictHostKeyChecking=yes", "IdentityFile=none", "BatchMode=yes", "ForwardAgent=no", "ClearAllForwardings=yes", "ProxyCommand=none", "PermitLocalCommand=no"]) expect(plan.args).toContain(value);
    expect(plan.args.slice(0, 2)).toEqual(["-F", "none"]);
    expect(plan.args.slice(-6)).toEqual(["-l", "tester", "-p", "2222", "--", "fixture.example.invalid"]);
    expect(plan).not.toHaveProperty("env");
  });

  it("honors an explicitly selected local SSH alias including its jump host and identity", async () => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost({ ...hostInput, hostname: "codebrain-tom", useSshConfig: true, allowAgentAccess: true });
    await vault.openSsh(host.id, { source: "agent" });
    const plan = (options.openSshPane as any).mock.calls[0][0];
    expect(plan.args).not.toContain("-F");
    expect(plan.args).not.toContain("ProxyJump=none");
    expect(plan.args).not.toContain("ProxyCommand=none");
    expect(plan.args).not.toContain("IdentityFile=none");
    expect(plan.args.slice(-6)).toEqual(["-l", "tester", "-p", "2222", "--", "codebrain-tom"]);
    expect(plan.args).toContain("StrictHostKeyChecking=yes");
    expect(options.approveAgentConnection).toHaveBeenCalledOnce();
    expect((await vault.list()).hosts[0]).toMatchObject({ useSshConfig: true });
  });

  it("preserves existing permission for metadata updates that keep the authorized route", async () => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost({ ...hostInput, useSshConfig: true, allowAgentAccess: true });
    await vault.upsertHost({ ...hostInput, id: host.id, label: "Renamed", useSshConfig: true }, { source: "agent" });
    expect((await vault.list()).hosts[0].useSshConfig).toBe(true);
    expect(options.openSshPane).not.toHaveBeenCalled();
    await vault.openSsh(host.id, { source: "agent" });
    expect(options.approveAgentConnection).toHaveBeenCalledWith(expect.objectContaining({ useSshConfig: true }), null);
  });

  it.each([{ hostname: "different.invalid" }, { username: "other" }, { port: 2223 }, { useSshConfig: true }])("revokes agent access when an agent changes the authorized route: %o", async patch => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost({ ...hostInput, allowAgentAccess: true });
    const changed = await vault.upsertHost({ ...hostInput, id: host.id, ...patch }, { source: "agent" });
    expect(changed.allowAgentAccess).toBe(false);
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED" });
    expect(options.approveAgentConnection).not.toHaveBeenCalled();
    expect(options.openSshPane).not.toHaveBeenCalled();
  });

  it("keeps the configured remote user for IP connections instead of the Windows login", async () => {
    const vault = createAccessVault(options);
    const host = await vault.upsertHost({ ...hostInput, hostname: "192.0.2.1", username: "remote-user", port: 22, useSshConfig: true });
    await vault.openSsh(host.id);
    expect((options.openSshPane as any).mock.calls[0][0].args.slice(-6)).toEqual(["-l", "remote-user", "-p", "22", "--", "192.0.2.1"]);
  });

  it("rejects a malformed SSH config selection without changing the host", async () => {
    const vault = createAccessVault(options);
    await expect(vault.upsertHost({ ...hostInput, useSshConfig: "yes" } as any)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await vault.list()).hosts).toHaveLength(0);
  });

  it("fails closed when the approval callback is absent or denies the request", async () => {
    const vault = createAccessVault({ ...options, approveAgentConnection: undefined });
    const host = await vault.upsertHost({ ...hostInput, allowAgentAccess: true });
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const denied = createAccessVault({ ...options, approveAgentConnection: vi.fn().mockResolvedValue(false) });
    await expect(denied.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
    expect(options.openSshPane).not.toHaveBeenCalled();
  });

  it("honors revocation while a connection approval is pending", async () => {
    const vault = createAccessVault({ ...options, approveAgentConnection: async host => {
      await vault.upsertHost({ ...hostInput, id: host.id, allowAgentAccess: false }); return true;
    } });
    const host = await vault.upsertHost({ ...hostInput, allowAgentAccess: true });
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED" });
    expect(options.openSshPane).not.toHaveBeenCalled();
  });

  it("passes only an explicitly selected local key path to the internal argv callback", async () => {
    const location = path.join(fixture, "fixture-key");
    await fs.writeFile(location, "TEST FIXTURE; NEVER AN ACTUAL PRIVATE KEY");
    const vault = createAccessVault(options);
    const credential = await vault.upsertCredential({ label: "Key reference", kind: "ssh-key-path", secret: location, allowAgentAccess: true });
    const host = await vault.upsertHost({ ...hostInput, credentialId: credential.id, allowAgentAccess: true });
    const result = await vault.openSsh(host.id, { source: "agent" });
    expect(JSON.stringify([credential, host, result, (options.approveAgentConnection as any).mock.calls])).not.toContain(location);
    expect((options.openSshPane as any).mock.calls[0][0].args).toEqual(expect.arrayContaining(["-i", location, "IdentitiesOnly=yes", "IdentityAgent=none"]));
    expect(await fs.readdir(fixture)).toEqual(expect.arrayContaining(["fixture-key", "vault.enc"]));
  });

  it("detects a key reference change during approval even with identical timestamps", async () => {
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-11-09T12:00:00.000Z");
    const first = path.join(fixture, "key-first"), second = path.join(fixture, "key-second");
    await fs.writeFile(first, "test"); await fs.writeFile(second, "test");
    const vault = createAccessVault({ ...options, approveAgentConnection: async (_host, credential) => {
      await vault.upsertCredential({ id: credential!.id, label: credential!.label, kind: "ssh-key-path", secret: second }); return true;
    } });
    const credential = await vault.upsertCredential({ label: "Key", kind: "ssh-key-path", secret: first, allowAgentAccess: true });
    const host = await vault.upsertHost({ ...hostInput, credentialId: credential.id, allowAgentAccess: true });
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect(options.openSshPane).not.toHaveBeenCalled();
  });

  it("keeps password authentication interactive without ever passing its stored value", async () => {
    const secret = "DO-NOT-PASS-TO-SSH";
    const vault = createAccessVault(options);
    const credential = await vault.upsertCredential({ label: "Password", kind: "password", secret, allowAgentAccess: true });
    const host = await vault.upsertHost({ ...hostInput, credentialId: credential.id, allowAgentAccess: true });
    await expect(vault.openSsh(host.id, { source: "agent" })).rejects.toMatchObject({ code: "INTERACTIVE_AUTH_REQUIRED" });
    expect(await vault.openSsh(host.id)).toMatchObject({ paneId: "ssh-fixture-1", interactive: true, connectionState: "starting" });
    const plan = (options.openSshPane as any).mock.calls[0][0];
    expect(plan.args).toContain("BatchMode=no");
    expect(plan.args).toContain("PubkeyAuthentication=no");
    expect(JSON.stringify(plan)).not.toContain(secret);
  });

  it("rejects API keys as SSH credentials and missing key files", async () => {
    const vault = createAccessVault(options);
    const api = await vault.upsertCredential({ label: "API", kind: "api-key", secret: "test-only" });
    await expect(vault.upsertHost({ ...hostInput, credentialId: api.id })).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    const credential = await vault.upsertCredential({ label: "Key", kind: "ssh-key-path", secret: path.join(fixture, "missing") });
    const host = await vault.upsertHost({ ...hostInput, credentialId: credential.id });
    await expect(vault.openSsh(host.id)).rejects.toMatchObject({ code: "KEY_UNAVAILABLE" });
  });

  it("rejects network/expanding Windows key paths and does not accept private key content as a path", async () => {
    const vault = createAccessVault({ ...options, platform: "win32" });
    for (const secret of ["\\\\server\\share\\key", "C:\\Users\\%USERNAME%\\key", "-----BEGIN PRIVATE KEY-----", "relative/key"]) {
      await expect(vault.upsertCredential({ label: "Key", kind: "ssh-key-path", secret })).rejects.toMatchObject({ code: "INVALID_KEY_PATH" });
    }
  });

  it("rejects secret-bearing native callback exceptions without exposing their message", async () => {
    const vault = createAccessVault({ ...options, openSshPane: async () => { throw new Error("SENSITIVE INTERNAL VALUE"); } });
    const host = await vault.upsertHost(hostInput);
    await expect(vault.openSsh(host.id)).rejects.toMatchObject({ code: "SSH_OPEN_FAILED", message: "Não foi possível abrir o terminal SSH." });
  });
});

describe("SSH endpoint validation", () => {
  it.each(["-oProxyCommand=evil", "server;whoami", "user@host", "$(whoami)", "server\nother", "bad/name", "[::1]"])("rejects hostname %s", hostname => {
    expect(() => validateSshEndpoint({ ...hostInput, hostname })).toThrow();
  });
  it.each(["-o", "root;id", "user name", "user@host", "x\ny"])("rejects username %s", username => {
    expect(() => validateSshEndpoint({ ...hostInput, username })).toThrow();
  });
  it.each([0, -1, 65536, 1.5, "22", null])("rejects invalid port %s", port => {
    expect(() => validateSshEndpoint({ ...hostInput, port } as any)).toThrow();
  });
  it.each(["example.invalid", "192.0.2.1", "2001:db8::1"])("accepts standard address %s without contacting it", hostname => {
    expect(validateSshEndpoint({ ...hostInput, hostname, port: undefined }).port).toBe(22);
  });
});
