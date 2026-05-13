import React from "react";
import { ExternalLink, KeyRound } from "../../stores/providers-store";
import { DEFAULT_MIMO_ANTHROPIC_BASE_URL, MIMO_ANTHROPIC_ROUTES, normalizeBaseUrl } from "../../stores/browser-store";

// BulkTokenForm
export function BulkTokenForm({
  template,
  token,
  onTokenChange,
  mimoAnthropicBaseUrl,
  onMimoAnthropicBaseUrlChange,
  onSave,
  onCancel,
  onTest,
  testing,
  testResult,
  saving,
  error
}) {
  const tokenEnvVar = template.integrations[0]?.tokenEnvVar ?? "API_KEY";
  const isMimo = template.id === "mimo";
  const defaultMimoAnthropicBaseUrl = template.integrations.find(i => i.type === "anthropic-compat")?.baseUrl ?? DEFAULT_MIMO_ANTHROPIC_BASE_URL;
  const [showCustomRoute, setShowCustomRoute] = React.useState(false);
  const normalizedCustomRoute = normalizeBaseUrl(mimoAnthropicBaseUrl);
  const routePreview = normalizedCustomRoute || defaultMimoAnthropicBaseUrl;
  return <div className="p-4 space-y-3">
      <p className="font-mono text-[10px] text-gray-600">
        Cole API key — vamos criar o provider {template.integrations[0]?.label ?? template.label}.
      </p>
      {isMimo && <div className="px-3 py-2 rounded border border-yellow-500/30 bg-yellow-500/[0.06]">
          <p className="font-mono text-[10px] text-yellow-200/90">
            ⚠ MIMO requer <strong>Dedicated API Key</strong> (não a key padrão).
          </p>
          <a href="https://platform.xiaomimimo.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[10px] text-yellow-300 hover:text-yellow-100 mt-1">
            gerar Dedicated Key → platform.xiaomimimo.com{" "}
            <ExternalLink size={9} strokeWidth={1.5} />
          </a>
        </div>}
      {isMimo && <div className="px-3 py-2 rounded border border-white/10 bg-white/[0.02] space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
                CLUSTER DA DEDICATED KEY
              </p>
              <p className="font-mono text-[10px] text-gray-400">
                Escolha o mesmo cluster mostrado no painel MIMO da sua conta.
              </p>
            </div>
            <button type="button" onClick={() => setShowCustomRoute(v2 => !v2)} className="shrink-0 px-2 py-1 rounded border border-white/10 hover:border-indigo-500/40 font-mono text-[9px] text-gray-400 hover:text-indigo-300 transition-colors">
              {showCustomRoute ? "ocultar" : "personalizar rota"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MIMO_ANTHROPIC_ROUTES.map(route => {
          const normalizedRoute = normalizeBaseUrl(route.url);
          const active = normalizedRoute === routePreview;
          return <button type="button" onClick={() => onMimoAnthropicBaseUrlChange(route.url)} className={`px-2 py-1 rounded border font-mono text-[9px] font-bold transition-colors ${active ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-300" : "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20"}`}>
                  {route.label}
                </button>;
        })}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <div className="px-2 py-1.5 rounded border border-white/5 bg-black/40 min-w-0">
              <p className="font-mono text-[8px] text-gray-600 uppercase tracking-widest">
                OpenClaude / Anthropic
              </p>
              <p className="font-mono text-[10px] text-gray-400 truncate">{routePreview}</p>
            </div>
          </div>
          {showCustomRoute && <div className="space-y-2">
              <input type="text" value={mimoAnthropicBaseUrl} onChange={e => onMimoAnthropicBaseUrlChange(e.target.value)} placeholder={defaultMimoAnthropicBaseUrl} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-indigo-500/40" spellCheck={false} />
              <p className="font-mono text-[9px] text-gray-700">
                Informe a URL Claude/Anthropic terminando em /anthropic.
              </p>
            </div>}
        </div>}
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] text-gray-600 uppercase tracking-widest">
          {tokenEnvVar}
        </span>
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-white/10 bg-white/[0.02] focus-within:border-indigo-500/40 transition-colors">
          <KeyRound size={13} strokeWidth={1.5} className="text-gray-600 shrink-0" />
          <input type="password" autoFocus value={token} onChange={e => onTokenChange(e.target.value)} onKeyDown={e => {
          if (e.key === "Enter" && token.trim() && !saving) onSave();
        }} placeholder="sk-..." className="flex-1 bg-transparent border-0 outline-none font-mono text-[11px] text-white placeholder:text-gray-700" />
        </div>
      </label>
      {template.signupUrl && !isMimo && <a href={template.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[10px] text-gray-500 hover:text-indigo-400">
          obter chave em {new URL(template.signupUrl).host}
          <ExternalLink size={9} strokeWidth={1.5} />
        </a>}
      {testResult && <div className={`px-3 py-2 rounded border font-mono text-[10px] ${testResult.ok ? "border-green-500/40 bg-green-500/[0.06] text-green-300" : "border-indigo-500/40 bg-red-500/[0.06] text-indigo-300"}`}>
          {testResult.ok ? "✓ key válida nas rotas testadas" : `✗ falhou${testResult.integration ? ` em ${testResult.integration}` : ""}${testResult.status ? ` (HTTP ${testResult.status})` : ""}${testResult.reason ? ` — ${testResult.reason}` : ""}`}
          {testResult.route && <p className="mt-1 text-gray-500 truncate">{testResult.route}</p>}
          {testResult.hint && <p className="mt-1 text-gray-400">{testResult.hint}</p>}
          {testResult.results && <div className="mt-2 space-y-1">
              {testResult.results.map(result => <p className={result.ok ? "text-green-400/80" : "text-indigo-300/80"}>
                  {result.ok ? "✓" : "✗"}
                  {result.integration}:{" "}
                  {result.status ? `HTTP ${result.status}` : result.reason ?? "ok"}
                </p>)}
            </div>}
        </div>}
      {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
      <div className="flex justify-between gap-2 pt-2">
        <button onClick={onCancel} disabled={saving || testing} className="font-mono text-[10px] text-gray-500 hover:text-gray-300 px-2">
          cancelar
        </button>
        <div className="flex gap-2">
          <button onClick={onTest} disabled={saving || testing || !token.trim()} className="px-3 py-2 rounded font-mono text-[10px] text-gray-300 border border-white/10 hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {testing ? "testando…" : "testar conexão"}
          </button>
          <button onClick={onSave} disabled={saving || !token.trim()} className="px-4 py-2 rounded font-mono text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/[0.04] disabled:text-gray-700 disabled:cursor-not-allowed transition-colors">
            {saving ? "salvando…" : "salvar"}
          </button>
        </div>
      </div>
    </div>;
}