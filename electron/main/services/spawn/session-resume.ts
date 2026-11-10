/** Exact native resume contracts. Never use a process-global "last" session. */
const contracts: Record<string, { selector: string; evidence: string }> = {
  claude: { selector: "--resume", evidence: "https://code.claude.com/docs/en/cli-reference (also installed --help)" },
  openclaude: { selector: "--resume", evidence: "openclaude --help: --resume [value]" },
  codex: { selector: "resume", evidence: "codex resume --help: [SESSION_ID]" },
  gemini: { selector: "--resume", evidence: "https://geminicli.com/docs/cli/session-management/" },
  kimi: { selector: "--session", evidence: "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions" },
  cursor: { selector: "--resume", evidence: "https://cursor.com/docs/cli/reference/parameters" },
  copilot: { selector: "--resume", evidence: "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference" },
  kiro: { selector: "--resume-id", evidence: "kiro-cli chat --help; https://kiro.dev/docs/cli/chat/session-management/" },
  opencode: { selector: "--session", evidence: "https://opencode.ai/docs/cli/" },
  grok: { selector: "--resume", evidence: "https://docs.x.ai/build/cli/reference" },
  antigravity: { selector: "--conversation", evidence: "https://antigravity.google/docs/cli/reference" },
  hermes: { selector: "--resume", evidence: "https://hermes-agent.nousresearch.com/docs/reference/cli-commands" },
  muse: { selector: "resume", evidence: "https://dev.meta.ai/docs/muse-code/interactive" },
  commandcode: { selector: "--resume", evidence: "https://commandcode.ai/docs/reference/cli" },
};

export const resumeHarnessId = (agent: string): string => agent === "gemini-cli" ? "gemini" : agent;
export const nativeResumeSupport = (agent: string) => Object.hasOwn(contracts, resumeHarnessId(agent)) ? contracts[resumeHarnessId(agent)] : undefined;
export const nativeResumeHarnesses = () => Object.entries(contracts).map(([id, contract]) => ({ id, evidence: contract.evidence }));

export function validateSessionId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(id) || /^(latest|last)$/i.test(id)) {
    throw new Error("Informe o ID nativo completo da conversa (não 'last', caminho ou nome com espaços).");
  }
}

export function nativeResumeArgs(agent: string, args: string[], id: string): string[] {
  validateSessionId(id);
  const harness = resumeHarnessId(agent);
  const contract = nativeResumeSupport(harness);
  if (!contract) throw new Error(`Resume nativo não confirmado para ${agent}.`);
  const split = args.indexOf("--");
  const flags = split < 0 ? args : args.slice(0, split);
  // These choices can fork, disable persistence, or select a different session.
  const selectors = ["--resume", "--resume-id", "--session", "--session-id", "--conversation", "--continue", "--last", "--fork", "--fork-session", "--no-session", "--no-session-log"];
  const aliases: Record<string, string[]> = {
    claude: ["-r", "-c"], openclaude: ["-r", "-c"], gemini: ["-r"],
    kiro: ["-r", "--resume-picker"], opencode: ["-s", "-c"], grok: ["-r", "-c"],
    antigravity: ["-c"], hermes: ["-r", "-c"], commandcode: ["-r", "-c", "--sessions"],
  };
  let found = false;
  for (let i = 0; i < flags.length; i++) {
    const value = flags[i];
    const key = value.split("=", 1)[0];
    if (aliases[harness]?.includes(key)) throw new Error("Remova o seletor alternativo antes de retomar pelo ID exato.");
    const positional = (harness === "codex" || harness === "muse") && value === "resume";
    if (!positional && !selectors.includes(key)) continue;
    const selected = value.includes("=") ? value.slice(value.indexOf("=") + 1) : flags[i + 1];
    if (key !== contract.selector || selected !== id || found) {
      throw new Error("Argumentos de retomada conflitantes. Selecione apenas o ID exato desta conversa.");
    }
    found = true;
    if (!value.includes("=")) i++;
  }
  if (found) return [...args];
  const selection = harness === "copilot" ? [`--resume=${id}`] : [contract.selector, id];
  return [...flags, ...selection, ...(split < 0 ? [] : args.slice(split))];
}
