import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface CommandRequest {
  command: string;
  cwd: string;
  /** Trusted bridge metadata, never accepted from the MCP tool arguments. */
  workspacePath: string;
  timeoutMs?: number;
  maxOutputChars?: number;
  shell?: "cmd" | "powershell" | "sh";
  signal?: AbortSignal;
}
export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  terminationConfirmed: boolean;
  code?: string;
  error?: string;
}
const MAX_OUTPUT_CHARS = 12_000;
const MAX_JSON_BYTES = 19_000;
// The shell assigns ITSELF before running caller content; every descendant then
// inherits the job. Closing the root's last handle kills the entire job, unlike
// taskkill /T alone which races children created while it enumerates the tree.
// https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
const WINDOWS_JOB_SETUP = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try {
# Reflection.Emit stays in-process: Add-Type can launch csc.exe BEFORE the job
# exists, leaving an unprotected compiler when cancellation races bootstrap.
$cbAssembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName('CodebrainCommandNative')), [Reflection.Emit.AssemblyBuilderAccess]::Run)
$cbModule = $cbAssembly.DefineDynamicModule('Native')
$cbType = $cbModule.DefineType('CodebrainCommandNative', [Reflection.TypeAttributes]'Public,Abstract,Sealed')
function Add-CbNative([string]$name, [Type]$returns, [Type[]]$parameters) {
  $method = $cbType.DefinePInvokeMethod($name, 'kernel32.dll', [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', [Reflection.CallingConventions]::Standard, $returns, $parameters, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
  $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
}
Add-CbNative 'CreateJobObjectW' ([IntPtr]) @([IntPtr], [string])
Add-CbNative 'SetInformationJobObject' ([bool]) @([IntPtr], [int], [IntPtr], [uint32])
Add-CbNative 'AssignProcessToJobObject' ([bool]) @([IntPtr], [IntPtr])
$cbNative = $cbType.CreateType()
$cbJob = $cbNative::CreateJobObjectW([IntPtr]::Zero, $null)
if ($cbJob -eq [IntPtr]::Zero) { throw 'job unavailable' }
$cbSize = if ([IntPtr]::Size -eq 8) { 144 } else { 112 }
$cbLimits = [Runtime.InteropServices.Marshal]::AllocHGlobal($cbSize)
try {
  [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] $cbSize), 0, $cbLimits, $cbSize)
  [Runtime.InteropServices.Marshal]::WriteInt32($cbLimits, 16, 0x2000)
  if (-not $cbNative::SetInformationJobObject($cbJob, 9, $cbLimits, $cbSize)) { throw 'limits unavailable' }
  if (-not $cbNative::AssignProcessToJobObject($cbJob, [IntPtr](-1))) { throw 'assignment unavailable' }
} finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($cbLimits) }
} catch { [Console]::Error.WriteLine('Command process isolation unavailable.'); exit 125 }
`;
const fail = (code: string, error: string): CommandResult => ({ ok: false, code, error, stdout: "", stderr: "", exitCode: null, durationMs: 0, timedOut: false, cancelled: false, truncated: false, terminationConfirmed: true });

function bound(result: CommandResult, maximum: number): CommandResult {
  while (result.stdout.length + result.stderr.length > maximum || Buffer.byteLength(JSON.stringify(result)) >= MAX_JSON_BYTES) {
    const field = result.stdout.length >= result.stderr.length ? "stdout" : "stderr";
    result[field] = result[field].slice(0, Math.floor(result[field].length * 0.8));
    result.truncated = true;
  }
  return result;
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // No provider/vault credentials, SSH agent, NODE_OPTIONS, shell startup hooks,
  // proxy credentials or caller-supplied env. Login/profile scripts are disabled.
  const allowed = /^(PATH|PATHEXT|OS|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG|LC_ALL|LC_CTYPE|PROGRAMFILES|PROGRAMFILES\(X86\))$/i;
  for (const [key, value] of Object.entries(process.env)) if (allowed.test(key)) env[key] = value;
  return env;
}

function validate(request: CommandRequest): { cwd: string; timeout: number; maximum: number; binary: string; args: string[]; readyMarker?: string; input?: string } {
  if (!request || typeof request.command !== "string" || !request.command.trim() || request.command.length > 16_000 || request.command.includes("\0") ||
      typeof request.workspacePath !== "string" || !path.isAbsolute(request.workspacePath) || typeof request.cwd !== "string" || !path.isAbsolute(request.cwd) ||
      [request.timeoutMs, request.maxOutputChars].some(value => value !== undefined && (!Number.isFinite(value) || value < 1))) throw new Error();
  const root = fs.realpathSync(request.workspacePath);
  const cwd = fs.realpathSync(request.cwd);
  const relative = path.relative(root, cwd);
  if (!fs.statSync(root).isDirectory() || !fs.statSync(cwd).isDirectory() || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error();
  const shell = request.shell ?? (process.platform === "win32" ? "powershell" : "sh");
  let binary: string;
  let args: string[];
  let readyMarker: string | undefined;
  let input: string | undefined;
  if (process.platform === "win32" && (shell === "powershell" || shell === "cmd")) {
    binary = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    // Encode the approved script as data; no cmd.exe quoting/interpolation layer.
    const body = shell === "cmd"
      ? `$cbCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(request.command).toString("base64")}'))\n& ([IO.Path]::Combine($env:SystemRoot, 'System32', 'cmd.exe')) /d /s /c $cbCommand`
      : request.command;
    // Caller content is withheld until the isolated shell acknowledges its job.
    // A cancellation before this handshake cannot have started caller children.
    readyMarker = `CODEBRAIN_JOB_READY_${randomBytes(24).toString("hex")}`;
    input = Buffer.from(body, "utf8").toString("base64");
    const script = `${WINDOWS_JOB_SETUP}\n[Console]::Out.WriteLine('${readyMarker}')\n[Console]::Out.Flush()\n$cbInput = [Console]::In.ReadToEnd()\nif ([string]::IsNullOrEmpty($cbInput)) { exit 0 }\n& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cbInput))))\n$cbRunSucceeded = $?\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }\nif (-not $cbRunSucceeded) { exit 1 }`;
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  } else if (process.platform !== "win32" && shell === "sh") {
    binary = "/bin/sh"; args = ["-c", request.command];
  } else throw new Error();
  return { cwd, timeout: Math.min(120_000, Math.max(1, Math.floor(request.timeoutMs ?? 30_000))), maximum: Math.min(MAX_OUTPUT_CHARS, Math.max(1, Math.floor(request.maxOutputChars ?? MAX_OUTPUT_CHARS))), binary, args, readyMarker, input };
}

/** Internal main-process executor. Expose only via createCommandHandlers' policy
 * + native approval gate, never directly through IPC. It is not an OS sandbox.
 * dispose() must be awaited when the owning bridge/app shuts down. */
export function createCommandRunner() {
  let disposed = false;
  let quarantined = false;
  const running = new Set<{ cancel: () => void; done: Promise<CommandResult> }>();
  async function runCommand(request: CommandRequest): Promise<CommandResult> {
    if (disposed || quarantined) return fail("RUNNER_CLOSED", "Executor encerrado ou aguardando confirmação de término.");
    if (running.size >= 2) return fail("COMMAND_BUSY", "Já existem dois comandos em execução.");
    if (request?.signal?.aborted) return { ...fail("CANCELLED", "Execução cancelada."), cancelled: true };
    let plan: ReturnType<typeof validate>;
    try { plan = validate(request); } catch { return fail("INVALID_ARGUMENT", "Comando, shell, cwd ou escopo inválidos."); }
    const started = Date.now();
    let cancel!: () => void;
    const done = new Promise<CommandResult>(resolve => {
      let child: ChildProcess;
      const result: CommandResult = { ok: false, stdout: "", stderr: "", exitCode: null, durationMs: 0, timedOut: false, cancelled: false, truncated: false, terminationConfirmed: true };
      try { child = spawn(plan.binary, plan.args, { cwd: plan.cwd, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: [plan.readyMarker ? "pipe" : "ignore", "pipe", "pipe"], env: commandEnvironment() }); }
      catch { cancel = () => {}; resolve(fail("SPAWN_FAILED", "Não foi possível iniciar o comando.")); return; }
      let finished = false;
      let stopping = false;
      let closeObserved = false;
      let rootExited = false;
      let jobReady = false;
      let commandSent = false;
      let bootstrapOutput = "";
      let killCompleted = false;
      let timer: ReturnType<typeof setTimeout>;
      let reapTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer); clearTimeout(reapTimer);
        request.signal?.removeEventListener("abort", cancel);
        child.stdin?.destroy();
        result.durationMs = Date.now() - started;
        result.ok = result.exitCode === 0 && !result.timedOut && !result.cancelled && !result.error;
        resolve(bound(result, plan.maximum));
      };
      const unconfirmed = () => {
        quarantined = true; result.terminationConfirmed = false;
        result.code = "TERMINATION_UNCONFIRMED"; result.error = "Não foi possível confirmar o encerramento da árvore do comando.";
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish();
      };
      const stop = (reason: "timeout" | "cancelled" | "descendants") => {
        if (finished || stopping) return;
        stopping = true;
        result.timedOut = reason === "timeout";
        result.cancelled = reason === "cancelled";
        result.code = reason === "timeout" ? "TIMED_OUT" : reason === "cancelled" ? "CANCELLED" : "CHILD_PROCESS_REMAINED";
        result.error = "O comando foi interrompido; não houve nova tentativa.";
        // EOF without a payload lets a surviving bootstrap exit without running
        // any user code, even if taskkill itself fails during startup.
        if (!commandSent) child.stdin?.end();
        reapTimer = setTimeout(unconfirmed, 3000);
        if (process.platform === "win32" && child.pid) {
          const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
          execFile(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 2000 }, error => {
            if (finished) return;
            killCompleted = true;
            // A failed taskkill is not proof of a leak OR proof of cleanup.
            // Require root close plus either acknowledged job ownership or a
            // sealed bootstrap to which no command payload was ever sent.
            if (closeObserved && plan.readyMarker && (jobReady || !commandSent)) { finish(); return; }
            if (!error) { stopping = false; if (closeObserved) finish(); }
            // Otherwise wait for close until reapTimer, then quarantine.
          });
        } else {
          try { if (child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") { unconfirmed(); return; } }
          stopping = false;
          if (closeObserved) finish();
        }
      };
      cancel = () => stop("cancelled");
      for (const field of ["stdout", "stderr"] as const) {
        child[field]?.setEncoding("utf8");
        child[field]?.on("data", (chunk: string) => {
          if (field === "stdout" && plan.readyMarker && !jobReady) {
            bootstrapOutput += chunk;
            const newline = bootstrapOutput.indexOf("\n");
            if (newline < 0 && bootstrapOutput.length <= 256) return;
            if (newline < 0 || bootstrapOutput.slice(0, newline).replace(/\r$/, "") !== plan.readyMarker) {
              stop("cancelled"); return;
            }
            jobReady = true;
            chunk = bootstrapOutput.slice(newline + 1);
            bootstrapOutput = "";
            if (!stopping && !finished) { commandSent = true; child.stdin?.end(plan.input); }
          }
          const space = Math.max(0, plan.maximum - result[field].length);
          if (chunk.length > space) result.truncated = true;
          if (space) result[field] += chunk.slice(0, space);
        });
      }
      child.stdin?.on("error", () => { if (!finished && !stopping) stop("cancelled"); });
      child.once("error", () => { result.code = "SPAWN_FAILED"; result.error = "Não foi possível iniciar o comando."; finish(); });
      child.once("exit", code => {
        rootExited = true; result.exitCode = code;
        // POSIX process group can outlive its shell; terminate remaining group
        // members now instead of letting a daemon retain pipes indefinitely.
        if (process.platform !== "win32" && child.pid && !stopping) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* no remaining group */ }
        }
      });
      child.once("close", code => {
        closeObserved = true; result.exitCode = code;
        if (!stopping || (killCompleted && plan.readyMarker && (jobReady || !commandSent))) finish();
      });
      timer = setTimeout(() => stop(rootExited ? "descendants" : "timeout"), plan.timeout);
      request.signal?.addEventListener("abort", cancel, { once: true });
      if (request.signal?.aborted) cancel();
    });
    const record = { cancel, done };
    running.add(record);
    try { return await done; } finally { running.delete(record); }
  }
  async function dispose(): Promise<void> {
    disposed = true;
    const records = [...running];
    for (const record of records) record.cancel();
    await Promise.all(records.map(record => record.done));
  }
  return { runCommand, dispose };
}
