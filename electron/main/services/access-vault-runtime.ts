import { app, safeStorage } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { safeSend, type AppContext } from "../context";
import { AccessVaultError, createAccessVault, type AccessVault, type SshLaunchPlan } from "./access-vault";
import { startSsmTunnel, stopSsmTunnel } from "./ssm-tunnel";

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
      const signature = JSON.stringify([plan.args, plan.ssmTunnel, plan.ssmRemotePort]);
      for (const [existingId, config] of ctx.paneConfigs) {
        const ssh = config as typeof config & { sshHostId?: string; sshSignature?: string; ownerPaneId?: string; sshTunnel?: boolean };
        if (ssh.sshHostId !== plan.hostId || !ctx.ptyManager.hasPane(existingId)) continue;
        if (plan.forceNew) {
          if (plan.ssmTunnel) throw new AccessVaultError("SSH_IN_USE", "A porta do túnel SSM já está em uso por uma sessão SSH ativa.");
          continue;
        }
        if (ssh.sshSignature !== signature && (plan.tunnel || ssh.sshTunnel)) continue;
        if (ssh.sshSignature !== signature || ssh.ownerPaneId !== plan.ownerPaneId) {
          throw new AccessVaultError("SSH_IN_USE", "Já existe uma sessão SSH para esta máquina com outro acesso ou responsável. Feche-a antes de abrir outra.");
        }
        return { paneId: existingId, reused: true };
      }
      const cwd = ctx.currentWorkspacePath || os.homedir();
      const tunnel = plan.ssmTunnel ? await startSsmTunnel(plan.ssmTunnel, plan.ssmRemotePort ?? 22) : undefined;
      let paneId: string;
      try {
        paneId = await ctx.ptyManager.spawn(
          { agent: "shell", cwd, workspacePath: cwd },
          { binary: systemSsh(), args: plan.args },
        );
      } catch (error) { if (tunnel) stopSsmTunnel(tunnel); throw error; }
      if (tunnel) {
        const shutdown = () => stopSsmTunnel(tunnel);
        const closeTunnel = (id: string) => {
          if (id !== paneId) return;
          ctx.ptyManager.off("exit", closeTunnel);
          app.off("before-quit", shutdown);
          shutdown();
        };
        ctx.ptyManager.on("exit", closeTunnel);
        app.once("before-quit", shutdown);
      }
      const label = `${plan.tunnel ? "Túnel SSH" : "SSH"} · ${plan.label}`;
      ctx.paneConfigs.set(paneId, { agent: "shell", cwd, workspacePath: cwd, label, args: [], sshHostId: plan.hostId, sshSignature: signature, ...(plan.tunnel ? { sshTunnel: true } : {}), ...(plan.ownerPaneId ? { ownerPaneId: plan.ownerPaneId } : {}) } as any);
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
