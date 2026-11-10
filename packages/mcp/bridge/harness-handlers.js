"use strict";

/* Spawn dirigido por tarefa: junta decisor, tabela, contrato e recibo em cima
   do `spawnPane` existente, que continua sendo quem abre o pane. */

const os = require("node:os");
const path = require("node:path");
const { decideHarness, deriveName, loadHarnessTable } = require("./harness.js");
const { consultDecider } = require("./decider.js");
const { createSessionHandlers } = require("./session-handlers.js");

const MAX_CATALOG_RESULTS = 60;
const operationalMission = (id) =>
  typeof id === "string" && id.startsWith("mission_") ? id : null;

const HANDOFF_CLAUSE = (expect) => {
  const output = expect?.schema
    ? ` Inclua também output no formato: ${JSON.stringify(expect.schema)}.`
    : "";
  return (
    "\n\nAo concluir, sua última ação é mcp__codebrain__handoff_submit com seu paneId, summary (a conclusão em até 2 frases), " +
    'status e evidence { commands: [{ cmd, exitCode }], checks: [{ requirement, status: "pass"|"fail", verify }], files: [...], tested }.' +
    output
  );
};

function createHarnessHandlers(paneHandlers, ptyManager, opts = {}) {
  const paneContracts = opts.paneContracts ?? new Map();
  const reservedPanes = new Set();
  let allocationQueue = Promise.resolve();
  const session = createSessionHandlers({ ...opts, spawnTask: request => {
    if (request.prompt !== undefined) return spawnOne(request);
    return paneHandlers.spawnPane(request);
  } });
  function allocatePane(request) {
    const allocation = allocationQueue.then(async () => {
      const result = await paneHandlers.spawnPane({
        ...request,
        reuseIdle: request.reuseIdle && reservedPanes.size === 0,
      });
      if (result.paneId) reservedPanes.add(result.paneId);
      return result;
    });
    allocationQueue = allocation.catch(() => {});
    return allocation;
  }
  const tablePath = () =>
    opts.harnessTablePath || path.join(os.homedir(), ".codebrain", "harness.json");

  const callerAgentOf = (parentPaneId) => {
    if (!parentPaneId) return null;
    try {
      return ptyManager.list().find((pane) => pane.paneId === parentPaneId)?.agent ?? null;
    } catch {
      return null;
    }
  };

  const idleWorkers = () => {
    try {
      const { actors } = paneHandlers.actorList?.({}) ?? opts.actorList?.({}) ?? {};
      return (actors ?? [])
        .filter(
          (actor) =>
            actor.available &&
            actor.description &&
            !reservedPanes.has(actor.pane_id) &&
            ptyManager.hasPane(actor.pane_id)
        )
        .slice(0, 8)
        .map((actor) => ({
          paneId: actor.pane_id,
          description: String(actor.description).slice(0, 160),
        }));
    } catch {
      return [];
    }
  };

  async function consult(prompt, table, explicitTask) {
    if (!table.decider?.enabled || explicitTask || !prompt) return { decision: null, reason: null };
    return consultDecider({
      prompt,
      rows: table.rows,
      agents: opts.listAgents?.() ?? [],
      idleWorkers: idleWorkers(),
      config: table.decider,
      credentials: opts.getDeciderCredentials?.(table.decider) ?? null,
      runCliDecider: opts.runCliDecider,
    });
  }

  function compatibleResume(paneId, request, decision, providerId) {
    if (
      !paneId ||
      request.reuseIdle === false ||
      decision.review ||
      paneId === request.parentPaneId ||
      reservedPanes.has(paneId)
    )
      return false;
    if (!idleWorkers().some((worker) => worker.paneId === paneId)) return false;
    const pane = ptyManager.list().find((candidate) => candidate.paneId === paneId);
    const config = opts.paneConfigs?.get(paneId);
    // Missing identity is not proof that the worker has the requested runtime.
    if (!pane || !config || pane.status !== "idle") return false;
    const cwd = request.cwd ?? opts.getCurrentWorkspacePath?.();
    if (!cwd || !config.cwd || path.resolve(cwd) !== path.resolve(config.cwd)) return false;
    if (decision.agent && config.agent !== decision.agent) return false;
    if (providerId && config.providerId !== providerId) return false;
    if (decision.model && config.model !== decision.model) return false;
    if ((config.accountId ?? null) !== (decision.accountId ?? null)) return false;
    if ((config.effort ?? null) !== (decision.effort ?? null)) return false;
    if ((config.agentName ?? null) !== (decision.agentName ?? null)) return false;
    if ((config.parentPaneId ?? null) !== (request.parentPaneId ?? null)) return false;
    if ((config.missionId ?? null) !== (request.missionId ?? null)) return false;
    if (!Array.isArray(config.allowedSkills)) return false;
    const actualSkills = new Set(config.allowedSkills);
    return (
      actualSkills.size === new Set(decision.skills).size &&
      decision.skills.every((skill) => actualSkills.has(skill))
    );
  }

  function composePrompt(request, decision) {
    const persona = decision.agentName ? opts.getAgentInstructions?.(decision.agentName) : null;
    const parts = [];
    if (persona) parts.push(persona);
    if (decision.skills.length) parts.push(`Skills desta tarefa: ${decision.skills.join(", ")}.`);
    parts.push(request.prompt);
    return parts.join("\n\n") + HANDOFF_CLAUSE(request.expect);
  }

  function recordReceipt(request, decision, result, name) {
    try {
      opts.memoryStore?.recordSpawnReceipt?.({
        workspace: result.cwd ?? request.cwd ?? opts.getCurrentWorkspacePath?.() ?? null,
        missionId:
          operationalMission(result.missionId) ??
          operationalMission(opts.paneConfigs?.get(result.paneId)?.missionId) ??
          operationalMission(request.missionId),
        paneId: result.paneId,
        name,
        taskId: decision.taskId,
        taskName: decision.taskName,
        source: decision.source,
        agent: result.agent ?? opts.paneConfigs?.get(result.paneId)?.agent ?? decision.agent,
        model: result.model ?? opts.paneConfigs?.get(result.paneId)?.model ?? decision.model,
        effort: decision.effort,
        account: decision.accountLabel,
        skills: decision.skills,
        receipt: decision.receipt,
        reused: Boolean(result.reused),
      });
    } catch {}
  }

  async function spawnOne(request) {
    if (typeof request?.prompt !== "string" || !request.prompt.trim())
      return { ok: false, error: "prompt obrigatório" };
    const parent = opts.paneConfigs?.get(request.parentPaneId);
    request = {
      ...request,
      cwd: request.cwd ?? parent?.cwd ?? opts.getCurrentWorkspacePath?.(),
      missionId:
        operationalMission(request.missionId) ?? operationalMission(parent?.missionId) ?? undefined,
    };
    const table = loadHarnessTable(tablePath());
    const { decision: decided, reason: deciderNote } = await consult(
      request.prompt,
      table,
      request.task
    );

    const decision = decideHarness({
      task: request.task,
      prompt: request.prompt,
      explicit: {
        agent: request.agent,
        model: request.model,
        providerId: request.providerId,
        effort: request.effort,
        skills: request.skills,
        accountId: request.accountId,
      },
      table,
      availableClis: opts.getAvailableClis?.() ?? null,
      callerAgent: callerAgentOf(request.parentPaneId),
      pickAccount: opts.pickAccount,
      resolveSkills: opts.resolveSkills,
      decided,
      deciderNote,
    });

    const name =
      (typeof request.name === "string" ? request.name.trim() : "") || deriveName(request.prompt);
    const prompt = composePrompt(request, decision);

    // Sem CLI explícita, o Claude nativo não pode herdar o provider do pane anterior.
    const providerId =
      request.providerId ?? (decision.agent === "claude" ? "claude-oauth" : undefined);
    const resumePaneId = compatibleResume(decided?.resumePaneId, request, decision, providerId)
      ? decided.resumePaneId
      : null;
    if (resumePaneId) reservedPanes.add(resumePaneId);
    let leasedPaneId = resumePaneId;

    try {
      const result = resumePaneId
        ? { ok: true, paneId: resumePaneId, reused: true }
        : await allocatePane({
            agent: decision.agent ?? undefined,
            cwd: request.cwd,
            providerId,
            model: decision.model ?? undefined,
            label: name,
            description: request.prompt.slice(0, 200),
            parentPaneId: request.parentPaneId,
            // Revisar com quem escreveu é revisar com o mesmo ponto cego.
            reuseIdle: decision.review ? false : (request.reuseIdle ?? true),
            effort: decision.effort,
            allowedSkills: decision.skills,
            agentName: decision.agentName ?? undefined,
            accountId: decision.accountId ?? undefined,
            accountLabel: decision.accountLabel ?? undefined,
            taskType: decision.taskId,
            missionId: request.missionId,
            spawnBrief: request.prompt,
            // Deliver only after installing the contract: a fast worker can
            // hand off while the main process is still awaiting prompt delivery.
          });
      leasedPaneId = result.paneId;

      if (result.ok === false || !result.paneId)
        return {
          ok: false,
          name,
          error: result.error ?? "spawn falhou",
          receipt: decision.receipt,
        };

      const assignment = session.persistSpawnAssignment({
        paneId: result.paneId, prompt: request.prompt, name,
        workspace: result.workspacePath || result.cwd || request.cwd,
        missionId: operationalMission(result.missionId) || operationalMission(request.missionId),
        parentPaneId: request.parentPaneId,
      });
      if (!assignment.ok) return {
        ok: false, paneId: result.paneId, name, receipt: decision.receipt,
        taskId: assignment.taskId || null, assignmentPersisted: assignment.persisted,
        promptDelivered: false, error: assignment.error,
      };

      const previousContract = paneContracts.get(result.paneId);
      if (request.expect) {
        paneContracts.set(result.paneId, {
          schema: request.expect.schema ?? null,
          retries: request.expect.retries ?? 1,
          requireEvidence: request.expect.requireEvidence !== false,
          attempts: 0,
        });
      } else paneContracts.delete(result.paneId);
      let delivery;
      const codebrainContext = result.codebrainContext ?? opts.paneConfigs?.get(result.paneId)?.codebrainContext;
      const deliveryPrompt = codebrainContext ? `${codebrainContext}\n\n${prompt}` : prompt;
      try {
        delivery =
          !result.reused && typeof ptyManager.submitWhenReady === "function"
            ? await ptyManager.submitWhenReady(result.paneId, deliveryPrompt, {
                timeoutMs: 20_000,
                quietMs: 800,
                pollMs: 100,
              })
            : await paneHandlers.writePane(result.paneId, deliveryPrompt, true);
      } catch (err) {
        delivery = { ok: false, deliveryState: "uncertain", error: err?.message ?? String(err) };
      }
      const deliveryState = delivery?.deliveryState || (delivery?.ok ? "submitted" : "not_submitted");
      const deliveryRecord = session.setSpawnPromptDelivery({ paneId: result.paneId, delivered: delivery?.ok === true, state: deliveryState, error: delivery?.error });
      if (!delivery?.ok) {
        if (previousContract) paneContracts.set(result.paneId, previousContract);
        else paneContracts.delete(result.paneId);
        return {
          ok: false,
          paneId: result.paneId,
          name,
          taskId: assignment.taskId, assignmentPersisted: true, promptDelivered: false, deliveryState,
          error: delivery?.error ?? "prompt não foi entregue",
          receipt: decision.receipt,
        };
      }
      if (result.reused) {
        opts.paneLabels?.set(result.paneId, name);
        if (resumePaneId)
          paneHandlers.emitPaneMeta?.(result.paneId, { label: name, taskType: decision.taskId });
        const config = opts.paneConfigs?.get(result.paneId);
        decision.effort = config?.effort ?? null;
        decision.skills = config?.allowedSkills ?? [];
        decision.accountLabel = config?.accountLabel ?? null;
        decision.receipt = `▸ tipo ${decision.taskName} (${decision.source})\n▸ pane ${result.paneId} retomado · ${config?.agent ?? result.agent ?? "CLI desconhecida"} · ${config?.model ?? result.model ?? "modelo não informado"}\n▸ esforço ${decision.effort ?? "não informado"} · skills ${decision.skills.join(", ") || "não informadas"}`;
      }
      recordReceipt(request, decision, result, name);

      return {
        ok: true,
        paneId: result.paneId,
        name,
        taskId: assignment.taskId,
        assignmentPersisted: true,
        promptDelivered: true,
        deliveryState,
        ...(deliveryRecord?.ok ? {} : { persistenceWarning: deliveryRecord?.error || "Estado de entrega não persistido" }),
        reused: Boolean(result.reused),
        agent: result.agent ?? opts.paneConfigs?.get(result.paneId)?.agent ?? decision.agent,
        model: result.model ?? opts.paneConfigs?.get(result.paneId)?.model ?? decision.model,
        missionId:
          operationalMission(result.missionId) ??
          operationalMission(opts.paneConfigs?.get(result.paneId)?.missionId) ??
          operationalMission(request.missionId),
        effort: decision.effort,
        skills: decision.skills,
        taskType: decision.taskId,
        decidedBy: decision.source,
        receipt: decision.receipt,
      };
    } finally {
      if (leasedPaneId) reservedPanes.delete(leasedPaneId);
    }
  }

  return {
    /** Com `prompt` ou `panes`: spawn dirigido. Sem eles, o pane abre vazio. */
    spawnTask: session.spawnTask,

    harnessTable() {
      return { ok: true, table: loadHarnessTable(tablePath()) };
    },

    /** Busca enxuta: descrição curta e sem caminhos, para caber no contexto do agente. */
    catalogList({ kind, query } = {}) {
      const needle = query?.trim().toLowerCase();
      const items = (opts.scanCatalog?.() ?? [])
        .filter((item) => !kind || item.kind === kind)
        .filter(
          (item) => !needle || `${item.name} ${item.description}`.toLowerCase().includes(needle)
        )
        .slice(0, MAX_CATALOG_RESULTS)
        .map((item) => ({
          kind: item.kind,
          name: item.name,
          description: item.description.slice(0, 200),
          clis: [...new Set(item.installedIn.map((install) => install.cli))],
          disabled: item.disabled,
        }));
      return { ok: true, items };
    },

    findingAdd(args = {}) {
      if (!opts.memoryStore?.findingAdd) return { ok: false, error: "memória indisponível" };
      return opts.memoryStore.findingAdd({
        ...args,
        workspace: args.workspace ?? opts.getCurrentWorkspacePath?.(),
      });
    },
    findingUpdate(args = {}) {
      if (!opts.memoryStore?.findingUpdate) return { ok: false, error: "memória indisponível" };
      return opts.memoryStore.findingUpdate({
        ...args,
        workspace: args.workspace ?? opts.getCurrentWorkspacePath?.(),
      });
    },
    findingList(args = {}) {
      if (!opts.memoryStore?.findingList) return { ok: false, error: "memória indisponível" };
      return opts.memoryStore.findingList({
        ...args,
        workspace: args.workspace ?? opts.getCurrentWorkspacePath?.(),
      });
    },
  };
}

module.exports = { createHarnessHandlers };
