"use strict";

const MAX_SPAWN_PROMPT_CHARS = 32_000;
const MAX_SPAWN_BATCH_CHARS = 128_000;
const MAX_SPAWN_BATCH = 16;
const MAX_QUEUED_SPAWNS = 32;

// Context selects a coordination scope; it is not an authentication/ACL check.
function paneIdentity(opts, paneId) {
  if (!paneId) return null;
  const config = opts.paneConfigs?.get?.(paneId);
  const result = opts.memoryStore?.actorGet?.({ paneId });
  const actor = result?.ok ? result.actor : null;
  const role = opts.memoryStore?.getActorRole?.({ paneId });
  if (!config && !actor && !role?.ok) return null;
  return {
    paneId,
    workspace: actor?.workspace || config?.workspacePath || config?.cwd || actor?.cwd || null,
    missionId:
      actor?.mission_id ||
      (role?.ok && role.missionId) ||
      config?.operationalMissionId ||
      config?.missionId ||
      null,
    parentPaneId: actor?.parent_pane_id || config?.parentPaneId || null,
    role: role?.ok ? role.role : actor?.role || config?.role || null,
  };
}

function workspaceKey(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized || null;
}

function validateSpawnRequest(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    return { ok: false, error: "spawn request deve ser um objeto" };
  const validPrompt = (prompt) =>
    typeof prompt === "string" && prompt.trim() && prompt.length <= MAX_SPAWN_PROMPT_CHARS;
  if (request.panes === undefined) {
    if (request.prompt !== undefined && !validPrompt(request.prompt))
      return {
        ok: false,
        error: `prompt deve ser texto não vazio de até ${MAX_SPAWN_PROMPT_CHARS} caracteres`,
      };
    return { ok: true };
  }
  if (request.prompt !== undefined)
    return { ok: false, error: "Use prompt OU panes[]. Não combine prompt de topo com um lote." };
  if (!Array.isArray(request.panes) || request.panes.length === 0)
    return { ok: false, error: "panes deve ser uma lista não vazia" };
  if (request.panes.length > MAX_SPAWN_BATCH)
    return { ok: false, error: `máximo de ${MAX_SPAWN_BATCH} panes por chamada` };
  if (request.panes.some((pane) => !pane || !validPrompt(pane.prompt)))
    return {
      ok: false,
      error: `Cada item de panes[] precisa de prompt não vazio de até ${MAX_SPAWN_PROMPT_CHARS} caracteres`,
    };
  if (request.panes.reduce((total, pane) => total + pane.prompt.length, 0) > MAX_SPAWN_BATCH_CHARS)
    return { ok: false, error: `lote excede ${MAX_SPAWN_BATCH_CHARS} caracteres de prompt` };
  return { ok: true };
}

function createSessionHandlers(opts = {}) {
  const getStore = () => opts.memoryStore;
  const assignmentOf = (paneId) =>
    getStore()?.actorGetMetadata?.({ paneId })?.metadata?.spawnAssignment || null;
  let activeSpawns = 0;
  const spawnQueue = [];
  function scheduleSpawn(request) {
    if (spawnQueue.length >= MAX_QUEUED_SPAWNS)
      return Promise.resolve({
        ok: false,
        error: "Fila de spawn cheia. Aguarde os panes já pedidos.",
      });
    return new Promise((resolve) => {
      spawnQueue.push({ request, resolve });
      pumpSpawns();
    });
  }
  function pumpSpawns() {
    while (activeSpawns < 2 && spawnQueue.length) {
      const job = spawnQueue.shift();
      activeSpawns++;
      Promise.resolve()
        .then(() => opts.spawnTask(job.request))
        .then(
          (result) => job.resolve(result || { ok: false, error: "spawn não retornou resultado" }),
          (error) => job.resolve({ ok: false, error: error?.message || String(error) })
        )
        .finally(() => {
          activeSpawns--;
          pumpSpawns();
        });
    }
  }

  const handlers = {
    validateSpawnRequest,

    // Called BEFORE terminal delivery, including harness reuse/resume paths.
    // Not called by pane_write or pane_send_message: updates are not assignments.
    persistSpawnAssignment({ paneId, prompt, name, parentPaneId, workspace, missionId }) {
      const store = getStore();
      let promptSaved = false;
      let linkedTaskId = null;
      if (!paneId || typeof prompt !== "string" || !prompt.trim())
        return { ok: false, persisted: false, error: "paneId e prompt não vazio são obrigatórios" };
      if (!store?.actorSetMetadata || !store?.actorGetMetadata || !store?.createKanbanTask)
        return { ok: false, persisted: false, error: "Persistência de atribuição indisponível" };
      try {
        const identity = paneIdentity(opts, paneId);
        if (!identity)
          return {
            ok: false,
            persisted: false,
            error: "Pane não registrado para persistir atribuição",
          };
        const ws = identity.workspace || workspace;
        const mission = identity.missionId || missionId;
        if (!ws || !mission)
          return { ok: false, persisted: false, error: "Workspace/missão do pane não confirmados" };
        const previous = assignmentOf(paneId);
        const existing = store.listKanbanTasks?.({
          workspace: ws,
          mission_id: mission,
          assigned_to: paneId,
          limit: -1,
        });
        if (
          previous?.taskId &&
          previous.prompt === prompt &&
          previous.missionId === mission &&
          workspaceKey(previous.workspace) === workspaceKey(ws) &&
          existing?.ok &&
          existing.tasks?.some((task) => task.id === previous.taskId && task.column_name !== "done")
        )
          return { ok: true, persisted: true, taskId: previous.taskId, assignment: previous };
        const assignment = {
          prompt,
          name: name || prompt.split(/\r?\n/)[0].slice(0, 100),
          workspace: ws,
          missionId: mission,
          parentPaneId: identity.parentPaneId || parentPaneId || null,
          taskId: null,
          createdAt: Date.now(),
          promptDelivered: false,
        };
        const saved = store.actorSetMetadata({ paneId, metadata: { spawnAssignment: assignment } });
        if (!saved?.ok)
          return {
            ok: false,
            persisted: false,
            error: saved?.error || "Não foi possível salvar o prompt",
          };
        promptSaved = true;
        // A retry after a partial metadata failure must not duplicate the task.
        const matching =
          existing?.ok &&
          existing.tasks?.find(
            (task) => task.description === prompt && task.column_name !== "done"
          );
        const created = matching
          ? { ok: true, id: matching.id }
          : store.createKanbanTask({
              title: assignment.name,
              description: prompt,
              column: "assigned",
              assigned_to: paneId,
              workspace: ws,
              mission_id: mission,
            });
        if (!created?.ok || !created.id)
          return {
            ok: false,
            persisted: true,
            taskId: null,
            assignment,
            error: created?.error || "Prompt salvo, mas a task não foi criada",
          };
        assignment.taskId = created.id;
        linkedTaskId = created.id;
        const linked = store.actorSetMetadata({
          paneId,
          metadata: { spawnAssignment: assignment },
        });
        if (!linked?.ok)
          return {
            ok: false,
            persisted: true,
            taskId: created.id,
            assignment,
            error: linked?.error || "Task criada, mas vínculo no pane falhou",
          };
        return { ok: true, persisted: true, taskId: created.id, assignment };
      } catch (error) {
        return {
          ok: false,
          persisted: promptSaved,
          taskId: linkedTaskId,
          error: error.message || String(error),
        };
      }
    },

    setSpawnPromptDelivery({ paneId, delivered, state, error }) {
      try {
        const assignment = assignmentOf(paneId);
        if (!assignment) return { ok: false, error: "Atribuição de spawn não encontrada" };
        return getStore().actorSetMetadata({
          paneId,
          metadata: {
            spawnAssignment: {
              ...assignment,
              promptDelivered: delivered === true,
              deliveryState: state || (delivered ? "submitted" : "not_submitted"),
              deliveryError: delivered ? null : error || "Prompt não entregue",
              deliveryUpdatedAt: Date.now(),
            },
          },
        });
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },

    async taskList(args = {}, context = {}) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      const callerPaneId = context.fromPaneId || context.callerPaneId || opts.getCallerPaneId?.();
      const caller = paneIdentity(opts, callerPaneId || args.assigned_to);
      let workspace = args.workspace?.trim();
      const explicitScope = Boolean(workspace || args.mission_id);
      // Explicit mission/workspace queries retain cross-workspace compatibility.
      if (!workspace && args.mission_id) {
        const result = store.getMission?.({ id: args.mission_id });
        if (!result?.ok || !result.mission?.workspace)
          return { ok: false, tasks: [], count: 0, error: "Workspace da missão não encontrado" };
        workspace = result.mission.workspace;
      }
      if (!workspace) workspace = caller?.workspace;
      if (!workspace)
        return { ok: true, tasks: [], count: 0, workspace: null, scopeRequired: true };
      return store.listKanbanTasks({
        column: args.column,
        assigned_to: args.assigned_to,
        workspace,
        limit: args.limit,
        mission_id: args.mission_id || (!explicitScope ? caller?.missionId : undefined),
      });
    },

    async missionContext({ paneId, workspace, missionId } = {}) {
      const store = getStore();
      if (!store) return { ok: false, error: "memory store not available" };
      try {
        const identity = paneIdentity(opts, paneId);
        const ws = workspace || identity?.workspace;
        if (!ws)
          return { ok: false, error: "Workspace do pane não encontrado", tasks: [], myTasks: [] };
        const boundMission = missionId || identity?.missionId;
        const result = boundMission
          ? store.getMission({ id: boundMission })
          : store.resolveActiveMission({ workspace: ws });
        const mission =
          result?.ok && workspaceKey(result.mission?.workspace) === workspaceKey(ws)
            ? result.mission
            : null;
        const currentRole = store.getActorRole?.({ paneId }) || { role: null, missionId: null };
        const ownScope =
          workspaceKey(identity?.workspace) === workspaceKey(ws) &&
          (!missionId || identity?.missionId === missionId);
        const parent = paneIdentity(opts, identity?.parentPaneId);
        let orchestrator =
          ownScope &&
          parent &&
          parent.paneId !== paneId &&
          workspaceKey(parent.workspace) === workspaceKey(ws)
            ? { paneId: parent.paneId, source: "parent" }
            : null;
        let ambiguous = false;
        let action = "ask_if_orchestrator";
        if (ownScope && currentRole.role === "orchestrator") {
          orchestrator = { paneId };
          action = "already_set";
        } else if (orchestrator) action = "adopt";
        else if (mission) {
          const orchs = store.findOrchestrator({ missionId: mission.id, workspace: ws });
          const ids = (orchs?.orchestrators || []).filter((id) => id !== paneId);
          if (ids.length === 1) {
            orchestrator = { paneId: ids[0] };
            action = "adopt";
          }
          ambiguous = ids.length > 1;
        }
        if (ownScope && action === "adopt" && mission)
          store.setActorRole?.({ paneId, role: "worker", missionId: mission.id });
        const taskResult = mission
          ? store.listKanbanTasks({ workspace: ws, mission_id: mission.id, limit: -1 })
          : null;
        const tasks = taskResult?.ok
          ? (taskResult.tasks || []).filter((task) => task.column_name !== "done")
          : [];
        const saved = assignmentOf(paneId);
        const spawnAssignment =
          saved &&
          workspaceKey(saved.workspace) === workspaceKey(ws) &&
          saved.missionId === mission?.id
            ? saved
            : null;
        const brief = opts.getSpawnBrief?.(paneId) || opts.paneConfigs?.get?.(paneId)?.spawnBrief;
        return {
          ok: true,
          mission,
          myRole: currentRole,
          orchestrator,
          ambiguous,
          action,
          tasks,
          myTasks: tasks.filter((task) => task.assigned_to === paneId),
          spawnAssignment,
          ...(brief && ownScope ? { spawnBrief: brief } : {}),
        };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    },
  };
  if (typeof opts.spawnTask === "function")
    handlers.spawnTask = async (request) => {
      const verdict = validateSpawnRequest(request);
      if (!verdict.ok) return verdict;
      if (request?.panes !== undefined) {
        const { panes, ...shared } = request;
        const results = await Promise.all(
          panes.map(async (pane, index) => ({
            ...(await scheduleSpawn({ ...shared, ...pane })),
            index,
          }))
        );
        return {
          ok: results.every((result) => result.ok !== false && result.paneId),
          panes: results,
        };
      }
      return scheduleSpawn(request || {});
    };
  return handlers;
}

module.exports = {
  createSessionHandlers,
  paneIdentity,
  workspaceKey,
  validateSpawnRequest,
  MAX_SPAWN_PROMPT_CHARS,
  MAX_SPAWN_BATCH_CHARS,
};
