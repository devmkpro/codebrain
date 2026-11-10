import type { AppContext } from "../context";
import { safeSend } from "../context";
import type { NativeSession } from "../../../src/types/native-session";
import { accountEnv } from "./accounts";
import { sessionScope } from "./native-session-store";
import { resumeHarnessId, validateSessionId } from "./spawn/session-resume";

export function captureNativeSession(ctx: AppContext, paneId: string, capture: NativeSession): boolean {
  const cfg = ctx.paneConfigs.get(paneId);
  if (!cfg || resumeHarnessId(cfg.agent) !== resumeHarnessId(capture.harnessId ?? capture.provider)) return false;
  validateSessionId(capture.id);
  // Never replace an explicitly resumed identity with a filesystem timing guess.
  if (cfg.session?.id && cfg.session.id !== capture.id) return false;
  const session: NativeSession = { ...capture, provider: cfg.agent, harnessId: cfg.agent,
    scopeKey: cfg.session?.scopeKey ?? cfg.nativeSessionScope ?? sessionScope(cfg.agent, cfg.cwd, cfg.accountId, { ...process.env, ...(cfg.accountId ? accountEnv(cfg.accountId) : {}) }) };
  const saved = ctx.nativeSessions.save({ ...cfg, id: paneId, workspacePath: cfg.workspacePath ?? cfg.cwd, session });
  cfg.session = saved.session;
  ctx.ptyManager.setSession(paneId, { ...saved.session });
  safeSend(ctx, "pane:session", { paneId, session: saved.session, claudeSessionId: ["claude", "openclaude"].includes(cfg.agent) ? session.id : undefined });
  return true;
}
