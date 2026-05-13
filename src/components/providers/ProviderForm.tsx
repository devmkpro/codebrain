import React from "react";
import { ExternalLink } from "../../stores/providers-store";
import { fetchModelsFromEndpoint } from "../../stores/browser-store";

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
  const isAnthropicCompat = provider.type === "anthropic-compat";
  const isMimoCompat = provider.type === "mimo-compat";
  const isOpenAICompat = provider.type === "openai-compat";
  const isGeminiCompat = provider.type === "gemini-compat";
  const tokenKey = isAnthropicCompat || isMimoCompat ? "ANTHROPIC_AUTH_TOKEN" : isGeminiCompat ? "GEMINI_API_KEY" : isOpenAICompat ? "OPENAI_API_KEY" : "TOKEN";
  const urlKey = isAnthropicCompat || isMimoCompat ? "ANTHROPIC_BASE_URL" : isGeminiCompat ? "GEMINI_BASE_URL" : isOpenAICompat ? "OPENAI_BASE_URL" : "BASE_URL";
  const fetchModels = async () => {
    const baseUrl = env[urlKey];
    const token = env[tokenKey];
    if (!baseUrl || !token || /^\*+$/.test(token)) {
      setFetchError("preencha API Key primeiro");
      return;
    }
    setFetching(true);
    setFetchError(null);
    const ids = await fetchModelsFromEndpoint(baseUrl, token, isAnthropicCompat || isMimoCompat ? "anthropic" : isGeminiCompat ? "gemini" : "openai");
    if (ids.length === 0) setFetchError("endpoint não retornou models");else onChange({
      ...provider,
      models: ids
    });
    setFetching(false);
  };
  const models = provider.models ?? [];
  const setModels = next => onChange({
    ...provider,
    models: next
  });
  return <div className="p-4 space-y-3">
      {simple ? <React.Fragment>
          <p className="font-mono text-[10px] text-gray-500">
            Cola sua API Key. URL e modelos já vêm do template.
          </p>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              API Key
            </p>
            <input type="password" value={env[tokenKey] ?? ""} onChange={e => setEnv(tokenKey, e.target.value)} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="sk-..." autoFocus spellCheck={false} />
          </div>
          {signupUrl && <a href={signupUrl} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-gray-500 hover:text-indigo-400 flex items-center gap-1">
              Não tem key? Criar conta <ExternalLink size={9} strokeWidth={1.5} />
            </a>}
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
          </div>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              Host (CLI binary)
            </p>
            <select value={provider.host ?? "openclaude"} onChange={e => onChange({
          ...provider,
          host: e.target.value
        })} className="w-full bg-black border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40 cursor-pointer">
              <option value="openclaude">OpenClaude</option>
            </select>
          </div>
          <div>
            <p className="font-mono text-[9px] text-gray-600 uppercase tracking-widest mb-1">
              Models
            </p>
            <div className="space-y-1">
              {models.map((m, i) => <div className="flex gap-1">
                  <input value={m} onChange={e => {
              const next = [...models];
              next[i] = e.target.value;
              setModels(next);
            }} className="flex-1 bg-black border border-white/10 rounded px-2 py-1 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40" placeholder="model-id" spellCheck={false} />
                  <button onClick={() => setModels(models.filter((_2, j) => j !== i))} className="px-2 text-gray-700 hover:text-red-500 border border-white/10 rounded">
                    ×
                  </button>
                </div>)}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setModels([...models, ""])} className="font-mono text-[10px] text-indigo-500/70 hover:text-indigo-400">
                  + adicionar model
                </button>
                <button onClick={fetchModels} disabled={fetching} className="font-mono text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-40">
                  {fetching ? "fetching…" : "⤓ fetch from API"}
                </button>
              </div>
              {fetchError && <p className="font-mono text-[9px] text-red-400 mt-1">{fetchError}</p>}
            </div>
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