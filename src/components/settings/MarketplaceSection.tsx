import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Package, RefreshCw, Search } from "lucide-react";

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  installed?: boolean;
  scope?: string;
  localId?: string;
  path?: string;
}
interface SourceStatus {
  id: string;
  name: string;
  url: string;
  status: "online" | "cached" | "unavailable";
  fetchedAt?: string;
  error?: string;
}
interface MarketplaceResult {
  ok: boolean;
  index?: { skills: MarketplaceItem[] };
  installed?: MarketplaceItem[];
  sources?: SourceStatus[];
  error?: string;
}
export interface MarketplaceSummary { online: number; installed: number; loading: boolean }

export function MarketplaceSection({ onSummaryChange }: { onSummaryChange?: (summary: MarketplaceSummary) => void }) {
  const [catalog, setCatalog] = useState<MarketplaceItem[]>([]);
  const [installed, setInstalled] = useState<MarketplaceItem[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [tab, setTab] = useState<"discover" | "installed">("discover");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const requestNumber = useRef(0);
  const mutationBusy = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    setError("");
    try {
      const api = window.codeBrainApp?.skill;
      if (!api?.registryIndex) throw new Error("Marketplace indisponível nesta versão do aplicativo.");
      const result: MarketplaceResult = await api.registryIndex();
      if (!mounted.current || request !== requestNumber.current) return;
      setCatalog(result.index?.skills ?? []);
      setInstalled(result.installed ?? []);
      setSources(result.sources ?? []);
      if (!result.ok) setError(result.error || "Não foi possível carregar o catálogo online.");
    } catch (reason) {
      if (mounted.current && request === requestNumber.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current && request === requestNumber.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; requestNumber.current++; };
  }, [refresh]);

  useEffect(() => {
    onSummaryChange?.({ online: catalog.length, installed: installed.length, loading });
  }, [catalog.length, installed.length, loading, onSummaryChange]);

  async function mutate(item: MarketplaceItem, action: "install" | "remove") {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      const api = window.codeBrainApp?.skill;
      const result = action === "install"
        ? await api?.installFromRegistry({ id: item.id })
        : await api?.uninstallSkill({ id: item.localId! });
      if (!result?.ok) throw new Error(result?.error || "A operação não foi concluída.");
      if (!mounted.current) return;
      await refresh();
      if (mounted.current) setNotice(`${item.name}: ${action === "install" ? "instalada no CodeBrain" : "removida do CodeBrain"}.`);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const term = query.trim().toLocaleLowerCase();
  const visible = (tab === "discover" ? catalog : installed).filter(item =>
    (!sourceFilter || item.sourceId === sourceFilter) &&
    (!term || `${item.name} ${item.description} ${item.source ?? ""}`.toLocaleLowerCase().includes(term)));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="cb-setting__label">Skills dos repositórios oficiais</p>
          <p className="cb-setting__help">Descubra online e instale no CodeBrain com scripts e recursos incluídos.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || busy !== null} className="cb-btn cb-btn--sm" aria-label="Atualizar marketplace">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden /> Atualizar
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-cb-fg-2" aria-label="Fontes do catálogo">
        {sources.map(source => (
          <span key={source.id} className="cb-badge" title={source.error || source.url}>
            {source.name} · {source.status === "online" ? "online" : source.status === "cached" ? `cache${source.fetchedAt ? ` de ${new Date(source.fetchedAt).toLocaleString("pt-BR")}` : ""}` : "indisponível"}
          </span>
        ))}
      </div>
      {sources.some(source => source.status !== "online") && (
        <p role="status" className="text-xs text-cb-warn">Algumas fontes estão indisponíveis. Itens em cache podem ser antigos; tente atualizar quando a conexão voltar.</p>
      )}
      <div className="flex gap-1" role="group" aria-label="Visualização do marketplace">
        <button type="button" aria-pressed={tab === "discover"} onClick={() => { setTab("discover"); setSourceFilter(""); }} className={`cb-btn cb-btn--sm ${tab === "discover" ? "cb-btn--accent" : "cb-btn--ghost"}`}>Descobrir ({catalog.length})</button>
        <button type="button" aria-pressed={tab === "installed"} onClick={() => { setTab("installed"); setSourceFilter(""); }} className={`cb-btn cb-btn--sm ${tab === "installed" ? "cb-btn--accent" : "cb-btn--ghost"}`}>Instalados ({installed.length})</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="relative flex-1 min-w-40">
          <span className="sr-only">Buscar skills</span>
          <Search size={12} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cb-fg-2" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar skills..." className="cb-field w-full pl-7" />
        </label>
        {tab === "discover" && <label>
          <span className="sr-only">Fonte</span>
          <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className="cb-field">
            <option value="">Todas as fontes</option>
            {sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select>
        </label>}
      </div>
      {error && <p role="alert" className="text-xs text-cb-danger">{error}</p>}
      {notice && <p role="status" className="text-xs text-cb-success">{notice}</p>}
      {loading && <p role="status" className="text-xs text-cb-fg-2">Consultando catálogo e inventário instalado…</p>}
      <div aria-busy={loading} className="space-y-1.5 max-h-[440px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {visible.map(item => <article key={item.id} className="flex items-start gap-3 p-3 rounded-cb-1 hover:bg-cb-bg-1 transition-colors">
          <Package size={14} aria-hidden className="text-cb-accent mt-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-mono text-sm font-bold text-cb-fg-1 break-words">{item.name}</h3>
            <p className="text-xs text-cb-fg-2 mt-0.5 line-clamp-3">{item.description || "Sem descrição"}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-cb-fg-2">
              <span>{item.source || "Local"}</span>
              {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cb-accent" aria-label={`Ver origem de ${item.name}`}><ExternalLink size={10} aria-hidden /> Repositório</a>}
              {item.installed && <span className="text-cb-success">Instalado</span>}
            </div>
            {tab === "installed" && item.path && <p className="text-xs text-cb-fg-2 mt-1 break-all">{item.path}</p>}
          </div>
          {tab === "discover" ? <button type="button" disabled={loading || busy !== null || item.installed} onClick={() => void mutate(item, "install")} className="cb-btn cb-btn--sm shrink-0" aria-label={`Instalar ${item.name}`}>
            {busy === item.id ? "Instalando…" : item.installed ? "✓ Instalado" : <><Download size={11} aria-hidden /> Instalar</>}
          </button> : item.scope === "codebrain" && item.localId ? <button type="button" disabled={loading || busy !== null} onClick={() => void mutate(item, "remove")} className="cb-btn cb-btn--ghost cb-btn--sm shrink-0" aria-label={`Remover ${item.name}`}>{busy === item.id ? "Removendo…" : "Remover"}</button> : null}
        </article>)}
        {!loading && visible.length === 0 && <p className="text-xs text-cb-fg-2 py-5 text-center">{term || sourceFilter ? "Nenhuma skill corresponde à busca." : tab === "installed" ? "Nenhuma skill instalada encontrada." : "Catálogo online indisponível. Use Atualizar para tentar novamente."}</p>}
      </div>
      <p className="cb-setting__help">A instalação salva os arquivos no CodeBrain. Dependências e configurações adicionais seguem as orientações de cada skill.</p>
    </div>
  );
}
