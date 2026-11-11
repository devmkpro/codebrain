import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SsmTunnelConfig } from "../../../src/types/access-vault";
import { AccessVaultError } from "./access-vault";

/** Run the AWS CLI directly, never through a shell or with secrets in argv. */
function awsBinary(): string {
  const windowsCli = path.join(process.env.ProgramFiles || "C:\\Program Files", "Amazon", "AWSCLIV2", "aws.exe");
  return process.platform === "win32" && fs.existsSync(windowsCli) ? windowsCli : "aws";
}

export async function loginAwsSso(profile: string): Promise<void> {
  if (typeof profile !== "string" || !/^[a-zA-Z0-9_.@+-]{1,128}$/.test(profile))
    throw new AccessVaultError("INVALID_SSM", "Informe um perfil AWS válido.");
  await new Promise<void>((resolve, reject) => {
    execFile(awsBinary(), ["sso", "login", "--profile", profile], {
      windowsHide: true, timeout: 180_000, env: { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" },
    }, (error) => error
      ? reject(new AccessVaultError("SSO_LOGIN_FAILED", "O login SSO não foi concluído. Confira o perfil AWS e a autenticação no navegador."))
      : resolve());
  });
}

export async function startSsmTunnel(config: SsmTunnelConfig, remotePort: number): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(awsBinary(), ["ssm", "start-session", "--target", config.instanceId,
    "--document-name", "AWS-StartPortForwardingSession", "--parameters",
    `portNumber=${remotePort},localPortNumber=${config.localPort}`,
    "--profile", config.profile, "--region", config.region], {
    windowsHide: true, shell: false, detached: process.platform !== "win32", env: { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    let done = false;
    const timer = setTimeout(() => finish(false), 30_000);
    const finish = (success: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (success) resolve(child);
      else {
        stopSsmTunnel(child);
        reject(new AccessVaultError("SSM_TUNNEL_FAILED", "Não foi possível abrir o túnel SSM. Confira AWS CLI, Session Manager Plugin, sessão SSO, permissões e porta local disponível."));
      }
    };
    child.stdout.on("data", (data: Buffer) => {
      output = (output + data.toString()).slice(-8192);
      if (new RegExp(`Port ${config.localPort} opened for sessionId`, "i").test(output)) finish(true);
    });
    // Drain stderr without exposing AWS session data or token-bearing diagnostics.
    child.stderr.on("data", () => {});
    child.once("error", () => finish(false));
    child.once("exit", () => finish(false));
  });
}

/** AWS CLI starts the Session Manager plugin as a child; stop the entire owned tree. */
export function stopSsmTunnel(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) { child.kill(); return; }
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
    killer.unref();
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
  }
}
