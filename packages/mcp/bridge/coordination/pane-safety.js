"use strict";

// Prompts that only an idle interactive shell leaves as the last visible line:
// POSIX user@host:path$ / [user@host dir]# , PowerShell "PS C:\dir>" and cmd "C:\dir>".
// Program prompts (python >>>, mysql>, sudo password) never match, so they stay unknown.
const IDLE_PROMPT_PATTERNS = [
  /^(?:\([^()]{1,64}\)\s*)?[\w.-]{1,64}@[\w.-]{1,253}(?::[^\s$#]{0,1024})?\s?[$#]\s*$/,
  /^(?:\([^()]{1,64}\)\s*)?\[[\w.-]{1,64}@[\w.-]{1,253}(?:\s[^\]]{0,1024})?\]\s?[$#]\s*$/,
  /^PS [A-Za-z]:\\[^<>|"\r\n]{0,1024}>\s*$/,
  /^[A-Za-z]:\\[^<>|"\r\n]{0,1024}>\s*$/,
];

/**
 * Infer idleness for shells without explicit execution state (e.g. SSH terminals,
 * where the remote shell emits no integration markers). Returns false only when
 * the last non-blank line is an idle shell prompt; otherwise null (unknown).
 */
function inferShellBusyFromPrompt(ptyManager, paneId) {
  if (typeof ptyManager?.read !== "function") return null;
  let lines;
  try { lines = ptyManager.read(paneId, 20); } catch { return null; }
  if (!Array.isArray(lines)) return null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").trimEnd();
    if (!line.trim()) continue;
    return IDLE_PROMPT_PATTERNS.some((pattern) => pattern.test(line.trimStart())) ? false : null;
  }
  return null;
}

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
  let shellBusy = busyValues.includes(true) ? true : busyValues.includes(false) ? false : null;
  if (shellBusy === null && agent === "shell") shellBusy = inferShellBusyFromPrompt(ptyManager, paneId);
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

module.exports = { paneSafety, shellWriteGuard, inferShellBusyFromPrompt };
