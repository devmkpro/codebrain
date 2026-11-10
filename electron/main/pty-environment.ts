const ESSENTIAL_ENV = [
  "PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "OS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_ARCHITEW6432",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "SystemDrive",
  "ALLUSERSPROFILE", "PROGRAMDATA", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432",
  "NODE", "NODE_PATH", "NVM_DIR", "FNM_DIR", "SHELL",
  "LANG", "LC_ALL", "LC_CTYPE",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "OPENAI_API_KEY",
  "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY",
  "MIMO_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY",
  "CODEBRAIN_WORKSPACE", "CODEBRAIN_MCP_URL", "CODEBRAIN_MCP_SSE_URL", "CODEBRAIN_MCP_PORT",
  "CLAUDE_CODE_USE_GEMINI", "CLAUDE_CODE_MODEL_NAME", "CLAUDE_CODE_PROVIDER_NAME",
  "CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED", "CLAUDE_CODE_DISABLE_PROXY",
  "GEMINI_BASE_URL", "ANTHROPIC_BASE_URL", "ANTHROPIC_REAL_BASE_URL", "OPENAI_BASE_URL",
  "MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL", "OPENAI_MODEL",
] as const;

/** Inherit only approved host keys; explicit per-pane provider overrides remain supported. */
export function buildPtyEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  overrides: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const windows = platform === "win32";
  const inherited = new Map(Object.entries(source).map(([key, value]) => [windows ? key.toLowerCase() : key, value]));
  const env: Record<string, string> = {};
  const names = new Map<string, string>();
  for (const key of ESSENTIAL_ENV) {
    const lookup = windows ? key.toLowerCase() : key;
    if (names.has(lookup)) continue;
    names.set(lookup, key);
    const value = inherited.get(lookup);
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "1" });
  for (const [key, value] of Object.entries(overrides)) {
    // Windows env names are case-insensitive; never emit conflicting PATH/Path.
    const canonical = windows ? names.get(key.toLowerCase()) || key : key;
    env[canonical] = value;
  }
  // Some desktop launchers omit OS. This fallback describes the actual platform,
  // rather than guessing architecture or importing the full parent environment.
  if (windows && !env.OS) env.OS = "Windows_NT";
  return env;
}
