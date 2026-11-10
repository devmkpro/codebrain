/**
 * Declarative registry of every CLI Codebrain can run as a harness.
 * Adding a CLI means adding one entry here. The module is pure: no Electron,
 * no filesystem writes, so it can be unit tested and imported from anywhere.
 *
 * `spawn: "native"` entries keep their hand-written branch in pane-spawn.ts and
 * are listed for detection, install and capabilities. Entries with a `generic`
 * block run through the single registry-driven branch (harness-spawn.ts).
 *
 * Every flag below was read from the binary's --help or from the vendor's docs;
 * `confirmedBy` says which. A CLI that could not be confirmed must stay
 * `verified: false` with no `generic` flags at all.
 */
import * as os from "node:os";
import * as path from "node:path";

export type NativeHarnessId = "openclaude" | "claude" | "codex" | "gemini" | "kimi" | "cursor" | "copilot";
export type GenericHarnessId = "kiro" | "opencode" | "grok" | "antigravity" | "hermes" | "muse" | "commandcode";
export type HarnessId = NativeHarnessId | GenericHarnessId;

/** binary = `--help` of the installed CLI; official-docs = vendor documentation; existing-branch = pre-existing per-CLI code. */
export type ConfirmedBy = "binary" | "official-docs" | "existing-branch";

export interface HarnessCapabilities {
  model: boolean;
  effort: boolean;
  systemPrompt: boolean;
  mcp: boolean;
  resume: boolean;
  multiAccount: boolean;
  skills: boolean;
  skipPermissions: boolean;
}

export type InstallRecipe =
  | { via: "npm"; pkg: string }
  | { via: "script"; unix?: string; win?: string; description: string };

export type McpWiring =
  /** Merge `mcpServers.codebrain` into a JSON file under the workspace. */
  | { via: "json-file"; relPath: string; entry: "url" | "serverUrl" | "typed-http" }
  /** Upsert `[mcp_servers.codebrain]` in a TOML file under the workspace. */
  | { via: "toml-file"; relPath: string }
  /** Inline config through OPENCODE_CONFIG_CONTENT; nothing is written to disk. */
  | { via: "opencode-env" }
  /** Upsert into $HERMES_HOME/config.yaml; Hermes has no project-level config. */
  | { via: "hermes-yaml" }
  /** Upsert into ~/.config/muse/settings.json; no project-level config is documented. */
  | { via: "muse-settings" };

export type InstructionsWiring =
  /** A session-specific Kiro custom agent selected with --agent. */
  | { via: "kiro-agent" }
  /** A file the CLI always loads. `unlessExists` lists files that would shadow it. */
  | { via: "file"; relPath: string; frontmatter?: string; unlessExists?: string[] }
  /** Inline text through a flag; skipped above maxChars (Windows limits the command line). */
  | { via: "flag"; flag: string; maxChars: number }
  /** Prompt file listed in OPENCODE_CONFIG_CONTENT.instructions. */
  | { via: "opencode-env" }
  /** Written as a skill and preloaded with `hermes chat -s`. */
  | { via: "hermes-skill" };

export interface GenericSpawnSpec {
  /** Arguments before the flags, e.g. `chat`. */
  subcommand?: string[];
  model?: { flag: string; aliases?: string[]; requiresSlash?: boolean };
  effort?: { flag: string };
  skipPermissions?: string[];
  resume?: { flag: string; aliases?: string[] };
  mcp?: McpWiring;
  instructions?: InstructionsWiring;
}

export interface HarnessEntry {
  id: HarnessId;
  label: string;
  /** Omitted means platform support has not been verified. */
  supportedPlatforms?: NodeJS.Platform[];
  /** Candidates in lookup order; the first found wins. */
  binaries: string[];
  /** Only report the CLI as found when `--version` succeeds. */
  requireVersion?: boolean;
  install: InstallRecipe | null;
  /** Command that signs in. For CLIs that sign in inside the session, opening it is the login. */
  loginCommand: string | null;
  capabilities: HarnessCapabilities;
  /** Env var that moves the whole config/credential dir; only set when documented. */
  accountEnvVar: string | null;
  skillsDir: { project?: string; user?: string } | null;
  verified: boolean;
  confirmedBy: ConfirmedBy;
  docsUrl: string;
  spawn: "native" | "generic";
  generic?: GenericSpawnSpec;
  /** Install dirs that may not be on PATH yet. `~` and %VAR% are expanded. */
  searchDirs?: { win?: string[]; unix?: string[] };
}

const caps = (enabled: Array<keyof HarnessCapabilities>): HarnessCapabilities => ({
  model: enabled.includes("model"),
  effort: enabled.includes("effort"),
  systemPrompt: enabled.includes("systemPrompt"),
  mcp: enabled.includes("mcp"),
  resume: enabled.includes("resume"),
  multiAccount: enabled.includes("multiAccount"),
  skills: enabled.includes("skills"),
  skipPermissions: enabled.includes("skipPermissions"),
});

const ALL_CAPS: Array<keyof HarnessCapabilities> = [
  "model", "effort", "systemPrompt", "mcp", "resume", "multiAccount", "skills", "skipPermissions",
];

const psInstaller = (command: string) => `powershell -ExecutionPolicy Bypass -c "${command}"`;

export const CLI_REGISTRY: readonly HarnessEntry[] = [
  {
    id: "openclaude",
    label: "OpenClaude",
    binaries: ["openclaude"],
    install: { via: "npm", pkg: "@gitlawb/openclaude" },
    loginCommand: "openclaude auth login",
    capabilities: caps(ALL_CAPS),
    accountEnvVar: "OPENCLAUDE_CONFIG_DIR",
    skillsDir: null,
    verified: true,
    confirmedBy: "binary",
    docsUrl: "https://www.npmjs.com/package/@gitlawb/openclaude",
    spawn: "native",
  },
  {
    id: "claude",
    label: "Claude Code",
    binaries: ["claude"],
    install: { via: "npm", pkg: "@anthropic-ai/claude-code" },
    loginCommand: "claude auth login",
    capabilities: caps(ALL_CAPS),
    accountEnvVar: "CLAUDE_CONFIG_DIR",
    skillsDir: { project: ".claude/skills", user: "~/.claude/skills" },
    verified: true,
    confirmedBy: "binary",
    docsUrl: "https://code.claude.com/docs",
    spawn: "native",
  },
  {
    id: "codex",
    label: "Codex",
    binaries: ["codex"],
    install: { via: "npm", pkg: "@openai/codex" },
    loginCommand: "codex login",
    capabilities: caps(ALL_CAPS),
    accountEnvVar: "CODEX_HOME",
    skillsDir: { user: "~/.codex/skills" },
    verified: true,
    confirmedBy: "binary",
    docsUrl: "https://developers.openai.com/codex/cli",
    spawn: "native",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    binaries: ["gemini"],
    install: { via: "npm", pkg: "@google/gemini-cli" },
    loginCommand: "gemini",
    capabilities: caps(["model", "systemPrompt", "mcp", "resume", "multiAccount", "skills", "skipPermissions"]),
    accountEnvVar: "GEMINI_CLI_HOME",
    skillsDir: { project: ".gemini/skills", user: "~/.gemini/skills" },
    verified: true,
    confirmedBy: "existing-branch",
    docsUrl: "https://geminicli.com/docs/reference/configuration/",
    spawn: "native",
  },
  {
    id: "kimi",
    label: "Kimi Code",
    binaries: ["kimi"],
    install: {
      via: "script",
      unix: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
      win: psInstaller("irm https://code.kimi.com/kimi-code/install.ps1 | iex"),
      description: "Script oficial do Kimi Code CLI",
    },
    loginCommand: "kimi",
    capabilities: caps(["model", "systemPrompt", "mcp", "multiAccount", "skills"]),
    accountEnvVar: "KIMI_CODE_HOME",
    skillsDir: { project: ".kimi/skills", user: "~/.kimi/skills" },
    verified: true,
    confirmedBy: "existing-branch",
    docsUrl: "https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/environment-variables.html",
    spawn: "native",
  },
  {
    id: "cursor",
    label: "Cursor CLI",
    binaries: ["cursor-agent"],
    requireVersion: true,
    install: {
      via: "script",
      unix: "curl -fsS https://cursor.com/install | bash",
      win: psInstaller("irm 'https://cursor.com/install?win32=true' | iex"),
      description: "Script oficial do Cursor CLI",
    },
    loginCommand: "cursor-agent login",
    capabilities: caps(["model", "systemPrompt", "mcp", "resume", "skipPermissions"]),
    accountEnvVar: null,
    skillsDir: null,
    verified: true,
    confirmedBy: "existing-branch",
    docsUrl: "https://cursor.com/docs/cli/installation",
    spawn: "native",
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    binaries: ["copilot"],
    install: { via: "npm", pkg: "@github/copilot" },
    loginCommand: "copilot",
    capabilities: caps(["model", "systemPrompt", "mcp", "multiAccount", "skills"]),
    accountEnvVar: "COPILOT_HOME",
    skillsDir: { user: "~/.copilot/skills" },
    verified: true,
    confirmedBy: "existing-branch",
    docsUrl: "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference",
    spawn: "native",
  },
  {
    // kiro-cli 3.1.0: every flag read from `kiro-cli chat --help`; the workspace
    // mcp.json was confirmed by `kiro-cli mcp list`. Do not use the `kiro`
    // command: that one launches the desktop IDE.
    id: "kiro",
    label: "Kiro CLI",
    // Native Windows 11 PowerShell support; do not infer Windows 10 or WSL.
    supportedPlatforms: ["darwin", "linux", "win32"],
    binaries: ["kiro-cli"],
    install: {
      via: "script",
      // The docs publish no Windows one-liner, so Windows stays manual.
      unix: "curl -fsSL https://cli.kiro.dev/install | bash",
      description: "Script oficial do Kiro CLI",
    },
    loginCommand: "kiro-cli login",
    capabilities: caps(ALL_CAPS),
    accountEnvVar: "KIRO_HOME",
    skillsDir: { project: ".kiro/skills", user: "~/.kiro/skills" },
    verified: true,
    confirmedBy: "binary",
    docsUrl: "https://kiro.dev/docs/reference/cli-commands/",
    spawn: "generic",
    searchDirs: { win: ["%LOCALAPPDATA%\\Kiro-Cli"] },
    generic: {
      subcommand: ["chat"],
      model: { flag: "--model" },
      effort: { flag: "--effort" },
      // --trust-workspace lets the workspace mcp.json load without a blocking prompt.
      skipPermissions: ["--trust-all-tools", "--trust-workspace"],
      resume: { flag: "--resume-id", aliases: ["--resume", "-r", "--resume-picker"] },
      mcp: { via: "json-file", relPath: ".kiro/settings/mcp.json", entry: "url" },
      instructions: { via: "kiro-agent" },
    },
  },
  {
    // Permissions and MCP go through OPENCODE_CONFIG_CONTENT in the object forms
    // that both the 1.x docs and the current schema accept.
    id: "opencode",
    label: "OpenCode",
    binaries: ["opencode"],
    install: { via: "npm", pkg: "opencode-ai" },
    loginCommand: "opencode auth login",
    // OPENCODE_CONFIG_DIR does not move auth.json, so it is not a real account switch.
    capabilities: caps(["model", "systemPrompt", "mcp", "resume", "skipPermissions"]),
    accountEnvVar: null,
    skillsDir: null,
    verified: true,
    confirmedBy: "official-docs",
    docsUrl: "https://docs.opencode.ai/docs/cli",
    spawn: "generic",
    searchDirs: { unix: ["~/.opencode/bin"] },
    generic: {
      model: { flag: "--model", aliases: ["-m"], requiresSlash: true },
      resume: { flag: "--session", aliases: ["-s", "--continue", "-c"] },
      mcp: { via: "opencode-env" },
      instructions: { via: "opencode-env" },
    },
  },
  {
    // A community npm package (@vibe-kit/grok-cli) also installs a `grok` command.
    id: "grok",
    label: "Grok Build",
    binaries: ["grok"],
    install: {
      via: "script",
      unix: "curl -fsSL https://x.ai/cli/install.sh | bash",
      win: psInstaller("irm https://x.ai/cli/install.ps1 | iex"),
      description: "Script oficial do Grok Build",
    },
    loginCommand: "grok login",
    capabilities: caps(ALL_CAPS),
    accountEnvVar: "GROK_HOME",
    skillsDir: { project: ".grok/skills", user: "~/.grok/skills" },
    verified: true,
    confirmedBy: "official-docs",
    docsUrl: "https://docs.x.ai/build/cli/reference",
    spawn: "generic",
    searchDirs: { win: ["~\\.grok\\bin"], unix: ["~/.grok/bin"] },
    generic: {
      model: { flag: "--model", aliases: ["-m"] },
      effort: { flag: "--effort" },
      skipPermissions: ["--yolo"],
      resume: { flag: "--resume", aliases: ["-r", "--continue", "-c"] },
      mcp: { via: "toml-file", relPath: ".grok/config.toml" },
      instructions: { via: "flag", flag: "--rules", maxChars: 24_000 },
    },
  },
  {
    id: "antigravity",
    label: "Antigravity CLI",
    binaries: ["agy"],
    install: {
      via: "script",
      unix: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
      win: psInstaller("irm https://antigravity.google/cli/install.ps1 | iex"),
      description: "Script oficial do Antigravity CLI",
    },
    // Signs in through the browser on first run; there is no login subcommand.
    loginCommand: "agy",
    capabilities: caps(["model", "effort", "mcp", "resume", "skills", "skipPermissions"]),
    accountEnvVar: null,
    skillsDir: { project: ".agents/skills", user: "~/.gemini/antigravity-cli/skills" },
    verified: true,
    confirmedBy: "official-docs",
    docsUrl: "https://antigravity.google/docs/cli/reference",
    spawn: "generic",
    searchDirs: { win: ["%LOCALAPPDATA%\\agy\\bin"] },
    generic: {
      model: { flag: "--model" },
      effort: { flag: "--effort" },
      skipPermissions: ["--dangerously-skip-permissions"],
      resume: { flag: "--conversation", aliases: ["--continue", "-c"] },
      mcp: { via: "json-file", relPath: ".agents/mcp_config.json", entry: "serverUrl" },
      // Workspace rules are shared by all panes. No isolated system-prompt
      // transport is verified, so never put pane identity/role in a rule file.
    },
  },
  {
    // A project context file would shadow the repo's AGENTS.md (first match wins),
    // so the prompt is a preloaded skill instead. No `chat` effort flag is documented.
    id: "hermes",
    label: "Hermes Agent",
    binaries: ["hermes"],
    install: {
      via: "script",
      unix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      win: psInstaller("iex (irm https://hermes-agent.nousresearch.com/install.ps1)"),
      description: "Script oficial do Hermes Agent",
    },
    loginCommand: "hermes model",
    capabilities: caps(["model", "systemPrompt", "mcp", "resume", "multiAccount", "skills", "skipPermissions"]),
    accountEnvVar: "HERMES_HOME",
    skillsDir: { user: "$HERMES_HOME/skills" },
    verified: true,
    confirmedBy: "official-docs",
    docsUrl: "https://hermes-agent.nousresearch.com/docs/reference/cli-commands",
    spawn: "generic",
    searchDirs: { win: ["%LOCALAPPDATA%\\hermes\\bin"] },
    generic: {
      subcommand: ["chat"],
      model: { flag: "--model", aliases: ["-m"] },
      skipPermissions: ["--yolo"],
      resume: { flag: "--resume", aliases: ["-r", "--continue", "-c"] },
      mcp: { via: "hermes-yaml" },
      instructions: { via: "hermes-skill" },
    },
  },
  {
    // Project instructions are AGENTS.md/CLAUDE.md variants whose precedence is not
    // documented, so no prompt is injected. Resume is `muse resume`, a separate
    // command rather than a flag. PyPI's unrelated muse-cli also installs `muse`.
    id: "muse",
    label: "Muse Code",
    binaries: ["muse"],
    install: {
      via: "script",
      unix: "curl -fsSL https://dev.meta.ai/install.sh | sh",
      win: psInstaller("irm https://dev.meta.ai/install.ps1 | iex"),
      description: "Script oficial do Muse Code",
    },
    // Signs in inside the session (/login); there is no login subcommand.
    loginCommand: "muse",
    capabilities: caps(["model", "effort", "mcp", "skills", "skipPermissions"]),
    accountEnvVar: null,
    skillsDir: { project: ".agents/skills", user: "$XDG_CONFIG_HOME/muse/skills" },
    verified: true,
    confirmedBy: "official-docs",
    docsUrl: "https://dev.meta.ai/docs/muse-code/configuration",
    spawn: "generic",
    generic: {
      model: { flag: "--model" },
      effort: { flag: "--reasoning-effort" },
      skipPermissions: ["--yolo", "--trust-workspace"],
      mcp: { via: "muse-settings" },
    },
  },
  {
    // The `cmd` alias is deliberately absent: on Windows it is the system shell.
    id: "commandcode",
    label: "Command Code",
    binaries: ["command-code"],
    install: { via: "npm", pkg: "command-code" },
    loginCommand: "command-code login",
    capabilities: caps(["model", "effort", "mcp", "resume", "skills", "skipPermissions"]),
    accountEnvVar: null,
    skillsDir: { project: ".commandcode/skills", user: "~/.commandcode/skills" },
    verified: true,
    confirmedBy: "official-docs",
    docsUrl: "https://commandcode.ai/docs/reference/cli",
    spawn: "generic",
    generic: {
      model: { flag: "--model", aliases: ["-m"] },
      effort: { flag: "--effort" },
      skipPermissions: ["--yolo", "--trust"],
      resume: { flag: "--resume", aliases: ["-r", "--sessions", "--session", "--continue", "-c"] },
      // Claude Code and Command Code both read `type: "http"` in .mcp.json.
      mcp: { via: "json-file", relPath: ".mcp.json", entry: "typed-http" },
      // AGENTS.md is shared across panes and can be shadowed by project rules.
      // No verified isolated system-prompt transport is available.
    },
  },
];

const BY_ID = new Map<string, HarnessEntry>(CLI_REGISTRY.map((entry) => [entry.id, entry]));

export const getHarness = (id: string | undefined | null): HarnessEntry | undefined =>
  id ? BY_ID.get(id) : undefined;

/** The entry when `agent` runs through the registry-driven branch. */
export function getGenericHarness(agent: string | undefined | null): HarnessEntry | undefined {
  const entry = getHarness(agent);
  return entry?.spawn === "generic" ? entry : undefined;
}

export const isGenericHarness = (agent: string | undefined | null): boolean => Boolean(getGenericHarness(agent));

/** Binary and leading arguments for pty-manager's AGENT_DEFAULTS. */
export function harnessAgentDefaults(): Record<string, { binary: string; args: string[] }> {
  const defaults: Record<string, { binary: string; args: string[] }> = {};
  for (const entry of CLI_REGISTRY) {
    if (entry.spawn !== "generic") continue;
    defaults[entry.id] = { binary: entry.binaries[0], args: entry.verified ? [...(entry.generic?.subcommand ?? [])] : [] };
  }
  return defaults;
}

export function installRecipes(): Record<string, InstallRecipe> {
  const recipes: Record<string, InstallRecipe> = {};
  for (const entry of CLI_REGISTRY) if (entry.install) recipes[entry.id] = entry.install;
  return recipes;
}

/** CLIs whose config and credentials can be moved by a documented env var. */
export function accountCapableClis(): Array<{ id: HarnessId; envVar: string }> {
  return CLI_REGISTRY.flatMap((entry) => (entry.verified && entry.accountEnvVar ? [{ id: entry.id, envVar: entry.accountEnvVar }] : []));
}

/** Absolute candidates for a binary in its entry's known install directories. */
export function harnessSearchPaths(
  binary: string,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): string[] {
  const isWin = platform === "win32";
  const join = isWin ? path.win32.join : path.posix.join;
  const paths: string[] = [];
  for (const entry of CLI_REGISTRY) {
    if (!entry.binaries.includes(binary)) continue;
    for (const dir of (isWin ? entry.searchDirs?.win : entry.searchDirs?.unix) ?? []) {
      let unresolved = false;
      const expanded = dir
        .replace(/^~/, home)
        .replace(/%([A-Z_]+)%/g, (_match, name: string) => {
          const value = env[name];
          if (!value) unresolved = true;
          return value ?? "";
        });
      if (unresolved) continue;
      for (const ext of isWin ? [".exe", ".cmd", ".bat", ""] : [""]) paths.push(join(expanded, `${binary}${ext}`));
    }
  }
  return paths;
}

export interface DetectedCli {
  found: boolean;
  path?: string;
  version?: string;
}

/** Probes each entry's binaries in order and returns one result per id. */
export function detectHarnesses(
  entries: readonly HarnessEntry[],
  probe: (binary: string, requireVersion: boolean) => DetectedCli,
): Record<string, DetectedCli> {
  const detected: Record<string, DetectedCli> = {};
  for (const entry of entries) {
    let result: DetectedCli = { found: false };
    for (const binary of entry.binaries) {
      result = probe(binary, entry.requireVersion ?? false);
      if (result.found) break;
    }
    detected[entry.id] = result;
  }
  return detected;
}

export interface HarnessView {
  id: HarnessId;
  label: string;
  supportedPlatforms?: NodeJS.Platform[];
  found: boolean;
  path?: string;
  version?: string;
  verified: boolean;
  capabilities: HarnessCapabilities;
  loginCommand: string | null;
  docsUrl: string;
}

/** Shape returned by the `cli:registry` IPC. */
export function buildRegistryView(detected: Record<string, DetectedCli | { path: string } | undefined>): HarnessView[] {
  return CLI_REGISTRY.map((entry) => {
    const info = detected[entry.id] as DetectedCli | undefined;
    return {
      id: entry.id,
      label: entry.label,
      supportedPlatforms: entry.supportedPlatforms ? [...entry.supportedPlatforms] : undefined,
      found: info?.found ?? false,
      path: info?.path,
      version: info?.version,
      verified: entry.verified,
      capabilities: entry.verified ? { ...entry.capabilities } : caps([]),
      loginCommand: entry.loginCommand,
      docsUrl: entry.docsUrl,
    };
  });
}

// ── Argument building ───────────────────────────────────────────────────────

export interface HarnessArgsInput {
  model?: string;
  effort?: string;
  skipPermissions?: boolean;
  resumeSessionId?: string;
  /** Prompt text, used only by `via: "flag"` instructions. */
  instructions?: string;
}

const hasFlag = (args: readonly string[], flag: string): boolean =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

/** Appends the flags an entry supports, without overriding what the caller passed. */
export function buildHarnessArgs(entry: HarnessEntry, input: HarnessArgsInput, existing: readonly string[] = []): string[] {
  const spec = entry.generic;
  const args = [...existing];
  if (!entry.verified || !spec) return args;
  // Everything after -- is positional text, even if it looks like a flag.
  const terminator = args.indexOf("--");
  const positional = terminator < 0 ? [] : args.splice(terminator);

  if (spec.model && input.model && (!spec.model.requiresSlash || input.model.includes("/"))) {
    const names = [spec.model.flag, ...(spec.model.aliases ?? [])];
    if (!names.some((name) => hasFlag(args, name))) args.push(spec.model.flag, input.model);
  }
  if (spec.effort && input.effort && !hasFlag(args, spec.effort.flag)) {
    args.push(spec.effort.flag, input.effort);
  }
  if (input.skipPermissions) {
    for (const flag of spec.skipPermissions ?? []) if (!hasFlag(args, flag)) args.push(flag);
  }
  if (spec.resume && input.resumeSessionId && ![spec.resume.flag, ...(spec.resume.aliases ?? [])].some((flag) => hasFlag(args, flag))) {
    args.push(spec.resume.flag, input.resumeSessionId);
  }
  if (
    spec.instructions?.via === "flag" &&
    input.instructions &&
    input.instructions.length <= spec.instructions.maxChars &&
    !hasFlag(args, spec.instructions.flag)
  ) {
    args.push(spec.instructions.flag, input.instructions);
  }
  return [...args, ...positional];
}

// ── Config rendering (pure; harness-spawn.ts does the IO) ───────────────────

export const CODEBRAIN_MCP_NAME = "codebrain";

/** Marks files Codebrain owns, so a user's file with the same name is never replaced. */
export const MANAGED_FILE_MARKER = "<!-- codebrain:managed -->";

export function jsonMcpEntry(kind: "url" | "serverUrl" | "typed-http", url: string): Record<string, string> {
  if (kind === "serverUrl") return { serverUrl: url };
  if (kind === "typed-http") return { type: "http", url };
  return { url };
}

/**
 * Sets one server under `topKey`, keeping everything else. Returns null when the
 * existing text is not a JSON object: a file we cannot read is not ours to replace.
 */
export function mergeJsonServer(
  existing: string | null,
  topKey: string,
  entry: Record<string, unknown>,
  seed: Record<string, unknown> = {},
): string | null {
  let root: Record<string, any> = {};
  if (existing !== null && existing.trim()) {
    try {
      root = JSON.parse(existing);
    } catch {
      return null;
    }
    if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  }
  const servers = root[topKey] ?? {};
  if (typeof servers !== "object" || Array.isArray(servers)) return null;
  const merged = { ...seed, ...root, [topKey]: { ...servers, [CODEBRAIN_MCP_NAME]: entry } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/** Replaces the codebrain table in TOML text, including any of its sub-tables. */
export function upsertTomlMcpServer(existing: string, url: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of existing.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      skipping = /^\[\s*mcp_servers\.codebrain\s*[\].]/.test(trimmed);
    }
    if (!skipping) kept.push(line);
  }
  const body = kept.join("\n").trimEnd();
  const block = `[mcp_servers.${CODEBRAIN_MCP_NAME}]\nurl = ${JSON.stringify(url)}\n`;
  return body ? `${body}\n\n${block}` : block;
}

/**
 * Sets `mcp_servers.codebrain` in YAML text. Done on text so the user's comments
 * survive. Returns null for a non-empty inline map, which cannot be edited safely.
 */
export function upsertHermesMcpServer(existing: string, url: string): string | null {
  const lines = existing.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^mcp_servers\s*:/.test(line));
  const entry = (indent: string) => [`${indent}${CODEBRAIN_MCP_NAME}:`, `${indent}${indent}url: ${JSON.stringify(url)}`];

  if (headerIndex === -1) {
    const body = existing.trimEnd();
    const block = ["mcp_servers:", ...entry("  ")].join("\n");
    return `${body ? `${body}\n\n` : ""}${block}\n`;
  }

  const inline = lines[headerIndex].replace(/^mcp_servers\s*:/, "").replace(/#.*$/, "").trim();
  if (inline && !/^(\{\s*\}|null|~)$/.test(inline)) return null;
  lines[headerIndex] = "mcp_servers:";

  // The block ends at the next line that starts at column zero.
  let end = headerIndex + 1;
  while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]) || lines[end].startsWith("#"))) end += 1;
  while (end > headerIndex + 1 && lines[end - 1].trim() === "") end -= 1;

  const block = lines.slice(headerIndex + 1, end);
  const firstChild = block.find((line) => line.trim() && !line.trim().startsWith("#"));
  const indent = firstChild?.match(/^\s+/)?.[0] ?? "  ";
  const childHeader = new RegExp(`^${indent}${CODEBRAIN_MCP_NAME}\\s*:`);
  const kept: string[] = [];
  let skipping = false;
  for (const line of block) {
    if (childHeader.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() && line.match(/^\s*/)![0].length <= indent.length) skipping = false;
    if (!skipping) kept.push(line);
  }

  return [...lines.slice(0, headerIndex + 1), ...kept, ...entry(indent), ...lines.slice(end)].join("\n");
}

/** Inline config for OPENCODE_CONFIG_CONTENT. */
export function buildOpencodeConfig(input: {
  mcpUrl?: string;
  promptFile?: string;
  skipPermissions?: boolean;
}): string {
  const config: Record<string, unknown> = {};
  if (input.mcpUrl) {
    config.mcp = { [CODEBRAIN_MCP_NAME]: { type: "remote", url: input.mcpUrl, enabled: true, oauth: false } };
  }
  if (input.promptFile) config.instructions = [input.promptFile.replace(/\\/g, "/")];
  if (input.skipPermissions) config.permission = "allow";
  return JSON.stringify(config);
}

export function hermesHome(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env["HERMES_HOME"]) return env["HERMES_HOME"];
  if (platform === "win32") return path.win32.join(env["LOCALAPPDATA"] ?? path.win32.join(home, "AppData", "Local"), "hermes");
  return path.posix.join(home, ".hermes");
}

export function museSettingsPath(env: Record<string, string | undefined>, home: string = os.homedir()): string {
  return path.join(env["XDG_CONFIG_HOME"] ?? path.join(home, ".config"), "muse", "settings.json");
}
