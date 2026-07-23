import React from "react";
import { ExternalLink } from "../../stores/providers-store";
import { fetchModelsFromEndpoint } from "../../stores/browser-store";
import { OpenRouterModelPicker } from "./OpenRouterModelPicker";

// ProviderForm
export function ProviderForm({
  provider,
  onChange,
  onSave,
  error,
  simple,
  signupUrl
}) {
  const env = provider.env ?? {};
  const setEnv = (key, value) => {
    onChange({
      ...provider,
      env: {
        ...env,
        [key]: value
      }
    });
  };
  const [fetching, setFetching] = React.useState(false);
  const [fetchError, setFetchError] = React.useState(null);
  const [healthChecking, setHealthChecking] = React.useState(false);
  const [healthResult, setHealthResult] = React.useState(null);
  const isAnthropicCompat = provider.type === "anthropic-compat";
  const isMimoCompat = provider.type === "mimo-compat";
  const isOpenAICompat = provider.type === "openai-compat";
  const isGeminiCompat = provider.type === "gemini-compat";
  const isOAuth = provider.type === "oauth";
  const tokenKey = isAnthropicCompat || isMimoCompat ? "ANTHROPIC_AUTH_TOKEN" : isGeminiCompat ? "GEMINI_API_KEY" : isOpenAICompat ? "OPENAI_API_KEY" : "TOKEN";
  const urlKey = isAnthropicCompat || isMimoCompat ? "ANTHROPIC_BASE_URL" : isGeminiCompat ? "GEMINI_BASE_URL" : isOpenAICompat ? "OPENAI_BASE_URL" : "BASE_URL";
  // OpenRouter has no public model listing endpoint — returns hundreds of unrelated models
  const isOpenRouter = /openrouter/i.test(env[urlKey] ?? "") || /openrouter/i.test(provider.label ?? "");
  // 9Router: key comes from the user's own instance dashboard, not an external signup page
  const is9Router = /9router/i.test(provider.id ?? "") || /9router/i.test(provider.label ?? "");
  const nineRouterDashboardUrl = (() => {
    if (!is9Router) return null;
    try {
      const base = env[urlKey];
      return base ? `${new URL(base).origin}/dashboard` : null;
    } catch {
      return null;
    }
  })();
  const nineRouterKeyHint = is9Router && (
    <p className="font-mono text-[9px] text-gray-500 mt-1">
      Key gerada no dashboard da sua instância 9Router{" "}
      {nineRouterDashboardUrl && <a href={nineRouterDashboardUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5">
        {new URL(nineRouterDashboardUrl).host}/dashboard <ExternalLink size={8} strokeWidth={1.5} />
      </a>}
    </p>
  );
  // OpenRouter supports the Anthropic protocol via ANTHROPIC_BASE_URL — Claude Code CLI works.
  // No longer force-switch to openclaude for OpenRouter providers.
  const runHealthCheck = async () => {
    const baseUrl = env[urlKey];
    const token = env[tokenKey];
    if (!baseUrl || !token || /^\*+$/.test(token)) return;
    setHealthChecking(true);
    setHealthResult(null);
    try {
      const result = await (window as any).codeBrainApp?.providers?.healthCheck({
        baseUrl,
        apiKey: token,
        type: provider.type,
      });
      setHealthResult(result);
    } catch (e) {
      setHealthResult({ ok: false, status: "down", checks: { endpoint: { ok: false }, models: { ok: false }, generation: { ok: false }, tools: { ok: false } }, warnings: [], error: String(e) });
    } finally {
      setHealthChecking(false);
    }
  };
  const fetchModels = async () => {
    // OAuth plan: use token from ~/.claude/.credentials.json
    if (isOAuth) {
      setFetching(true);
      setFetchError(null);
      try {
        const result = await (window as any).codeBrainApp?.providers?.listClaudeOAuthModels?.();
        const ids: string[] = result?.models ?? [];
        if (ids.length === 0) {
          setFetchError(result?.error ? `erro: ${result.error}` : "nenhum modelo retornado — faça login com 'claude auth login'");
        } else {
          onChange({ ...provider, models: ids });
        }
      } catch (err) {
        setFetchError(`erro: ${err instanceof Error ? err.message : String(err)}`);
      }
      setFetching(false);
      return;
    }
    const baseUrl = env[urlKey];
    const token = env[tokenKey];
    if (!baseUrl || !token || /^\*+$/.test(token)) {
      setFetchError("preencha API Key primeiro");
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      // Use IPC via main process to avoid CORS restrictions when calling external APIs
      const result = await (window as any).codeBrainApp?.providers?.listModels({
        baseUrl,
        apiKey: token,
        type: provider.type ?? (isAnthropicCompat || isMimoCompat ? "anthropic-compat" : isGeminiCompat ? "gemini-compat" : "openai-compat"),
      });
      const ids: string[] = result?.models ?? [];
      if (ids.length === 0) {
        setFetchError(result?.error ? `erro: ${result.error}` : "endpoint não retornou models");
      } else {
        onChange({ ...provider, models: ids });
      }
    } catch (err) {
      setFetchError(`erro: ${err instanceof Error ? err.message : String(err)}`);
    }
    setFetching(false);
  };
  const models = provider.models ?? [];
  const setModels = next => onChange({
    ...provider,
    models: next
  });
  // Shared models block (used in both simple OAuth mode and full form)
  const modelsBlock = !isOpenRouter ? (
    <div>
      <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">Models</p>
      <div className="space-y-1">
        {models.map((m, i) => <div key={i} className="flex gap-1">
          <input value={m} onChange={e => { const next = [...models]; next[i] = e.target.value; setModels(next); }} className="flex-1 bg-black border border-white/10 rounded px-2 py-1 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="model-id" spellCheck={false} />
          <button onClick={() => setModels(models.filter((_2, j) => j !== i))} className="px-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 border border-white/10 rounded transition-colors cursor-pointer" title="Remover modelo">×</button>
        </div>)}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setModels([...models, ""])} className="font-mono text-[10px] text-indigo-500/70 hover:text-indigo-400 cursor-pointer">+ adicionar model</button>
          <button onClick={fetchModels} disabled={fetching} className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] bg-violet-900/30 border border-violet-700/40 text-violet-400 hover:bg-violet-800/40 hover:text-violet-300 disabled:opacity-40 transition-colors cursor-pointer">
            {fetching ? "↻ detectando…" : "⤓ Detectar modelos"}
          </button>
        </div>
        {fetchError && <p className="font-mono text-[9px] text-red-400 mt-1">{fetchError}</p>}
      </div>
    </div>
  ) : null;

  return <div className="p-4 space-y-3">
      {simple ? <React.Fragment>
          {isOAuth ? <>
            <p className="font-mono text-[10px] text-gray-500">
              Modelos disponíveis no seu plano Claude. Clique em "Detectar modelos" para atualizar a lista.
            </p>
            {modelsBlock}
          </> : <>
            <p className="font-mono text-[10px] text-gray-500">
              Cola sua API Key. URL e modelos já vêm do template.
            </p>
            <div>
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
                API Key
              </p>
              <input type="password" value={env[tokenKey] ?? ""} onChange={e => setEnv(tokenKey, e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="sk-..." autoFocus spellCheck={false} />
              {nineRouterKeyHint}
            </div>
            {signupUrl && !is9Router && <a href={signupUrl} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-gray-500 hover:text-indigo-400 flex items-center gap-1">
                Não tem key? Criar conta <ExternalLink size={9} strokeWidth={1.5} />
              </a>}
          </>}
        </React.Fragment> : <React.Fragment>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              Label
            </p>
            <input value={provider.label} onChange={e => onChange({
          ...provider,
          label: e.target.value
        })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" />
          </div>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              Base URL
            </p>
            <input type="text" value={env[urlKey] ?? ""} onChange={e => setEnv(urlKey, e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="https://..." spellCheck={false} />
          </div>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              API Key
            </p>
            <input type="password" value={env[tokenKey] ?? ""} onChange={e => setEnv(tokenKey, e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="sk-..." spellCheck={false} />
            {nineRouterKeyHint}
          </div>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              Host (CLI binary)
            </p>
            <select value={provider.host ?? "openclaude"} onChange={e => onChange({
          ...provider,
          host: e.target.value
        })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 cursor-pointer">
              <option value="openclaude">OpenClaude (API key via env)</option>
              <option value="claude">{isOpenRouter ? "Claude Code (API key via ANTHROPIC_BASE_URL)" : "Claude Code (OAuth — plano oficial)"}</option>
            </select>
            {provider.host === "claude" && (
              <p className="font-mono text-[9px] text-amber-500/80 mt-1">
                {isOpenRouter
                  ? "Claude Code CLI vai usar ANTHROPIC_BASE_URL=openrouter.ai/api/v1 com sua API key — qualquer modelo OpenRouter funciona."
                  : isAnthropicCompat || isMimoCompat
                    ? "Com Claude Code nativo, a API key é gerenciada pelo OAuth do plano — o campo acima é ignorado."
                    : "Claude Code será usado como CLI, mas a API key acima ainda é necessária para autenticar com o provider."}
              </p>
            )}
          </div>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              Models
            </p>
            {isOpenRouter ? (
              <OpenRouterModelPicker selectedModels={models} onChange={setModels} />
            ) : modelsBlock}
            <div className="flex gap-2 pt-2">
              <button onClick={runHealthCheck} disabled={healthChecking || !env[urlKey] || !env[tokenKey]} className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-900/30 border border-emerald-700/40 text-emerald-400 hover:bg-emerald-800/40 hover:text-emerald-300 disabled:opacity-40 transition-colors cursor-pointer">
                {healthChecking ? "↻ checando…" : "⚕ Health check"}
              </button>
            </div>
            {healthResult && <div className="mt-2 rounded border border-white/10 bg-black/40 p-2 font-mono text-[9px] space-y-1">
              <div className={`font-semibold ${healthResult.status === "healthy" ? "text-emerald-400" : healthResult.status === "degraded" ? "text-amber-400" : "text-red-400"}`}>
                {healthResult.status === "healthy" ? "✓" : healthResult.status === "degraded" ? "⚠" : "✗"} {healthResult.status}
                {healthResult.model && <span className="text-gray-500 font-normal"> · {healthResult.model}</span>}
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                {[["endpoint","Endpoint"],["models","Models"],["generation","Generation"],["tools","Tools"]].map(([k,label]) => (
                  <span key={k} className={healthResult.checks[k]?.ok ? "text-emerald-500" : "text-red-500"}>
                    {healthResult.checks[k]?.ok ? "✓" : "✗"} {label}
                    {k === "endpoint" && healthResult.checks.endpoint?.latencyMs != null && <span className="text-gray-600"> {healthResult.checks.endpoint.latencyMs}ms</span>}
                  </span>
                ))}
              </div>
              {healthResult.warnings?.length > 0 && <div className="text-amber-500">{healthResult.warnings.join(" · ")}</div>}
            </div>}
          </div>
        </React.Fragment>}
      {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button onClick={onSave} className="flex-1 py-2 rounded-lg font-mono text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-500">
          SAVE
        </button>
      </div>
    </div>;
}