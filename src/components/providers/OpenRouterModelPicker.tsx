import React from "react";

interface OrModel {
  id: string;
  name: string;
  context_length: number;
  pricing?: { prompt: number; completion: number };
}

interface Props {
  selectedModels: string[];
  onChange: (models: string[]) => void;
}

export function OpenRouterModelPicker({ selectedModels, onChange }: Props) {
  const [allModels, setAllModels] = React.useState<OrModel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [fetched, setFetched] = React.useState(false);

  const selectedSet = React.useMemo(() => new Set(selectedModels), [selectedModels]);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await (window as any).codeBrainApp?.providers?.listOpenRouterModels();
      if (result?.ok && result.models) {
        setAllModels(result.models);
        setFetched(true);
      } else {
        setError(result?.error ?? "falha ao buscar modelos");
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedModels.filter(m => m !== id));
    } else {
      onChange([...selectedModels, id]);
    }
  };

  const filtered = React.useMemo(() => {
    if (!search.trim()) return allModels;
    const q = search.toLowerCase();
    return allModels.filter(
      m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [allModels, search]);

  // Sort: selected first, then alphabetical
  const sorted = React.useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aSel = selectedSet.has(a.id) ? 0 : 1;
      const bSel = selectedSet.has(b.id) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.id.localeCompare(b.id);
    });
  }, [filtered, selectedSet]);

  if (!fetched) {
    return (
      <div className="space-y-2">
        {selectedModels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedModels.map(m => (
              <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-900/30 border border-indigo-700/40 font-mono text-[10px] text-indigo-300">
                {m}
                <button onClick={() => onChange(selectedModels.filter(x => x !== m))} className="text-indigo-500 hover:text-red-400 cursor-pointer">×</button>
              </span>
            ))}
          </div>
        )}
        <button
          onClick={fetchModels}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-[10px] bg-violet-900/30 border border-violet-700/40 text-violet-400 hover:bg-violet-800/40 hover:text-violet-300 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {loading ? "↻ carregando…" : "⤓ Carregar modelos do OpenRouter"}
        </button>
        {error && <p className="font-mono text-[9px] text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedModels.map(m => (
            <span key={m} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-900/30 border border-indigo-700/40 font-mono text-[10px] text-indigo-300">
              {m}
              <button onClick={() => onChange(selectedModels.filter(x => x !== m))} className="text-indigo-500 hover:text-red-400 cursor-pointer">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Search + actions */}
      <div className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar modelo…"
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 font-mono text-[11px] text-gray-200 focus:outline-none focus:border-indigo-500/40"
          autoFocus
        />
        <button onClick={() => onChange(allModels.map(m => m.id))} className="font-mono text-[9px] text-indigo-500/70 hover:text-indigo-400 whitespace-nowrap cursor-pointer">
          todos
        </button>
        <button onClick={() => onChange([])} className="font-mono text-[9px] text-gray-600 hover:text-red-400 whitespace-nowrap cursor-pointer">
          limpar
        </button>
      </div>

      <p className="font-mono text-[9px] text-gray-600">
        {selectedModels.length} selecionados · {filtered.length} {search ? "encontrados" : "total"}
      </p>

      {/* Model list */}
      <div className="max-h-60 overflow-y-auto rounded border border-white/10 divide-y divide-white/5">
        {sorted.length === 0 && (
          <p className="px-3 py-2 font-mono text-[10px] text-gray-600">Nenhum modelo encontrado</p>
        )}
        {sorted.map(m => {
          const isSelected = selectedSet.has(m.id);
          const ctxK = m.context_length >= 1000 ? `${(m.context_length / 1000).toFixed(0)}k` : m.context_length;
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? "bg-indigo-900/20 hover:bg-indigo-900/30"
                  : "hover:bg-white/5"
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                isSelected ? "bg-indigo-600 border-indigo-500" : "border-white/20"
              }`}>
                {isSelected && <span className="text-white text-[8px]">✓</span>}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[10px] text-gray-200 truncate">{m.id}</p>
                <p className="font-mono text-[9px] text-gray-500 truncate">
                  {m.name !== m.id ? m.name : ""} {ctxK ? `· ${ctxK} ctx` : ""}
                  {m.pricing && (
                    <span className="text-gray-600">
                      {" · "}
                      <span className="text-emerald-700">↑${(Number(m.pricing.prompt) * 1_000_000).toFixed(2)}</span>
                      {" "}
                      <span className="text-sky-700">↓${(Number(m.pricing.completion) * 1_000_000).toFixed(2)}</span>
                      <span className="text-gray-700">/1M</span>
                    </span>
                  )}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
