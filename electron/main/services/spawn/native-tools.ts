/**
 * Native Claude-compatible tool allowlists.
 *
 * Claude Code and OpenClaude receive the schemas for every native tool unless
 * --tools is passed.
 * Keeping the policy here makes the prompt cheaper and gives each pane role a
 * structural capability boundary instead of a prose prohibition.
 */
export const NATIVE_TOOLS_BY_ROLE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  orchestrator: Object.freeze(["Read", "Grep", "Glob", "TodoWrite"]),
  worker: Object.freeze(["Read", "Edit", "Write", "Grep", "Glob", "Bash", "TodoWrite"]),
  "ui-tester": Object.freeze(["Read", "Grep", "Glob"]),
});

const TOOLS_FLAG = "--tools";
const CLAUDE_COMPATIBLE_AGENTS = new Set(["claude", "openclaude"]);

export function nativeToolsForRole(role?: string): readonly string[] {
  return NATIVE_TOOLS_BY_ROLE[role ?? ""] ?? NATIVE_TOOLS_BY_ROLE.worker;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

/**
 * Add the allowlist to CLIs that implement Claude's native tool contract.
 * Codex and Gemini have different flag semantics, so they are intentionally
 * left untouched here; their shared MCP surface is reduced in packages/mcp.
 */
export function withNativeToolAllowlist(
  args: readonly string[],
  agent: string,
  role?: string
): string[] {
  if (!CLAUDE_COMPATIBLE_AGENTS.has(agent) || hasFlag(args, TOOLS_FLAG)) return [...args];
  return [...args, TOOLS_FLAG, nativeToolsForRole(role).join(",")];
}

/**
 * Codex has no `--system-prompt-file` flag. Its supported transport is the
 * `developer_instructions` config override, so keep the compact prompt in the
 * same provider-neutral builder and pass its contents through TOML safely.
 */
export function withCodexDeveloperInstructions(args: readonly string[], prompt: string): string[] {
  if (
    args.some(
      (arg) => arg === "developer_instructions" || arg.startsWith("developer_instructions=")
    )
  ) {
    return [...args];
  }
  return [...args, "-c", `developer_instructions=${JSON.stringify(prompt)}`];
}
