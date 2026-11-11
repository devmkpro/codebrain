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
    let line = String(lines[index] ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").trimEnd();
    if (!line.trim()) continue;
    // Some PTYs preserve a carriage-return redraw as two identical prompts.
    // Accept only repeated copies of the same complete prompt, never arbitrary
    // output before a prompt-shaped suffix.
    if (line.includes("\r")) {
      const redraws = line.split("\r").map((part) => part.trim()).filter(Boolean);
      if (redraws.length && redraws.every((part) => part === redraws[0])) line = redraws[0];
    }
    return IDLE_PROMPT_PATTERNS.some((pattern) => pattern.test(line.trimStart())) ? false : null;
  }
  return null;
}

// Only recognize the visible git diff pager, not arbitrary interactive prompts.
function isGitDiffPager(ptyManager, paneId) {
  if (typeof ptyManager?.read !== "function") return false;
  let lines;
  try { lines = ptyManager.read(paneId, 200); } catch { return false; }
  if (!Array.isArray(lines)) return false;
  const clean = lines.map((line) => String(line ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").trim());
  const last = clean.findLastIndex((line) => line.length > 0);
  if (last < 0 || !/^(?::|\(END\))$/.test(clean[last])) return false;
  const command = clean.findLastIndex((line, index) => index < last && /(?:^|\s)git\s+(?:--no-pager\s+)?diff(?:\s|$)/.test(line));
  return command >= 0 && clean.slice(command + 1, last).some((line) => line.startsWith("diff --git "));
}

// systemctl status/cat frequently launches less even when --no-pager is
// intended. Only permit a raw q for its recognizable completed pager screen.
function isSystemctlPager(ptyManager, paneId) {
  if (typeof ptyManager?.read !== "function") return false;
  let lines;
  try { lines = ptyManager.read(paneId, 200); } catch { return false; }
  if (!Array.isArray(lines)) return false;
  const clean = lines.map((line) => String(line ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").trim());
  const last = clean.findLastIndex(Boolean);
  if (last < 0 || !/^(?:\(END\)|lines \d+(?:-\d+)?\/\d+ \(END\))$/.test(clean[last])) return false;
  const command = clean.findLastIndex((line, index) => index < last && /(?:^|\s)systemctl\s+(?:(?:--user|--system|--no-pager|--full)\s+)*(?:cat|status|list-units|list-unit-files)(?:\s|$)/.test(line));
  return command >= 0 && clean.slice(command + 1, last).some((line) => /^(?:# \/|\[Unit\]|[●*] |Loaded:|UNIT\s)/.test(line));
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

module.exports = { paneSafety, shellWriteGuard, inferShellBusyFromPrompt, isGitDiffPager, isSystemctlPager };
