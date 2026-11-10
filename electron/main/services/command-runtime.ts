import { dialog } from "electron";
import type { AppContext } from "../context";
import { createCommandRunner, type CommandRequest } from "./command-runner";

const runtimes = new WeakMap<AppContext, ReturnType<typeof createRuntime>>();
function createRuntime(ctx: AppContext) {
  const runner = createCommandRunner();
  const closing = new AbortController();
  let pending = 0;
  let approvalOpen = false;
  let closed = false;
  return {
    active: () => pending > 0 || approvalOpen,
    async approveCommand(request: CommandRequest): Promise<boolean> {
      if (closed || request.signal?.aborted) return false;
      // This preference only skips human consent. The runner still validates the
      // workspace, filters credentials, bounds output and cancels child processes.
      const config = ctx.configStore?.get();
      if (config && (config.agentCommandApproval === undefined || config.agentCommandApproval === "always")) return true;
      const parent = ctx.mainWindow;
      if (closed || approvalOpen || !parent || parent.isDestroyed() || request.signal?.aborted) return false;
      approvalOpen = true;
      const controller = new AbortController();
      const abort = () => controller.abort();
      closing.signal.addEventListener("abort", abort, { once: true });
      request.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 120_000);
      try {
        const result = await dialog.showMessageBox(parent, {
          type: "warning", title: "Codebrain — executar comando",
          message: "Permitir esta execução solicitada por um agente?",
          detail: `O comando não tem sandbox do sistema operacional e pode acessar arquivos fora do projeto. Não recebe chaves do cofre nem credenciais dos provedores.\n\nWorkspace: ${request.workspacePath}\nDiretório: ${request.cwd}\nShell: ${request.shell || "padrão"}\nLimite: ${request.timeoutMs || 30_000} ms\n\n${request.command}`,
          buttons: ["Cancelar", "Executar"], defaultId: 0, cancelId: 0,
          noLink: true, signal: controller.signal,
        });
        return result.response === 1 && !closed && !controller.signal.aborted && !request.signal?.aborted;
      } catch { return false; }
      finally {
        clearTimeout(timer); approvalOpen = false;
        closing.signal.removeEventListener("abort", abort);
        request.signal?.removeEventListener("abort", abort);
      }
    },
    async runCommand(request: CommandRequest) {
      if (closed) throw new Error("Executor encerrado");
      pending++;
      try { return await runner.runCommand(request); }
      finally { pending--; }
    },
    async dispose() {
      closed = true; closing.abort();
      await runner.dispose();
    },
  };
}
export function commandRuntime(ctx: AppContext) {
  let runtime = runtimes.get(ctx);
  if (!runtime) { runtime = createRuntime(ctx); runtimes.set(ctx, runtime); }
  return runtime;
}
export function hasRunningCommands(ctx: AppContext): boolean { return runtimes.get(ctx)?.active() === true; }
export async function disposeCommands(ctx: AppContext): Promise<void> {
  const runtime = runtimes.get(ctx);
  if (!runtime) return;
  // Keep the closed entry until all children have been reaped; callers holding
  // the old bridge cannot create a fresh runner during shutdown.
  await runtime.dispose();
  runtimes.delete(ctx);
}
