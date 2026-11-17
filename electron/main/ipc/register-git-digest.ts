/**
 * IPC do Diário GitLab. O token entra por aqui (upsertConnection) e nunca volta
 * ao renderer: as respostas trazem só `hasToken`.
 */
import { app, ipcMain, safeStorage } from "electron";
import * as path from "node:path";
import type { AppContext } from "../context";
import { safeSend } from "../context";
import { GLOBAL_DIR } from "../services/constants";
import { getCliDecider } from "../services/cli-decider";
import { getEnhancedProviders } from "../services/providers";
import type { HarnessProvider } from "../services/harness-providers";
import { createGitDigestService, type GitDigestService } from "../services/git-digest/git-digest-service";
import { createTokenStore } from "../services/git-digest/token-store";
import { listSummarizerOptions, summarize, type SummarizerEnvironment } from "../services/git-digest/summarizer";

let service: GitDigestService | null = null;

function summarizerEnv(ctx: AppContext): SummarizerEnvironment {
  return {
    providers: getEnhancedProviders(ctx) as HarnessProvider[],
    cli: getCliDecider(ctx),
    clis: (ctx.cliDetector?.getAll?.() ?? {}) as SummarizerEnvironment["clis"],
  };
}

function handle(channel: string, fn: (args: any) => unknown): void {
  ipcMain.handle(channel, async (_event, args) => {
    try {
      return await fn(args ?? {});
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function getGitDigestService(ctx: AppContext): GitDigestService {
  if (service) return service;
  service = createGitDigestService({
    dir: path.join(GLOBAL_DIR, "git-digest"),
    tokens: createTokenStore(path.join(app.getPath("userData"), "git-digest-tokens.json"), safeStorage),
    summarize: (args) => summarize({ ...args, ...summarizerEnv(ctx) }),
    onUpdated: (date) => safeSend(ctx, "gitDigest:updated", date),
  });
  return service;
}

export function registerGitDigestHandlers(ctx: AppContext): void {
  const digest = getGitDigestService(ctx);

  handle("gitDigest:getConfig", () => ({ ok: true, config: digest.getConfig(), status: digest.status() }));
  handle("gitDigest:saveSettings", (args) => ({ ok: true, config: digest.saveSettings(args) }));
  handle("gitDigest:upsertConnection", async (args) => ({ ok: true, config: await digest.upsertConnection(args) }));
  handle("gitDigest:removeConnection", ({ id }) => ({ ok: true, config: digest.removeConnection(id) }));
  handle("gitDigest:testConnection", async ({ id }) => ({ ok: true, user: await digest.testConnection(id) }));
  handle("gitDigest:list", () => ({ ok: true, items: digest.list() }));
  handle("gitDigest:get", ({ date }) => ({ ok: true, digest: digest.get(date) }));
  handle("gitDigest:generate", async ({ date }) => ({ ok: true, digest: await digest.generate(date) }));
  // Todos os harnesses conhecidos: CLIs detectadas e providers configurados, com motivo quando indisponível.
  handle("gitDigest:providers", async () => {
    try {
      await ctx.cliDetector?.getAllAsync?.();
    } catch {
      /* lista com o que já foi detectado */
    }
    return { ok: true, providers: await listSummarizerOptions(summarizerEnv(ctx)) };
  });

  digest.start();
}
