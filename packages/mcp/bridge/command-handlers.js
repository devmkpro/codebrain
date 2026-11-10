"use strict";
const fs = require("node:fs");
const path = require("node:path");

const MAX_JSON_BYTES = 19_000;
const MAX_OUTPUT_CHARS = 12_000;
const SHELLS = new Set(["cmd", "powershell", "sh"]);
const failure = (code, error, extra = {}) => ({ ok: false, code, error, stdout: "", stderr: "", exitCode: null, durationMs: 0, timedOut: false, cancelled: false, truncated: false, ...extra });
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

function boundResult(raw, maxChars) {
  if (!raw || typeof raw !== "object") return failure("COMMAND_FAILED", "O executor não retornou um resultado válido.");
  const stdout = typeof raw.stdout === "string" ? raw.stdout : "";
  const stderr = typeof raw.stderr === "string" ? raw.stderr : "";
  const result = {
    ok: raw.ok === true && raw.exitCode === 0 && !raw.timedOut && !raw.cancelled,
    stdout: stdout.slice(0, maxChars), stderr: stderr.slice(0, maxChars),
    exitCode: Number.isSafeInteger(raw.exitCode) ? raw.exitCode : null,
    durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, Math.floor(raw.durationMs)) : 0,
    timedOut: raw.timedOut === true, cancelled: raw.cancelled === true,
    truncated: raw.truncated === true || stdout.length > maxChars || stderr.length > maxChars,
    terminationConfirmed: raw.terminationConfirmed !== false,
  };
  if (!result.ok) { result.code = "COMMAND_FAILED"; result.error = "Comando não concluído com sucesso; confira exitCode e os indicadores de execução."; }
  while (result.stdout.length + result.stderr.length > maxChars || Buffer.byteLength(JSON.stringify(result)) >= MAX_JSON_BYTES) {
    const field = result.stdout.length >= result.stderr.length ? "stdout" : "stderr";
    result[field] = result[field].slice(0, Math.floor(result[field].length * 0.8));
    result.truncated = true;
  }
  return result;
}

/** Native command execution is NOT a filesystem sandbox. Require explicit
 * write_external plus fresh user approval even when cwd is inside the workspace.
 * Missing policy/approval/runtime never falls back to shared panes or host exec. */
function createCommandHandlers(opts = {}) {
  const readOnly = () => opts.readOnly === true || opts.isReadOnly?.() === true;
  function scope(cwd) {
    const workspace = opts.getCurrentWorkspacePath?.();
    if (typeof workspace !== "string" || !workspace || !path.isAbsolute(workspace)) throw new Error();
    const root = fs.realpathSync(workspace);
    const target = fs.realpathSync(path.resolve(root, cwd || "."));
    if (!fs.statSync(root).isDirectory() || !fs.statSync(target).isDirectory() || !inside(root, target)) throw new Error();
    return { workspacePath: root, cwd: target };
  }
  async function approved(request, signal) {
    if (signal?.aborted) return "cancelled";
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(value); };
      const abort = () => finish("cancelled");
      const timer = setTimeout(() => finish("timeout"), 120_000);
      signal?.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => opts.approveCommand(Object.freeze({ ...request, signal })))
        .then(value => finish(value === true ? "approved" : "denied"), () => finish("denied"));
      if (signal?.aborted) abort();
    });
  }
  return {
    async shellRun(args = {}, context = {}) {
      try {
        if (!args || typeof args.command !== "string" || !args.command.trim() || args.command.length > 16_000 || /\0/.test(args.command) ||
            (args.cwd !== undefined && (typeof args.cwd !== "string" || args.cwd.length > 4096 || /\0/.test(args.cwd))) ||
            (args.shell !== undefined && !SHELLS.has(args.shell)) ||
            [args.timeoutMs, args.maxOutputChars].some(value => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 1)))
          return failure("INVALID_ARGUMENT", "Comando, shell, cwd ou limites inválidos.");
        if (context.signal?.aborted) return failure("CANCELLED", "Execução cancelada.", { cancelled: true });
        if (readOnly() || !opts.workspaceConfigStore || typeof opts.runCommand !== "function" || typeof opts.approveCommand !== "function")
          return failure("APPROVAL_REQUIRED", "Execução exige política write_external e aprovação explícita do usuário no aplicativo.");
        let location;
        try { location = scope(args.cwd); } catch { return failure("SCOPE_DENIED", "cwd deve ser um diretório existente dentro do workspace autorizado, sem escapes por links."); }
        if (opts.workspaceConfigStore.getAccessMode(location.workspacePath) !== "write_external")
          return failure("ACCESS_DENIED", "Execução sem sandbox exige write_external; solicite autorização do usuário nas configurações.");
        const request = Object.freeze({ command: args.command, ...location,
          timeoutMs: Math.min(120_000, Math.max(1, Math.floor(args.timeoutMs ?? 30_000))),
          maxOutputChars: Math.min(MAX_OUTPUT_CHARS, Math.max(1, Math.floor(args.maxOutputChars ?? MAX_OUTPUT_CHARS))),
          shell: args.shell ?? (process.platform === "win32" ? "powershell" : "sh"),
        });
        const approval = await approved(request, context.signal);
        if (approval === "cancelled" || context.signal?.aborted) return failure("CANCELLED", "Execução cancelada.", { cancelled: true });
        if (approval === "timeout") return failure("APPROVAL_TIMEOUT", "A aprovação expirou; nenhum comando foi iniciado.", { timedOut: true });
        if (approval !== "approved") return failure("APPROVAL_DENIED", "O usuário não aprovou esta execução.");
        // A pending native dialog is not permission to ignore revocation or a
        // workspace switch/junction swap while the user was deciding.
        let current;
        try { current = scope(args.cwd); } catch { return failure("ACCESS_CHANGED", "O escopo mudou durante a aprovação."); }
        if (readOnly() || current.workspacePath !== location.workspacePath || current.cwd !== location.cwd ||
            opts.workspaceConfigStore.getAccessMode(current.workspacePath) !== "write_external")
          return failure("ACCESS_CHANGED", "O acesso mudou durante a aprovação; solicite uma nova execução.");
        return boundResult(await opts.runCommand({ ...request, signal: context.signal }), request.maxOutputChars);
      } catch { return failure("COMMAND_FAILED", "Não foi possível executar o comando autorizado."); }
    },
  };
}
module.exports = { createCommandHandlers };
