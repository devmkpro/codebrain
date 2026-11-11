import { app, ipcMain, safeStorage, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppContext } from "../context";
import {
  AccessVaultError, createAccessVault, type AccessVault, type AccessVaultOptions,
} from "../services/access-vault";
import { loginAwsSso } from "../services/ssm-tunnel";

export type AccessVaultRegistrationOptions = Partial<AccessVaultOptions> & {
  vault?: AccessVault;
  /** Optional additional restriction, not a way to bypass main-window isolation. */
  isTrustedSender?: (event: IpcMainInvokeEvent) => boolean;
};

function validArgs(args: unknown, keys: string[]): asserts args is Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) {
    throw new AccessVaultError("INVALID_INPUT", "Parâmetros da operação inválidos.");
  }
}

function trustedRendererUrl(value: string): boolean {
  try {
    const current = new URL(value);
    if (current.protocol === "file:") {
      current.search = "";
      current.hash = "";
      return current.href === pathToFileURL(path.join(app.getAppPath(), "out", "renderer", "index.html")).href;
    }
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      const expected = new URL(process.env.ELECTRON_RENDERER_URL);
      return ["http:", "https:"].includes(expected.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname) &&
        !expected.username && !expected.password && !current.username && !current.password &&
        current.origin === expected.origin && current.pathname === expected.pathname;
    }
  } catch { /* An absent/malformed frame URL is never trusted. */ }
  return false;
}

/** Only the app's main renderer may mutate the vault. MCP must call the returned
 * service with source:'agent' and use its separate per-connection approval gate. */
export function registerAccessVaultHandlers(ctx: AppContext, options: AccessVaultRegistrationOptions = {}): AccessVault {
  const vault = options.vault ?? createAccessVault({
    storagePath: options.storagePath ?? path.join(app.getPath("userData"), "access-vault.enc"),
    safeStorage: options.safeStorage ?? safeStorage,
    platform: options.platform,
    openSshPane: options.openSshPane,
    approveAgentConnection: options.approveAgentConnection,
  });

  function handle(channel: string, run: (args: any) => unknown) {
    ipcMain.handle(`accessVault:${channel}`, async (event, args) => {
      try {
        const main = ctx.mainWindow?.webContents;
        if (!main || main.isDestroyed() || event.sender !== main || !event.senderFrame || event.senderFrame !== main.mainFrame || !trustedRendererUrl(event.senderFrame.url) ||
          (options.isTrustedSender && !options.isTrustedSender(event))) {
          throw new AccessVaultError("IPC_FORBIDDEN", "O cofre só pode ser acessado pela janela principal do aplicativo.");
        }
        return await run(args);
      } catch (error) {
        // Never return native exception messages, payloads, keychain errors or stacks.
        return error instanceof AccessVaultError
          ? { ok: false, code: error.code, error: error.message }
          : { ok: false, code: "VAULT_OPERATION_FAILED", error: "Não foi possível concluir a operação segura do cofre." };
      }
    });
  }

  handle("status", () => ({ ok: true, status: vault.status() }));
  handle("list", async () => ({ ok: true, ...await vault.list({ source: "user" }) }));
  handle("saveCredential", async args => ({ ok: true, credential: await vault.upsertCredential(args) }));
  handle("saveHost", async args => ({ ok: true, host: await vault.upsertHost(args, { source: "user" }) }));
  handle("deleteCredential", async args => {
    validArgs(args, ["id", "confirmed"]);
    if (args.confirmed !== true) throw new AccessVaultError("CONFIRMATION_REQUIRED", "Confirme a exclusão da credencial.");
    await vault.deleteCredential(args.id as string);
    return { ok: true };
  });
  handle("deleteHost", async args => {
    validArgs(args, ["id", "confirmed"]);
    if (args.confirmed !== true) throw new AccessVaultError("CONFIRMATION_REQUIRED", "Confirme a exclusão do host.");
    await vault.deleteHost(args.id as string);
    return { ok: true };
  });
  handle("openSsh", async args => {
    validArgs(args, ["hostId"]);
    return { ok: true, ...await vault.openSsh(args.hostId as string, { source: "user" }) };
  });
  handle("loginSso", async args => {
    validArgs(args, ["profile"]);
    await loginAwsSso(args.profile as string);
    return { ok: true };
  });
  return vault;
}
