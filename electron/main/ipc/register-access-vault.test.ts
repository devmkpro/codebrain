// @vitest-environment node
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAccessVaultHandlers } from "./register-access-vault";

const electron = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => process.cwd(), isPackaged: false },
  ipcMain: { handle: electron.handle }, safeStorage: {},
}));

describe("access vault IPC boundary", () => {
  let handlers: Map<string, (event: any, args?: any) => Promise<any>>;
  let vault: any;
  let main: any;
  let event: any;
  let ctx: any;
  beforeEach(() => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "");
    handlers = new Map();
    electron.handle.mockReset().mockImplementation((channel, fn) => handlers.set(channel, fn));
    vault = {
      status: vi.fn().mockReturnValue({ available: true, backend: "dpapi" }),
      list: vi.fn().mockResolvedValue({ hosts: [], credentials: [] }),
      upsertCredential: vi.fn().mockResolvedValue({ id: "metadata-only", label: "Fixture", kind: "password", hasSecret: true }),
      upsertHost: vi.fn().mockResolvedValue({ id: "host-fixture", allowAgentAccess: false }),
      deleteCredential: vi.fn().mockResolvedValue(undefined), deleteHost: vi.fn().mockResolvedValue(undefined),
      openSsh: vi.fn().mockResolvedValue({ paneId: "ssh-test", interactive: false }),
    };
    const frame = { url: pathToFileURL(path.join(process.cwd(), "out", "renderer", "index.html")).href };
    main = { mainFrame: frame, isDestroyed: () => false };
    event = { sender: main, senderFrame: frame };
    ctx = { mainWindow: { webContents: main } };
    expect(registerAccessVaultHandlers(ctx, { vault })).toBe(vault);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const invoke = (name: string, args?: unknown) => handlers.get(`accessVault:${name}`)!(event, args);

  it("registers only metadata CRUD and terminal operations, without reveal/getSecret", async () => {
    expect([...handlers.keys()].sort()).toEqual(["accessVault:deleteCredential", "accessVault:deleteHost", "accessVault:list", "accessVault:loginSso", "accessVault:openSsh", "accessVault:saveCredential", "accessVault:saveHost", "accessVault:status"]);
    expect(await invoke("list")).toEqual({ ok: true, hosts: [], credentials: [] });
    expect(vault.list).toHaveBeenCalledWith({ source: "user" });
    const response = await invoke("saveCredential", { label: "Fixture", kind: "password", secret: "TEST-ONLY-SECRET" });
    expect(JSON.stringify(response)).not.toContain("TEST-ONLY-SECRET");
    expect(response.credential).not.toHaveProperty("secret");
  });

  it("rejects an unrelated webContents and a child frame", async () => {
    event.sender = {};
    expect((await invoke("list")).code).toBe("IPC_FORBIDDEN");
    event.sender = main; event.senderFrame = { url: main.mainFrame.url };
    expect((await invoke("list")).code).toBe("IPC_FORBIDDEN");
    expect(vault.list).not.toHaveBeenCalled();
  });

  it("rejects the same main frame after navigation to an external URL", async () => {
    main.mainFrame.url = "https://attacker.example.invalid/";
    expect((await invoke("saveHost", { label: "unsafe" })).code).toBe("IPC_FORBIDDEN");
    expect(vault.upsertHost).not.toHaveBeenCalled();
  });

  it("rejects a different file in the same app and accepts only the exact renderer", async () => {
    main.mainFrame.url = pathToFileURL(path.join(process.cwd(), "out", "renderer", "other.html")).href;
    expect((await invoke("list")).code).toBe("IPC_FORBIDDEN");
    main.mainFrame.url = pathToFileURL(path.join(process.cwd(), "out", "renderer", "index.html")).href + "#/central?s=acessos";
    expect((await invoke("list")).ok).toBe(true);
  });

  it("accepts only the exact loopback dev origin and pathname", async () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173/");
    main.mainFrame.url = "http://localhost:5173/#/central?s=acessos";
    expect((await invoke("list")).ok).toBe(true);
    for (const url of ["http://localhost:5174/", "http://localhost:5173/other", "http://localhost.attacker.invalid:5173/"]) {
      main.mainFrame.url = url;
      expect((await invoke("list")).code).toBe("IPC_FORBIDDEN");
    }
  });

  it("does not treat an externally configured dev URL as a trusted local renderer", async () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "https://remote.example.invalid/");
    main.mainFrame.url = "https://remote.example.invalid/";
    expect((await invoke("list")).code).toBe("IPC_FORBIDDEN");
  });

  it("requires explicit deletion confirmation and refuses injected operation fields", async () => {
    expect((await invoke("deleteHost", { id: "fixture" })).code).toBe("CONFIRMATION_REQUIRED");
    expect(vault.deleteHost).not.toHaveBeenCalled();
    expect((await invoke("deleteHost", { id: "fixture", confirmed: true })).ok).toBe(true);
    expect(vault.deleteHost).toHaveBeenCalledExactlyOnceWith("fixture");
    expect((await invoke("openSsh", { hostId: "fixture", command: "unsafe" })).code).toBe("INVALID_INPUT");
    expect(vault.openSsh).not.toHaveBeenCalled();
    expect((await invoke("openSsh", { hostId: "fixture" })).ok).toBe(true);
    expect(vault.openSsh).toHaveBeenCalledWith("fixture", { source: "user" });
  });

  it("sanitizes unexpected service errors without logging or echoing secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vault.upsertCredential.mockRejectedValue(new Error("TEST-SECRET-IN-NATIVE-ERROR"));
    const result = await invoke("saveCredential", { secret: "TEST-SECRET-IN-NATIVE-ERROR" });
    expect(result).toMatchObject({ ok: false, code: "VAULT_OPERATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("TEST-SECRET-IN-NATIVE-ERROR");
    expect(log).not.toHaveBeenCalled();
  });
});
