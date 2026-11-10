/** Explicit task only; never pass generated system context, environment or argv here. */
export interface SpawnBrief {
  id: string;
  prompt: string;
  truncated: boolean;
  delivery: {
    state: "pending" | "not_submitted" | "submitted" | "uncertain";
    promptSubmitted: boolean;
    error?: string;
  };
}

export interface ShellMetadata {
  kind: "cmd" | "powershell" | "pwsh" | "bash" | "zsh" | "fish" | "sh" | "unknown";
  executable: string;
  commandSyntax: "cmd" | "powershell" | "posix" | "unknown";
}

export function createSpawnBrief(paneId: string, task?: string): SpawnBrief | undefined {
  if (!task?.trim()) return undefined;
  const redacted = task.trim()
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(Authorization\s*:\s*Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b((?:[A-Z_]*API_KEY|[A-Z_]*TOKEN|[A-Z_]*PASSWORD|[A-Z_]*SECRET)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  return { id: `brief_${paneId}`, prompt: redacted.slice(0, 12_000), truncated: redacted.length > 12_000,
    delivery: { state: "pending", promptSubmitted: false } };
}

export function shellMetadata(agent: string, executable: string): ShellMetadata | undefined {
  if (agent !== "shell") return undefined;
  const name = executable.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.exe$/, "");
  const kind: ShellMetadata["kind"] = ["cmd", "powershell", "pwsh", "bash", "zsh", "fish", "sh"].includes(name ?? "")
    ? name as ShellMetadata["kind"] : "unknown";
  const commandSyntax = kind === "cmd" ? "cmd" : kind === "powershell" || kind === "pwsh" ? "powershell"
    : kind === "unknown" ? "unknown" : "posix";
  return { kind, executable, commandSyntax };
}

/** Lightweight projection for list/events. The prompt text is deliberately absent. */
export function briefSummary(brief?: SpawnBrief) {
  return brief ? { hasInitialPrompt: true, initialPromptId: brief.id,
    promptSubmitted: brief.delivery.promptSubmitted, promptDeliveryState: brief.delivery.state } : {};
}
