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

function awsEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } as NodeJS.ProcessEnv;
  if (process.platform === "win32") {
    const pluginBin = path.join(process.env.ProgramFiles || "C:\\Program Files", "Amazon", "SessionManagerPlugin", "bin");
    if (fs.existsSync(path.join(pluginBin, "session-manager-plugin.exe"))) {
      const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "Path";
      env[pathKey] = [env[pathKey], pluginBin].filter(Boolean).join(path.delimiter);
    }
  }
  return env;
}

export async function loginAwsSso(profile: string): Promise<void> {
  if (typeof profile !== "string" || !/^[a-zA-Z0-9_.@+-]{1,128}$/.test(profile))
    throw new AccessVaultError("INVALID_SSM", "Informe um perfil AWS válido.");
  await new Promise<void>((resolve, reject) => {
    execFile(awsBinary(), ["sso", "login", "--profile", profile], {
      windowsHide: true, timeout: 180_000, env: awsEnvironment(),
    }, (error) => error
      ? reject(new AccessVaultError("SSO_LOGIN_FAILED", "O login SSO não foi concluído. Confira o perfil AWS e a autenticação no navegador."))
      : resolve());
  });
}

const START_TIMEOUT_MS = 25_000;
const RECONNECT_DELAYS_MS = [2_000, 5_000];

function tunnelError(output: string): AccessVaultError {
  if (/\bTargetNotConnected\b/i.test(output))
    return new AccessVaultError("SSM_TARGET_NOT_CONNECTED", "A instância ainda está desconectada do AWS Systems Manager. Confira o agente SSM e a conectividade da EC2.");
  if (/\bAccessDenied(?:Exception)?\b|not authorized to perform/i.test(output))
    return new AccessVaultError("SSM_ACCESS_DENIED", "O perfil AWS não tem permissão para iniciar a sessão SSM nessa instância.");
  if (/\b(?:ExpiredToken(?:Exception)?|UnauthorizedSSOTokenError|InvalidClientTokenId)\b|Error loading SSO Token|SSO session.*expir|Token has expired|Unable to locate credentials/i.test(output))
    return new AccessVaultError("SSM_AWS_AUTH_REQUIRED", "A sessão do perfil AWS CLI está ausente ou expirou. Autentique o perfil e tente novamente.");
  if (/config profile .* could not be found/i.test(output))
    return new AccessVaultError("SSM_PROFILE_NOT_FOUND", "O perfil AWS CLI cadastrado não existe neste computador.");
  if (/SessionManagerPlugin (?:is not found|not found)|session-manager-plugin.*(?:not found|ENOENT)/i.test(output))
    return new AccessVaultError("SSM_PLUGIN_UNAVAILABLE", "Instale o AWS Session Manager Plugin para abrir o túnel.");
  if (/address already in use|only one usage of each socket address|\bEADDRINUSE\b/i.test(output))
    return new AccessVaultError("SSM_LOCAL_PORT_IN_USE", "A porta local do túnel SSM está em uso. Se o launcher .bat estiver aberto, feche apenas o túnel dessa instância e tente novamente.");
  return new AccessVaultError("SSM_TUNNEL_FAILED", "O AWS CLI encerrou a abertura do túnel SSM. Confira o estado da instância e a configuração do Session Manager.");
}

function startTunnelOnce(config: SsmTunnelConfig, remotePort: number, timeout: number): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(awsBinary(), ["ssm", "start-session", "--target", config.instanceId,
    "--document-name", "AWS-StartPortForwardingSession", "--parameters",
    `portNumber=${remotePort},localPortNumber=${config.localPort}`,
    "--profile", config.profile, "--region", config.region], {
    windowsHide: true, shell: false, detached: process.platform !== "win32", env: awsEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (error?: AccessVaultError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(child);
    };
    const timer = setTimeout(() => {
      finish(new AccessVaultError("SSM_TUNNEL_TIMEOUT", "O AWS Systems Manager não confirmou a abertura da porta local a tempo."));
      stopSsmTunnel(child);
    }, timeout);
    const ready = new RegExp(`Port ${config.localPort} opened for sessionId`, "i");
    child.stdout.on("data", (data: Buffer) => {
      if (done) return;
      stdout = (stdout + data.toString()).slice(-8192);
      if (ready.test(stdout)) finish();
    });
    child.stderr.on("data", (data: Buffer) => {
      if (!done) stderr = (stderr + data.toString()).slice(-8192);
    });
    child.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT"
      ? new AccessVaultError("SSM_AWS_CLI_UNAVAILABLE", "Instale a AWS CLI para abrir o túnel SSM.")
      : tunnelError("")));
    // close comes after stdio drains. Only fixed messages leave the trusted process.
    child.once("close", () => { if (!done) finish(tunnelError(`${stderr}\n${stdout}`)); });
  });
}

export async function startSsmTunnel(config: SsmTunnelConfig, remotePort: number): Promise<ChildProcessWithoutNullStreams> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await startTunnelOnce(config, remotePort, Math.max(1, deadline - Date.now()));
    } catch (error) {
      const delay = RECONNECT_DELAYS_MS[attempt];
      if (!(error instanceof AccessVaultError) || error.code !== "SSM_TARGET_NOT_CONNECTED" ||
          delay === undefined || Date.now() + delay >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
