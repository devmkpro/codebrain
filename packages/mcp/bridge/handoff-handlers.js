"use strict";

const { paneIdentity, workspaceKey } = require("./session-handlers.js");

// Never fall back to an arbitrary orchestrator in another project.
function resolveHandoffDestination(ptyManager, opts, paneId) {
  const identity = paneIdentity(opts, paneId);
  if (!identity?.workspace) return null;
  const sameWorkspace = (id) => {
    const target = paneIdentity(opts, id);
    const live = ptyManager.list?.().find((pane) => pane.paneId === id);
    return (
      id !== paneId &&
      ptyManager.hasPane(id) &&
      target &&
      live &&
      live?.agent !== "shell" &&
      live?.agent !== "browser" &&
      workspaceKey(target.workspace) === workspaceKey(identity.workspace)
    );
  };
  if (identity.parentPaneId && sameWorkspace(identity.parentPaneId)) return identity.parentPaneId;
  if (!identity.missionId) return null;
  const found = opts.memoryStore?.findOrchestrator?.({
    missionId: identity.missionId,
    workspace: identity.workspace,
  });
  const candidates = (found?.ok ? found.orchestrators : [])?.filter(sameWorkspace) || [];
  return candidates.length === 1 ? candidates[0] : null;
}

async function deliverHandoff(ptyManager, opts, queues, paneId, message) {
  const destination = resolveHandoffDestination(ptyManager, opts, paneId);
  if (!destination)
    return {
      paneId: null,
      delivered: false,
      acknowledged: false,
      reason: "no_unambiguous_destination",
    };
  // Queue by destination, not sender: two workers must not interleave a paste.
  const previous = queues.get(destination) || Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      if (resolveHandoffDestination(ptyManager, opts, paneId) !== destination)
        return {
          paneId: destination,
          delivered: false,
          acknowledged: false,
          reason: "destination_changed",
        };
      try {
        ptyManager.writeSilent(destination, message, true);
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!ptyManager.hasPane(destination))
          return {
            paneId: destination,
            delivered: false,
            acknowledged: false,
            reason: "destination_closed",
          };
        ptyManager.write(destination, "\r");
        // This confirms only the stdin write, not that the remote model read it.
        return { paneId: destination, delivered: true, acknowledged: false, via: "stdin" };
      } catch (error) {
        return {
          paneId: destination,
          delivered: false,
          acknowledged: false,
          reason: "write_failed",
          error: error.message || String(error),
        };
      }
    });
  queues.set(destination, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(destination) === pending) queues.delete(destination);
  }
}

module.exports = { resolveHandoffDestination, deliverHandoff };
