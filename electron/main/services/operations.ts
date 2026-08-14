import * as path from "node:path";
import type { AppContext } from "../context";
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
  const store = ctx.memoryStore as any;
  const livePanes = safeCall(() => ctx.ptyManager.list().filter((pane) => samePath(pane.cwd, workspace) || samePath(pane.workspacePath, workspace)), [] as any[]);
  const liveById = new Map(livePanes.map((pane: any) => [pane.paneId, pane]));
  const storedActors = safeCall(() => store?.actorList?.({ workspace, includeTerminal: false })?.actors || [], [] as any[])
    .filter((actor: any) => isOperationalAgent(actor.agent));
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
  const unassigned = { actors: [], tasks: [], handoffs: [], messages: [] } as { actors: OperationalActor[]; tasks: OperationalTask[]; handoffs: OperationalHandoff[]; messages: OperationalMessage[] };
  const bucketFor = (id: string | null | undefined) => id && missionBuckets.get(id);
  for (const actor of actors) (bucketFor(actor.mission_id) || unassigned).actors.push(actor);
  for (const task of tasks) (bucketFor(task.mission_id) || unassigned).tasks.push(task);
  const actorMission = new Map(actors.map((actor) => [actor.pane_id, actor.mission_id || ""]));
  for (const handoff of handoffs) (bucketFor(actorMission.get(handoff.pane_id)) || unassigned).handoffs.push(handoff);
  for (const message of messages) (bucketFor(actorMission.get(message.from_pane) || actorMission.get(message.to_pane)) || unassigned).messages.push(message);
  if (unassigned.actors.length || unassigned.tasks.length || unassigned.handoffs.length || unassigned.messages.length) {
    if (missionBuckets.size === 1) {
      const onlyMission = missionBuckets.values().next().value;
      onlyMission.actors.push(...unassigned.actors);
      onlyMission.tasks.push(...unassigned.tasks);
      onlyMission.handoffs.push(...unassigned.handoffs);
      onlyMission.messages.push(...unassigned.messages);
    } else {
      missionBuckets.set(`workspace:${workspace}`, { raw: undefined, ...unassigned });
    }
  }
  if (missionBuckets.size === 0) missionBuckets.set(`workspace:${workspace}`, { raw: undefined, ...unassigned });

  const activities = latestActivities(actors, messages, handoffs);
  const missions: OperationalMission[] = Array.from(missionBuckets.entries()).map(([id, bucket]) => {
    const raw = bucket.raw;
    const lane = laneForMission(bucket.actors, bucket.tasks, bucket.handoffs);
    const running = bucket.actors.filter((actor) => actor.live !== false && ["pending", "running", "working", "active"].includes(actor.status)).length;
    const attention = bucket.actors.filter((actor) => actor.live !== false && ["blocked", "stuck", "waiting", "needs_input"].includes(actor.status)).length;
    const actorIds = bucket.actors.map((actor) => actor.pane_id);
    const orchestrator = bucket.actors.find((actor) => actor.role === "orchestrator");
    const missionActivities = activities.filter((item) => !item.paneId || actorIds.includes(item.paneId));
    return { id, title: raw?.title || basename(workspace), summary: raw?.summary || (id.startsWith("workspace:") ? "Sessão operacional derivada dos agentes deste workspace." : ""), status: raw?.status || "active", workspace, worktreePath: raw?.worktreePath || null, source: raw ? "backend" : "derived", lane, actorIds, orchestratorId: orchestrator?.pane_id || null, counts: { actors: bucket.actors.length, running, attention, tasks: bucket.tasks.length, tasksDone: bucket.tasks.filter((task) => task.column_name === "done").length, handoffs: bucket.handoffs.length, messages: bucket.messages.length }, latestActivity: missionActivities[0] };
  }).sort((a, b) => (b.latestActivity?.at || 0) - (a.latestActivity?.at || 0));

  return { ok: true, workspace, generatedAt: Date.now(), missions, actors, tasks, handoffs, messages, activities, totals: { actors: actors.length, running: actors.filter((actor) => ["pending", "running", "working", "active"].includes(actor.status)).length, attention: actors.filter((actor) => ["blocked", "stuck", "waiting", "needs_input"].includes(actor.status)).length, tasks: tasks.length, handoffs: handoffs.length, messages: messages.length } };
}
