import type { NativeResumePane as ResumePane } from "../types/native-session";
export type { NativeResumePane as ResumePane } from "../types/native-session";

export function resumeIdentity(pane: ResumePane): string | undefined {
  const id = pane.session?.id ?? pane.claudeSessionId;
  if (!id) return undefined;
  return JSON.stringify([pane.agent, id, pane.session?.scopeKey ?? "", pane.accountId ?? "", pane.cwd]);
}

export function nativeResumeConfig(pane: ResumePane, workspacePath: string) {
  const session = pane.session ?? (pane.claudeSessionId && ["claude", "openclaude"].includes(pane.agent) ? {
    provider: pane.agent, id: pane.claudeSessionId, capturedAt: Date.now(), confidence: "high" as const, source: "legacy-explicit-id",
  } : undefined);
  if (!session?.id || session.confidence !== "high") throw new Error("Esta sessão antiga tem apenas uma prévia, sem ID nativo confirmado. Informe o ID em 'Retomar por ID'.");
  // Rebuild options in main. Old args can contain credentials or stale prompts.
  return { agent: pane.agent, cwd: pane.cwd, workspacePath: pane.workspacePath ?? workspacePath,
    session, providerId: pane.providerId, model: pane.model, role: pane.role,
    accountId: pane.accountId, accountLabel: pane.accountLabel,
    allowedSkills: pane.allowedSkills, agentName: pane.agentName,
    permissionMode: pane.permissionMode ?? "default" };
}

export async function resumeSavedPane(pane: ResumePane, workspacePath: string, addPane: (pane: any) => void) {
  const config = nativeResumeConfig(pane, workspacePath);
  const result = await window.codeBrainApp.pty.spawn(config);
  if (!result?.ok || !result.paneId) throw new Error(result?.error ?? "Não foi possível retomar a conversa nativa.");
  addPane({ ...config, id: result.paneId, externallySpawned: true });
  return result;
}
