/**
 * Harness/modelo do Diário. Lista TODOS os harnesses que o app conhece (CLIs
 * detectadas e providers configurados), marcando os indisponíveis com o motivo,
 * e executa o resumo no escolhido. Chaves ficam no main process.
 */
import type { CliDecider } from "../cli-decider";
import { PROVIDER_REGISTRY } from "../constants";
import { anthropicCredentials, deciderCredentials, type HarnessProvider } from "../harness-providers";
import type { GitDigestProviderOption } from "../../../../src/types/git-digest";
import { codexBinaryUsable, runCodexSummary } from "./codex-runner";

export interface SummarizerEnvironment {
  providers: readonly HarnessProvider[];
  cli: CliDecider;
  /** Resultado do detector de CLIs (`ctx.cliDetector.getAll()`). */
  clis: Record<string, { found?: boolean; path?: string } | undefined>;
  fetchFn?: typeof fetch;
}

const CLI_LABELS: Record<string, string> = {
  antigravity: "Antigravity CLI",
  gemini: "Gemini CLI",
  kimi: "Kimi CLI",
  cursor: "Cursor CLI",
  copilot: "Copilot CLI",
  kiro: "Kiro CLI",
  opencode: "OpenCode",
  grok: "Grok Build",
  hermes: "Hermes Agent",
  muse: "Muse Code",
  commandcode: "Command Code",
  openclaude: "OpenClaude",
};
const CLI_TYPES = new Set(["oauth", "codex", "cli"]);
const MAX_RESPONSE_CHARS = 64_000;

const modelsOf = (providers: readonly HarnessProvider[], id: string) =>
  providers.find((provider) => provider.id === id)?.models ?? PROVIDER_REGISTRY.find((entry) => entry.id === id)?.models ?? [];

function apiTransport(provider: HarnessProvider): "chat" | "messages" | null {
  if (provider.type === "anthropic-compat") return "messages";
  if (provider.type === "openai-compat" || provider.type === "gemini-compat" || provider.type === "mimo-compat") return "chat";
  return null;
}

export async function listSummarizerOptions(env: SummarizerEnvironment): Promise<GitDigestProviderOption[]> {
  const options: GitDigestProviderOption[] = [];

  // ── CLIs com login existente ─────────────────────────────────────────────
  const claude = await env.cli.listProviders();
  if (claude.length) options.push(...claude.map((item) => ({ id: item.id, label: item.label, models: item.models, transport: "cli" as const, available: true })));
  else if (env.clis.claude?.found)
    options.push({ id: "cli:claude", label: "Claude · login existente", models: modelsOf(env.providers, "claude-oauth"), transport: "cli", available: false,
      reason: "Claude CLI sem as flags de isolamento ou com política gerenciada" });

  const codex = env.clis.codex;
  if (codex?.found)
    options.push({ id: "cli:codex", label: "Codex · login existente", models: modelsOf(env.providers, "codex-oauth"), transport: "cli",
      available: codexBinaryUsable(codex.path), reason: codexBinaryUsable(codex.path) ? undefined : "Codex instalado só como script (.cmd); instale o binário" });

  for (const [id, label] of Object.entries(CLI_LABELS))
    if (env.clis[id]?.found) options.push({ id: `cli:${id}`, label, models: [], transport: "cli", available: false, reason: "sem modo headless isolado para resumo" });

  // ── Providers de API configurados ─────────────────────────────────────────
  for (const provider of env.providers) {
    if (CLI_TYPES.has(provider.type ?? "")) continue;
    const transport = apiTransport(provider);
    const label = provider.label || provider.id;
    const models = provider.models ?? [];
    if (!transport) {
      options.push({ id: provider.id, label, models, transport: "api", available: false, reason: `tipo ${provider.type ?? "desconhecido"} não suportado` });
      continue;
    }
    const credentials = transport === "messages" ? anthropicCredentials(env.providers, provider.id) : deciderCredentials(env.providers, provider.id);
    options.push({ id: provider.id, label, models, transport: "api", available: !!credentials, reason: credentials ? undefined : "sem chave ou URL configurada" });
  }
  return options;
}

export interface SummarizeOptions extends SummarizerEnvironment {
  providerId: string;
  model: string;
  systemPrompt: string;
  input: string;
  timeoutMs?: number;
}

async function post(fetchFn: typeof fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  let response: Response;
  try {
    response = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "O modelo não respondeu a tempo." : "Provider do modelo indisponível.");
  }
  if (!response.ok) throw new Error(`Provider do modelo respondeu HTTP ${response.status}.`);
  return response.json().catch(() => null);
}

export async function summarize(options: SummarizeOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 150_000;
  if (options.providerId === "cli:claude")
    return options.cli.complete({ providerId: options.providerId, model: options.model, systemPrompt: options.systemPrompt, input: options.input, timeoutMs });
  if (options.providerId === "cli:codex")
    return runCodexSummary({ binary: options.clis.codex?.path ?? "", model: options.model, systemPrompt: options.systemPrompt, input: options.input, timeoutMs: Math.max(timeoutMs, 240_000) });
  if (options.providerId.startsWith("cli:")) throw new Error("Esse CLI não tem modo de resumo isolado. Escolha outro harness.");

  const provider = options.providers.find((item) => item.id === options.providerId);
  if (!provider) throw new Error("Provider não está mais configurado. Escolha outro harness no Diário.");
  if (provider.models?.length && !provider.models.includes(options.model)) throw new Error("Modelo não pertence ao provider escolhido.");
  const fetchFn = options.fetchFn ?? fetch;

  if (apiTransport(provider) === "messages") {
    const credentials = anthropicCredentials(options.providers, provider.id);
    if (!credentials) throw new Error("Provider sem chave ou URL configurada.");
    const json = await post(fetchFn, `${credentials.baseUrl}/v1/messages`,
      { ...(credentials.bearer ? { Authorization: `Bearer ${credentials.apiKey}` } : { "x-api-key": credentials.apiKey }), "anthropic-version": "2023-06-01" },
      { model: options.model, max_tokens: 4096, temperature: 0.2, system: options.systemPrompt, messages: [{ role: "user", content: options.input }] }, timeoutMs);
    const text = Array.isArray(json?.content) ? json.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("") : "";
    if (!text.trim()) throw new Error("O modelo devolveu resposta vazia.");
    return text.slice(0, MAX_RESPONSE_CHARS);
  }

  const credentials = deciderCredentials(options.providers, provider.id);
  if (!credentials) throw new Error("Provider sem chave ou sem endpoint compatível.");
  const json = await post(fetchFn, `${credentials.baseUrl}/chat/completions`, { Authorization: `Bearer ${credentials.apiKey}` },
    { model: options.model, temperature: 0.2, messages: [{ role: "system", content: options.systemPrompt }, { role: "user", content: options.input }] }, timeoutMs);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("O modelo devolveu resposta vazia.");
  return content.slice(0, MAX_RESPONSE_CHARS);
}
