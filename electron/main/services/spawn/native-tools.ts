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
  role?: string,
  allowSkillTool = false
): string[] {
  if (!CLAUDE_COMPATIBLE_AGENTS.has(agent) || hasFlag(args, TOOLS_FLAG)) return [...args];
  const tools = allowSkillTool ? [...nativeToolsForRole(role), "Skill"] : nativeToolsForRole(role);
  return [...args, TOOLS_FLAG, tools.join(",")];
}

/**
 * Whitelist de skills: tudo que está instalado e não foi liberado fica negado.
 * Só CLIs com o contrato de permissões do Claude têm como aplicar isso; nas
 * demais a whitelist vai apenas como indicação no prompt.
 */
export function withSkillWhitelist(
  args: readonly string[],
  agent: string,
  allowedSkills: readonly string[] | undefined,
  installedSkills: readonly string[]
): string[] {
  if (!CLAUDE_COMPATIBLE_AGENTS.has(agent) || !allowedSkills?.length) return [...args];
  const allowed = new Set(allowedSkills);
  const denied = installedSkills.filter((skill) => !allowed.has(skill));
  if (!denied.length) return [...args];
  return [...args, "--disallowedTools", denied.map((skill) => `Skill(${skill})`).join(",")];
}

const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

function hasCodexConfig(args: readonly string[], key: string): boolean {
  return args.some((arg, index) => {
    const value = arg === "-c" || arg === "--config" ? args[index + 1]
      : arg.startsWith("--config=") ? arg.slice("--config=".length)
      : arg.startsWith("-c=") ? arg.slice(3) : undefined;
    return value !== undefined && new RegExp(`^${key}\\s*=`).test(value);
  });
}

/**
 * Esforço dos ramos nativos Claude/OpenClaude e Codex. Os harnesses genéricos
 * usam o contrato declarado no registro.
 */
export function withEffort(args: readonly string[], cli: string, effort: string | undefined): string[] {
  if (!effort || !EFFORT_LEVELS.has(effort)) return [...args];
  if (CLAUDE_COMPATIBLE_AGENTS.has(cli) && !hasFlag(args, "--effort")) return [...args, "--effort", effort];
  if (cli === "codex" && !hasCodexConfig(args, "model_reasoning_effort")) {
    return [...args, "-c", `model_reasoning_effort="${effort}"`];
  }
  return [...args];
}

/**
 * Codex has no `--system-prompt-file` flag. Its supported transport is the
 * `developer_instructions` config override, so keep the compact prompt in the
 * same provider-neutral builder and pass its contents through TOML safely.
 */
export function withCodexDeveloperInstructions(args: readonly string[], prompt: string): string[] {
  if (hasCodexConfig(args, "developer_instructions")) {
    return [...args];
  }
  return [...args, "-c", `developer_instructions=${JSON.stringify(prompt)}`];
}
