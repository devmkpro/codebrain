"use strict";

function paneSafety(ptyManager, opts, paneId) {
  const live = ptyManager.list?.().find((pane) => pane.paneId === paneId);
  const config = opts.paneConfigs?.get?.(paneId);
  const store = opts.memoryStore;
  const actorResult = store?.actorGet?.({ paneId });
  const actor = actorResult?.ok ? actorResult.actor : null;
  const metadata = store?.actorGetMetadata?.({ paneId })?.metadata || {};
  // Explicit runtime state only. Quiet output does NOT mean a dev server exited.
  const state = opts.getPaneExecutionState?.(paneId) || {};
  const ownerPaneId =
    config?.ownerPaneId ||
    metadata.ownerPaneId ||
    config?.parentPaneId ||
    actor?.parent_pane_id ||
    null;
  const agent = config?.agent || live?.agent || actor?.agent;
  const busyValues = [
    state.busy,
    state.longRunning,
    config?.shellBusy,
    config?.longRunning,
    live?.shellBusy,
    metadata.shellBusy,
  ];
  const shellBusy = busyValues.includes(true) ? true : busyValues.includes(false) ? false : null;
  return {
    agent,
    ownerPaneId,
    shell: state.shell || config?.shellExecutable || live?.shell || null,
    shellBusy,
    readOnly: Boolean(state.readOnly || config?.readOnly || metadata.readOnly),
  };
}

// Coordination guard, NOT authentication or an ACL. fromPaneId is self-reported
// unless the transport binds it; no access permission is ever granted by it.
function shellWriteGuard(info, fromPaneId) {
  if (info.agent !== "shell") return { ok: true };
  const details = {
    ownerPaneId: info.ownerPaneId,
    shell: info.shell,
    shellBusy: info.shellBusy,
    identityVerified: false,
  };
  if (!fromPaneId || !info.ownerPaneId)
    return {
      ok: false,
      ...details,
      code: "shell_owner_unknown",
      error: "Owner/caller do shell não confirmado. Use um shell próprio.",
    };
  if (info.ownerPaneId !== fromPaneId)
    return {
      ok: false,
      ...details,
      code: "shell_owner_mismatch",
      error: "Shell pertence a outro pane. Abra um shell próprio, sem reuse.",
    };
  if (info.readOnly || info.shellBusy !== false)
    return {
      ok: false,
      ...details,
      code: info.shellBusy ? "shell_busy" : "shell_state_unknown",
      error:
        "Shell ocupado, somente leitura ou sem estado de execução confirmado; stdin não foi alterado.",
    };
  return { ok: true };
}

module.exports = { paneSafety, shellWriteGuard };
