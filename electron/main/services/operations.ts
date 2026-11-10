import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { AppContext } from "../context";
import { isRegisteredOrActiveWorkspace, workspacePathKey } from "./workspace-list";
import type {
  OperationalActivity,
  OperationalActor,
  OperationalHandoff,
  OperationalMessage,
  OperationalMission,
  OperationalTask,
  OperationsLane,
  OperationsSnapshot,
} from "../../../src/types/operations";

function basename(value: string): string {
  return value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
}

interface DerivedArchiveScope { actorIds: string[]; taskIds: string[]; handoffIds: string[]; messageIds: string[] }
interface ArchivedOperation { workspace: string; missionId: string; archivedAt: number; scope?: DerivedArchiveScope }
export interface ArchiveOperationInput { workspace: string; missionId: string; confirmedActive?: boolean }
export interface ArchiveOperationResult {
  ok: boolean;
  error?: string;
  requiresConfirmation?: boolean;
  activePaneIds?: string[];
}

function archiveKey(workspace: string, missionId: string): string {
  return JSON.stringify([workspacePathKey(workspace), missionId.startsWith("workspace:") ? "workspace:" : missionId]);
}

function readArchives(ctx: AppContext): ArchivedOperation[] {
  if (!ctx.DATA_DIR) return [];
  let text: string;
  try { text = fs.readFileSync(path.join(ctx.DATA_DIR, "operations-archives.json"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const data = JSON.parse(text);
  if (data?.version !== 1 || !Array.isArray(data.archives) || data.archives.some((item: any) =>
    typeof item?.workspace !== "string" || typeof item?.missionId !== "string" || typeof item?.archivedAt !== "number" ||
    (item.scope && ["actorIds", "taskIds", "handoffIds", "messageIds"].some((key) => !Array.isArray(item.scope[key]) || item.scope[key].some((id: unknown) => typeof id !== "string"))))) {
    throw new Error("Registro de operações arquivadas inválido; nenhuma operação foi reaberta.");
  }
  return data.archives;
}

/** Persistent board visibility only: never deletes history or stops any PTY. */
export function archiveOperation(ctx: AppContext, input: ArchiveOperationInput): ArchiveOperationResult {
  if (typeof input?.workspace !== "string" || !input.workspace || typeof input.missionId !== "string" || !input.missionId) {
    return { ok: false, error: "Workspace e operação são obrigatórios." };
  }
  if (!isRegisteredOrActiveWorkspace(ctx, input.workspace)) return { ok: false, error: "Workspace não está mais disponível." };
  const archives = readArchives(ctx);
  const key = archiveKey(input.workspace, input.missionId);
  const previous = archives.find((item) => archiveKey(item.workspace, item.missionId) === key);
  if (previous && !previous.scope) return { ok: true };
  const snapshot = getOperationsSnapshot(ctx, input.workspace);
  const mission = snapshot.missions.find((item) => item.id === input.missionId);
  if (!mission) return previous ? { ok: true } : { ok: false, error: "Operação não encontrada neste workspace." };
  const activePaneIds = snapshot.actors.filter((actor) => actor.live === true && mission.actorIds.includes(actor.pane_id)).map((actor) => actor.pane_id);
  if (activePaneIds.length && input.confirmedActive !== true) return { ok: false, requiresConfirmation: true, activePaneIds };
  if (!ctx.DATA_DIR) return { ok: false, error: "Diretório de dados indisponível; operação não arquivada." };
  const file = path.join(ctx.DATA_DIR, "operations-archives.json");
  const temp = `${file}.${randomUUID()}.tmp`;
  const record: ArchivedOperation = { workspace: input.workspace, missionId: input.missionId, archivedAt: Date.now() };
  if (mission.source === "derived") {
    const paneMissions = new Map(snapshot.missions.flatMap((item) => item.actorIds.map((id) => [id, item.id] as const)));
    const backendIds = new Set(snapshot.missions.filter((item) => item.source === "backend").map((item) => item.id));
    const merge = (key: keyof DerivedArchiveScope, ids: string[]) => [...new Set([...(previous?.scope?.[key] ?? []), ...ids])];
    record.scope = {
      actorIds: merge("actorIds", mission.actorIds),
      taskIds: merge("taskIds", snapshot.tasks.filter((task) => !backendIds.has(task.mission_id ?? "")).map((task) => task.id)),
      handoffIds: merge("handoffIds", snapshot.handoffs.filter((handoff) => (paneMissions.get(handoff.pane_id) ?? mission.id) === mission.id).map((handoff) => handoff.id)),
      messageIds: merge("messageIds", snapshot.messages.filter((message) => (paneMissions.get(message.from_pane) || paneMissions.get(message.to_pane) || mission.id) === mission.id).map((message) => message.id)),
    };
  }
  fs.mkdirSync(ctx.DATA_DIR, { recursive: true });
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: 1, archives: [...archives.filter((item) => archiveKey(item.workspace, item.missionId) !== key), record] }, null, 2), { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
  return { ok: true };
}

function samePath(left: string | null | undefined, right: string): boolean {
  if (!left) return false;
  const normalize = (value: string) => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function isOperationalAgent(agent: string | null | undefined): boolean {
  return Boolean(agent) && !["shell", "browser"].includes(String(agent).toLowerCase());
}

function laneForMission(actors: OperationalActor[], tasks: OperationalTask[], handoffs: OperationalHandoff[]): OperationsLane {
  const liveActors = actors.filter((actor) => actor.live !== false);
  const actorStates = liveActors.map((actor) => actor.status);
  if (actorStates.some((status) => ["blocked", "stuck", "waiting", "needs_input"].includes(status))) return "attention";
  if (liveActors.some((actor) => actor.last_outcome === "error" || Boolean(actor.last_error))) return "attention";
  if (tasks.some((task) => ["assigned", "review"].includes(task.column_name))) return "attention";
  if (actorStates.some((status) => ["pending", "running", "working", "active"].includes(status))) return "working";
  if (tasks.some((task) => ["in_progress", "running", "working"].includes(task.column_name))) return liveActors.length > 0 ? "working" : "attention";
  if (handoffs.some((handoff) => handoff.status === "blocked" || handoff.status === "error")) return "attention";
  if (tasks.length > 0 && tasks.every((task) => task.column_name === "done")) return "ready";
  if (handoffs.length > 0 && handoffs.every((handoff) => handoff.status === "done")) return "ready";
  return "idle";
}

function safeCall<T>(fn: (() => T) | undefined, fallback: T): T {
  try { return fn ? fn() : fallback; } catch { return fallback; }
}

function latestActivities(actors: OperationalActor[], messages: OperationalMessage[], handoffs: OperationalHandoff[], limit = 40): OperationalActivity[] {
  const labels = new Map(actors.map((actor) => [actor.pane_id, actor.label || actor.agent || actor.pane_id.slice(0, 8)]));
  const items: OperationalActivity[] = [];
  for (const message of messages) items.push({ id: `message:${message.id}`, kind: "message", at: message.created_at, paneId: message.from_pane, label: labels.get(message.from_pane), text: message.content.slice(0, 240), status: message.type });
  for (const handoff of handoffs) items.push({ id: `handoff:${handoff.id}`, kind: "handoff", at: handoff.submitted_at, paneId: handoff.pane_id, label: labels.get(handoff.pane_id), text: handoff.summary || `handoff ${handoff.status}`, status: handoff.status });
  for (const actor of actors) {
    if (!actor.time_updated) continue;
    items.push({ id: `actor:${actor.pane_id}:${actor.time_updated}`, kind: "actor", at: actor.time_updated, paneId: actor.pane_id, label: labels.get(actor.pane_id), text: `${labels.get(actor.pane_id)} · ${actor.status}`, status: actor.status });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function getOperationsSnapshot(ctx: AppContext, workspacePath?: string, limit = 100): OperationsSnapshot {
  const workspace = workspacePath || ctx.currentWorkspacePath;
  // History is kept in SQLite, but an old tab or late refresh must not revive
  // an unlinked workspace (nor a directory deleted outside the application).
  if (!isRegisteredOrActiveWorkspace(ctx, workspace)) {
    return { ok: true, workspace, generatedAt: Date.now(), missions: [], actors: [], tasks: [], handoffs: [], messages: [], activities: [], totals: { actors: 0, running: 0, attention: 0, tasks: 0, handoffs: 0, messages: 0 } };
  }
  const store = ctx.memoryStore as any;
  const archives = readArchives(ctx);
  const archived = new Set(archives.map((item) => archiveKey(item.workspace, item.missionId)));
  const livePanes = safeCall(() => ctx.ptyManager.list().filter((pane) => samePath(pane.cwd, workspace) || samePath(pane.workspacePath, workspace)), [] as any[]);
  const liveById = new Map(livePanes.map((pane: any) => [pane.paneId, pane]));
  const persistedActors = safeCall(() => store?.actorList?.({ workspace, includeTerminal: true })?.actors || [], [] as any[])
    .filter((actor: any) => isOperationalAgent(actor.agent));
  // Retain completed actors for historical associations without making them
  // live/visible again. Otherwise their messages become synthetic work on restart.
  const storedActors = persistedActors.filter((actor: any) => actor.status !== "idle" || actor.last_outcome == null);
  const actorsById = new Map<string, OperationalActor>();
  for (const raw of storedActors) {
    const live = liveById.has(raw.pane_id);
    // The PTY manager is authoritative for this client process. A registry row
    // left in running/pending after a restart is an orphan, not a live agent.
    if (!live && raw.status !== "idle") continue;
    actorsById.set(raw.pane_id, { ...raw, live });
  }
  for (const pane of livePanes) {
    if (!isOperationalAgent(pane.agent)) continue;
    if (actorsById.has(pane.paneId)) continue;
    actorsById.set(pane.paneId, { pane_id: pane.paneId, agent: pane.agent, cwd: pane.cwd, workspace, provider_id: pane.providerId, model: pane.model, role: "worker", status: "pending", live: true, time_created: Date.now(), time_updated: Date.now() });
  }
  const actors = Array.from(actorsById.values());
  const tasks = safeCall(() => store?.listKanbanTasks?.({ workspace, limit })?.tasks || [], [] as OperationalTask[]);
  const handoffs = safeCall(() => store?.listHandoffs?.({ workspace, limit })?.handoffs || [], [] as OperationalHandoff[]);
  const messages = safeCall(() => store?.listAgentMessages?.({ workspace, limit })?.messages || [], [] as OperationalMessage[]);
  const backendMissions = safeCall(() => store?.listMissions?.({ workspace, limit })?.missions || [], [] as any[]);

  const missionBuckets = new Map<string, { raw?: any; actors: OperationalActor[]; tasks: OperationalTask[]; handoffs: OperationalHandoff[]; messages: OperationalMessage[] }>();
  for (const mission of backendMissions) missionBuckets.set(mission.id, { raw: mission, actors: [], tasks: [], handoffs: [], messages: [] });
  // Keep associations even if an archived mission falls outside listMissions'
  // page. Its actors/tasks must not reappear as unassigned synthetic work.
  for (const item of archives) {
    if (workspacePathKey(item.workspace) === workspacePathKey(workspace) && !item.missionId.startsWith("workspace:") && !missionBuckets.has(item.missionId)) {
      missionBuckets.set(item.missionId, { actors: [], tasks: [], handoffs: [], messages: [] });
    }
  }
  const unassigned = { actors: [], tasks: [], handoffs: [], messages: [] } as { actors: OperationalActor[]; tasks: OperationalTask[]; handoffs: OperationalHandoff[]; messages: OperationalMessage[] };
  const bucketFor = (id: string | null | undefined) => id && missionBuckets.get(id);
  for (const actor of actors) (bucketFor(actor.mission_id) || unassigned).actors.push(actor);
  for (const task of tasks) (bucketFor(task.mission_id) || unassigned).tasks.push(task);
  const actorMission = new Map([...persistedActors, ...actors].map((actor) => [actor.pane_id, actor.mission_id || ""]));
  for (const handoff of handoffs) (bucketFor(actorMission.get(handoff.pane_id)) || unassigned).handoffs.push(handoff);
  for (const message of messages) (bucketFor(actorMission.get(message.from_pane) || actorMission.get(message.to_pane)) || unassigned).messages.push(message);
  const derivedArchive = archives.find((item) => archiveKey(item.workspace, item.missionId) === archiveKey(workspace, `workspace:${workspace}`));
  if (derivedArchive?.scope) {
    // A synthetic card has no durable mission id of its own. Archive its
    // members, not the workspace forever; new work may form a fresh card.
    const scope = derivedArchive.scope;
    unassigned.actors = unassigned.actors.filter((actor) => !scope.actorIds.includes(actor.pane_id));
    unassigned.tasks = unassigned.tasks.filter((task) => !scope.taskIds.includes(task.id) && !scope.actorIds.includes(task.assigned_to ?? ""));
    unassigned.handoffs = unassigned.handoffs.filter((handoff) => !scope.handoffIds.includes(handoff.id) && !scope.actorIds.includes(handoff.pane_id));
    unassigned.messages = unassigned.messages.filter((message) => !scope.messageIds.includes(message.id) && !scope.actorIds.includes(message.from_pane));
  }
  if (unassigned.actors.length || unassigned.tasks.length || unassigned.handoffs.length || unassigned.messages.length) {
    missionBuckets.set(`workspace:${workspace}`, { raw: undefined, ...unassigned });
  }
  if (missionBuckets.size === 0 && !derivedArchive) missionBuckets.set(`workspace:${workspace}`, { raw: undefined, ...unassigned });

  const visibleBuckets = Array.from(missionBuckets.entries()).filter(([id]) => !archived.has(archiveKey(workspace, id)) || (id.startsWith("workspace:") && Boolean(derivedArchive?.scope)));
  const visibleActors = visibleBuckets.flatMap(([, bucket]) => bucket.actors);
  const visibleTasks = visibleBuckets.flatMap(([, bucket]) => bucket.tasks);
  const visibleHandoffs = visibleBuckets.flatMap(([, bucket]) => bucket.handoffs);
  const visibleMessages = visibleBuckets.flatMap(([, bucket]) => bucket.messages);
  const activities = latestActivities(visibleActors, visibleMessages, visibleHandoffs);
  // O retorno é anotado no callback, não só na variável: o `.sort()` encadeado
  // depois do `.map()` corta o tipo contextual de `missions`, e sem ele o
  // ternário `raw ? "backend" : "derived"` era alargado para `string`, que não
  // encaixa no union literal de OperationalMission.source.
  const missions: OperationalMission[] = visibleBuckets.map(([id, bucket]): OperationalMission => {
    const raw = bucket.raw;
    const lane = laneForMission(bucket.actors, bucket.tasks, bucket.handoffs);
    const running = bucket.actors.filter((actor) => actor.live !== false && ["pending", "running", "working", "active"].includes(actor.status)).length;
    const attention = bucket.actors.filter((actor) => actor.live !== false && ["blocked", "stuck", "waiting", "needs_input"].includes(actor.status)).length;
    const actorIds = bucket.actors.map((actor) => actor.pane_id);
    const orchestrator = bucket.actors.find((actor) => actor.role === "orchestrator");
    const missionActivities = activities.filter((item) => !item.paneId || actorIds.includes(item.paneId));
    return { id, title: raw?.title || basename(workspace), summary: raw?.summary || (id.startsWith("workspace:") ? "Sessão operacional derivada dos agentes deste workspace." : ""), status: raw?.status || "active", workspace, worktreePath: raw?.worktreePath || null, source: raw ? "backend" : "derived", lane, actorIds, orchestratorId: orchestrator?.pane_id || null, counts: { actors: bucket.actors.length, running, attention, tasks: bucket.tasks.length, tasksDone: bucket.tasks.filter((task) => task.column_name === "done").length, handoffs: bucket.handoffs.length, messages: bucket.messages.length }, latestActivity: missionActivities[0] };
  }).sort((a, b) => (b.latestActivity?.at || 0) - (a.latestActivity?.at || 0));

  return { ok: true, workspace, generatedAt: Date.now(), missions, actors: visibleActors, tasks: visibleTasks, handoffs: visibleHandoffs, messages: visibleMessages, activities, totals: { actors: visibleActors.length, running: visibleActors.filter((actor) => ["pending", "running", "working", "active"].includes(actor.status)).length, attention: visibleActors.filter((actor) => ["blocked", "stuck", "waiting", "needs_input"].includes(actor.status)).length, tasks: visibleTasks.length, handoffs: visibleHandoffs.length, messages: visibleMessages.length } };
}
