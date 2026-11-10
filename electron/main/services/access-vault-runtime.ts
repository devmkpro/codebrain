import { app, safeStorage } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { safeSend, type AppContext } from "../context";
import { AccessVaultError, createAccessVault, type AccessVault, type SshLaunchPlan } from "./access-vault";

const instances = new WeakMap<AppContext, AccessVault>();

function systemSsh(): string {
  const candidates = process.platform === "win32"
    ? [path.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "OpenSSH", "ssh.exe")]
    : ["/usr/bin/ssh", "/bin/ssh"];
  const binary = candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!binary) throw new AccessVaultError("SSH_UNAVAILABLE", "Instale o cliente OpenSSH do sistema para abrir uma conexão.");
  return binary;
}

export function getAccessVault(ctx: AppContext): AccessVault {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const vault = createAccessVault({
    storagePath: path.join(app.getPath("userData"), "access-vault.enc"),
    safeStorage,
    // The user's host/credential permission is persistent (bypass). Vault
    // access checks and revision revalidation still run on every connection.
    approveAgentConnection: async (host, credential) =>
      host.allowAgentAccess && (!credential || credential.allowAgentAccess),
    openSshPane: async (plan: SshLaunchPlan) => {
      if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) throw new AccessVaultError("SSH_UNAVAILABLE", "Abra a janela principal para usar o terminal SSH.");
      const cwd = ctx.currentWorkspacePath || os.homedir();
      const paneId = await ctx.ptyManager.spawn(
        { agent: "shell", cwd, workspacePath: cwd },
        { binary: systemSsh(), args: plan.args },
      );
      const label = `SSH · ${plan.label}`;
      ctx.paneConfigs.set(paneId, { agent: "shell", cwd, workspacePath: cwd, label, args: [] });
      ctx.paneRegistry.set(paneId, { paneId, cwd, spawnedAt: Date.now() });
      safeSend(ctx, "pane:added", { paneId, agent: "shell", cwd, workspacePath: cwd, label });
      return { paneId };
    },
  });
  instances.set(ctx, vault);
  return vault;
}

/** No native error, payload or stack may escape the trusted process. */
export async function accessVaultResult<T extends object>(run: () => Promise<T>) {
  try { return { ok: true as const, ...await run() }; }
  catch (error) {
    return error instanceof AccessVaultError
      ? { ok: false as const, code: error.code, error: error.message }
      : { ok: false as const, code: "VAULT_OPERATION_FAILED", error: "Não foi possível concluir a operação segura de acesso." };
  }
}
