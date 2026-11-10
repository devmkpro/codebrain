import { usePanesStore } from "../../stores/panes-store";
import { useMissionsStore } from "../../stores/missions-store";
import { notify } from "../../lib/notify";
import pilotSkill from "../../../resources/role-skills/cb-pilot/SKILL.md?raw";
import { ingestMissionPane } from "./mission-association";

/* Abertura do piloto de uma missão agêntica. A montagem do spawn é pura para o
   contrato com o processo main ficar testável sem PTY. */

export const PILOT_LABEL = "Piloto";

export const PILOT_INSTRUCTIONS = [
  "Você é o piloto desta missão e segue a skill cb-pilot.",
  "Você não executa o trabalho: quebre o objetivo em atividades e delegue cada uma a um ajudante com mcp__codebrain__pane_spawn, passando prompt e name.",
  "Nunca edite arquivos nem rode a implementação você mesmo. Acompanhe as entregas, confira a evidência e fale com a pessoa só para reportar ou pedir decisão.",
  pilotSkill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim(),
].join(" ");

export interface AgenticDraft {
  objective: string;
  /** Id da CLI. Vazio usa a preferida do app. */
  agent: string;
  model: string;
}

export function validateAgenticDraft(draft: Pick<AgenticDraft, "objective">): string | null {
  return draft.objective.trim() ? null : "Descreva o objetivo: é a primeira coisa que o piloto vai ler.";
}

export interface PilotTarget {
  agent: string;
  providerId?: string;
  model?: string;
  env?: Record<string, string>;
}

export interface PilotSpawnConfig extends PilotTarget {
  cwd: string;
  workspacePath: string;
  missionId: string;
  uiMissionId: string;
  operationalMissionId?: string;
  permissionMode: string;
  role: "orchestrator";
  orchestratorInstructions: string;
  initialPrompt: string;
  label: string;
  allowedSkills: string[];
}

export function buildPilotSpawnConfig(args: {
  workspacePath: string;
  missionId: string;
  operationalMissionId?: string;
  objective: string;
  target: PilotTarget;
  permissionMode: string;
}): PilotSpawnConfig {
  return {
    ...args.target,
    cwd: args.workspacePath,
    workspacePath: args.workspacePath,
    missionId: args.missionId,
    uiMissionId: args.missionId,
    ...(args.operationalMissionId ? { operationalMissionId: args.operationalMissionId } : {}),
    permissionMode: args.permissionMode,
    role: "orchestrator",
    orchestratorInstructions: PILOT_INSTRUCTIONS,
    // Algumas CLIs (ex.: Muse) não recebem system prompt. O primeiro turno
    // também leva o papel para manter o contrato de delegação em todos os harnesses.
    initialPrompt: `${PILOT_INSTRUCTIONS}\n\nObjetivo da missão:\n${args.objective.trim()}`,
    label: PILOT_LABEL,
    allowedSkills: ["cb-pilot", "cb-evidence"],
  };
}

interface ProviderLike {
  id: string;
  host?: string;
  type?: string;
  models?: string[];
  env?: Record<string, string>;
}

/** O registro usa gemini; providers e preferências antigos usam gemini-cli. */
export const canonicalPilotCli = (agent: string): string => agent === "gemini-cli" ? "gemini" : agent;

function providerCli(provider: ProviderLike): string {
  return canonicalPilotCli(provider.host ?? (provider.type === "oauth" ? "claude" : "openclaude"));
}

/** Acha o provider da CLI escolhida; CLI sem provider cadastrado abre pelo próprio login. */
export function resolvePilotTarget(draft: Pick<AgenticDraft, "agent" | "model">, providers: ProviderLike[], preferredAgent?: string | null): PilotTarget {
  const agent = canonicalPilotCli(draft.agent || preferredAgent || "claude");
  const model = draft.model.trim() || undefined;
  const hosted = providers.filter((provider) => providerCli(provider) === agent);
  const provider = (model && hosted.find((item) => item.models?.includes(model))) || hosted[0];
  const env = { ...(provider?.env ?? {}), ...(model ? { ANTHROPIC_MODEL: model, MODEL: model } : {}) };
  return { agent, providerId: provider?.id, model, ...(Object.keys(env).length ? { env } : {}) };
}

export function modelsForCli(agent: string, providers: ProviderLike[], preferredAgent?: string | null): string[] {
  const cli = canonicalPilotCli(agent || preferredAgent || "claude");
  const hosted = providers.filter((provider) => providerCli(provider) === cli);
  return [...new Set(hosted.flatMap((provider) => provider.models ?? []))];
}

/** Abre o piloto e amarra o pane à missão. Falha fica visível e marca a missão como bloqueada. */
export async function spawnPilot(args: {
  workspacePath: string;
  missionId: string;
  objective: string;
  target: PilotTarget;
}): Promise<boolean> {
  const { workspacePath, missionId, objective, target } = args;
  const missions = useMissionsStore.getState();
  try {
    const validationError = validateAgenticDraft({ objective });
    if (validationError) throw new Error(validationError);
    let permissionMode = "bypassPermissions";
    try { permissionMode = window.localStorage.getItem("codebrain.permissionMode") ?? permissionMode; } catch {}
    const operationalMissionId = missions.getWorkspaceMissions(workspacePath).find(mission => mission.id === missionId)?.operationalMissionId;
    const config = buildPilotSpawnConfig({ workspacePath, missionId, operationalMissionId, objective, target, permissionMode });
    const result = await window.codeBrainApp?.pty.spawn(config);
    if (!result?.ok || !result.paneId) throw new Error(result?.error ?? "o app não abriu o terminal");
    const actualTarget = {
      agent: result.agent ?? target.agent,
      providerId: result.providerId ?? target.providerId,
      model: result.model ?? target.model,
    };
    ingestMissionPane({
      paneId: result.paneId,
      ...actualTarget,
      cwd: result.cwd ?? workspacePath,
      workspacePath,
      missionId,
      uiMissionId: missionId,
      operationalMissionId: result.missionId,
      role: "orchestrator",
      label: PILOT_LABEL,
    });
    const panes = usePanesStore.getState() as { updatePane: (id: string, patch: unknown) => void };
    panes.updatePane(result.paneId, { permissionMode, title: PILOT_LABEL });
    const promptFailed = result.promptSubmitted === false || Boolean(result.promptError);
    const currentStatus = missions.getWorkspaceMissions(workspacePath).find(mission => mission.id === missionId)?.status;
    missions.updateMission(workspacePath, missionId, {
      pilotPaneId: result.paneId,
      pilot: actualTarget,
      operationalMissionId: result.missionId,
      status: currentStatus === "archived" ? "archived" : promptFailed ? "blocked" : currentStatus ?? "active",
    });
    if (promptFailed) notify("O objetivo não chegou ao piloto", result.promptError || "Envie o objetivo pelo terminal do piloto.", "warning");
    return !promptFailed;
  } catch (err) {
    missions.updateMission(workspacePath, missionId, { status: "blocked" });
    notify("Não deu para abrir o piloto", err instanceof Error ? err.message : String(err), "error");
    return false;
  }
}
