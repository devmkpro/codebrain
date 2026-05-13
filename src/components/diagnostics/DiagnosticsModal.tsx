import React from "react";
import { Activity, Clipboard, RefreshCw, X$1, TriangleAlert } from "../../stores/providers-store";
import { shortId, buildBugReport } from "../settings/InfoRow";

// PaneTable, DiagnosticsModal
import { usePanesStore } from "../../stores/panes-store";
import { StatusPill } from "../settings/StatusPill";
import { InfoRow } from "../settings/InfoRow";
export function PaneTable({
  title,
  panes,
  tone
}) {
  return <section className={`rounded-lg border ${tone === "warn" ? "border-yellow-500/20 bg-yellow-500/[0.03]" : "border-white/10 bg-black/30"} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
          {title}
        </p>
        <span className="font-mono text-[9px] text-gray-600">{(panes ?? []).length}</span>
      </div>
      {(panes ?? []).length === 0 ? <p className="px-3 py-3 font-mono text-[10px] text-gray-600">nenhum pane</p> : <div className="max-h-52 overflow-auto">
          <table className="w-full table-fixed">
            <thead className="sticky top-0 bg-[#080808]">
              <tr className="border-b border-white/5 text-left font-mono text-[9px] uppercase tracking-widest text-gray-600">
                <th className="w-[88px] px-3 py-1.5">pane</th>
                <th className="w-[68px] px-2 py-1.5">agent</th>
                <th className="w-[82px] px-2 py-1.5">status</th>
                <th className="px-2 py-1.5">cwd</th>
                <th className="w-[120px] px-2 py-1.5">model</th>
              </tr>
            </thead>
            <tbody>
              {(panes ?? []).map(pane => {
            const paneId = "paneId" in pane ? pane.paneId : pane.id;
            const status = "status" in pane ? pane.status : "running";
            return <tr className="border-b border-white/5 font-mono text-[10px] text-gray-400">
                    <td className="px-3 py-1.5 text-gray-300" title={paneId}>
                      {shortId(paneId)}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">{pane.agent}</td>
                    <td className="px-2 py-1.5 text-gray-500">{status}</td>
                    <td className="truncate px-2 py-1.5" title={pane.cwd}>
                      {pane.cwd}
                    </td>
                    <td className="truncate px-2 py-1.5 text-gray-500" title={pane.model ?? ""}>
                      {pane.model ?? "-"}
                    </td>
                  </tr>;
          })}
            </tbody>
          </table>
        </div>}
    </section>;
}
export function DiagnosticsModal({
  open,
  activeWorkspace,
  onClose
}) {
  const rendererPanes = usePanesStore(s => s.panes);
  const [snapshot, setSnapshot] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [copyState, setCopyState] = React.useState("idle");
  const refresh = () => {
    setLoading(true);
    setError(null);
    setCopyState("idle");
    window.codeBrainApp?.diagnostics?.snapshot().then(next => setSnapshot(next)).catch(err => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoading(false));
  };
  const copyDiagnostics = async () => {
    if (!snapshot) return;
    setCopyState("idle");
    try {
      const report = buildBugReport({
        snapshot,
        rendererPanes,
        backendOnly: divergence.backendOnly,
        rendererOnly: divergence.rendererOnly,
        activeWorkspace
      });
      if (window.codeBrainApp?.app?.copyToClipboard) {
        await window.codeBrainApp.app.copyToClipboard(report);
      } else {
        await navigator.clipboard.writeText(report);
      }
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  };
  React.useEffect(() => {
    if (!open) return;
    refresh();
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const divergence = React.useMemo(() => {
    const backend = new Map((snapshot?.backendPanes ?? []).map(pane => [pane.paneId, pane]));
    const renderer = new Map(rendererPanes.map(pane => [pane.id, pane]));
    return {
      backendOnly: [...backend.values()].filter(pane => !renderer.has(pane.paneId)),
      rendererOnly: [...renderer.values()].filter(pane => pane.kind !== "browser" && !backend.has(pane.id))
    };
  }, [rendererPanes, snapshot?.backendPanes]);
  if (!open) return null;
  const hasDivergence = divergence.backendOnly.length > 0 || divergence.rendererOnly.length > 0;
  return <div className="fixed top-[38px] left-0 right-0 bottom-0 z-[10000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-[920px] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-indigo-500/20 bg-[#080808] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-indigo-500/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Activity size={14} strokeWidth={1.6} className="text-red-400" />
            <h2 className="font-mono text-[12px] font-bold uppercase tracking-widest text-white">
              Diagnostico local
            </h2>
            {snapshot && <StatusPill ok={!hasDivergence} label={hasDivergence ? "divergencia" : "ok"} />}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={copyDiagnostics} disabled={!snapshot} className={`inline-flex items-center gap-1.5 rounded border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 ${copyState === "copied" ? "border-green-500/35 bg-green-500/10 text-green-300" : copyState === "error" ? "border-indigo-500/35 bg-indigo-500/10 text-indigo-300" : "border-white/10 text-gray-400 hover:border-indigo-500/30 hover:text-indigo-300"}`} title="Copiar relatorio estruturado sem tokens, terminal ou logs">
              <Clipboard size={12} strokeWidth={1.6} />
              {copyState === "copied" ? "Copiado" : copyState === "error" ? "Falhou" : "Copiar diagnostico"}
            </button>
            <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-1.5 rounded border border-white/10 px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-gray-400 transition-all hover:border-indigo-500/30 hover:text-indigo-300 disabled:opacity-50">
              <RefreshCw size={12} strokeWidth={1.6} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button onClick={onClose} className="rounded p-1.5 text-gray-600 transition-colors hover:text-gray-300">
              <X$1 size={14} strokeWidth={1.6} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          {error && <div className="mb-3 flex items-center gap-2 rounded border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 font-mono text-[10px] text-red-200">
              <TriangleAlert size={13} strokeWidth={1.6} />
              {error}
            </div>}
          {!snapshot ? <p className="font-mono text-[11px] text-gray-600">
              {loading ? "carregando diagnostico..." : "sem snapshot"}
            </p> : <div className="space-y-4">
              <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <InfoRow label="app" value={snapshot.app?.version} />
                <InfoRow label="plataforma" value={snapshot.app ? `${snapshot.app.platform}/${snapshot.app.arch}` : "-"} />
                <InfoRow label="os" value={snapshot.app?.osRelease} />
                <InfoRow label="workspace" value={activeWorkspace ?? snapshot.workspace?.active ?? "home"} />
              </section>
              <section className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                    MCP
                  </p>
                  <StatusPill ok={snapshot.mcp?.active} label={snapshot.mcp?.active ? "ativo" : "inativo"} />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <InfoRow label="porta" value={snapshot.mcp?.port} />
                  <InfoRow label="sse" value={snapshot.mcp?.sseUrl} />
                  <InfoRow label="tools" value={snapshot.mcp ? `${snapshot.mcp.toolCount} ${snapshot.mcp.tools?.join(", ")}` : "-"} />
                </div>
              </section>
              <section className="rounded-lg border border-white/10 bg-black/30 overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                    Providers
                  </p>
                  <span className="font-mono text-[9px] text-gray-600">
                    {snapshot.providers?.length ?? 0}
                  </span>
                </div>
                <div className="max-h-56 overflow-auto">
                  <table className="w-full table-fixed">
                    <thead className="sticky top-0 bg-[#080808]">
                      <tr className="border-b border-white/5 text-left font-mono text-[9px] uppercase tracking-widest text-gray-600">
                        <th className="w-[170px] px-3 py-1.5">label</th>
                        <th className="w-[120px] px-2 py-1.5">type</th>
                        <th className="w-[80px] px-2 py-1.5">host</th>
                        <th className="px-2 py-1.5">base</th>
                        <th className="w-[180px] px-2 py-1.5">models</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(snapshot.providers ?? []).map(provider => <tr key={provider.label} className="border-b border-white/5 font-mono text-[10px] text-gray-400">
                          <td className="px-3 py-1.5">
                            <div className="truncate text-gray-300" title={provider.label}>
                              {provider.label}
                            </div>
                            <div className="truncate text-[9px] text-gray-600" title={(provider.envKeys ?? []).join(", ")}>
                              {(provider.envKeys ?? []).join(", ") || "sem env"}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-gray-500">{provider.type}</td>
                          <td className="px-2 py-1.5 text-gray-500">{provider.host ?? "-"}</td>
                          <td className="truncate px-2 py-1.5" title={provider.baseUrl ?? ""}>
                            {provider.baseUrl ?? "-"}
                          </td>
                          <td className="truncate px-2 py-1.5 text-gray-500" title={(provider.models ?? []).join(", ")}>
                            {(provider.models ?? []).join(", ") || "-"}
                          </td>
                        </tr>)}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <PaneTable title="panes backend via pty:list" panes={snapshot.backendPanes ?? []} tone="neutral" />
                <PaneTable title="panes renderer store" panes={rendererPanes} tone="neutral" />
              </section>
              <section className={`rounded-lg border p-3 ${hasDivergence ? "border-yellow-500/25 bg-yellow-500/[0.04]" : "border-green-500/20 bg-green-500/[0.03]"}`}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                    Divergencia
                  </p>
                  <StatusPill ok={!hasDivergence} label={hasDivergence ? "revisar" : "sem divergencia"} />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <PaneTable title="backend sem UI" panes={divergence?.backendOnly ?? []} tone={divergence?.backendOnly?.length ? "warn" : "neutral"} />
                  <PaneTable title="UI sem backend" panes={divergence?.rendererOnly ?? []} tone={divergence?.rendererOnly?.length ? "warn" : "neutral"} />
                </div>
              </section>
              <section className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                    CLIs detectados
                  </p>
                  <span className="font-mono text-[9px] text-gray-600">
                    {Array.isArray(snapshot.clis) ? snapshot.clis.filter(cli => cli.found).length : 0}/{Array.isArray(snapshot.clis) ? snapshot.clis.length : 0}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {(Array.isArray(snapshot.clis) ? snapshot.clis : []).map(cli => <div key={cli.name} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                          {cli.name}
                        </p>
                        <StatusPill ok={cli.found} label={cli.found ? "found" : "not found"} />
                      </div>
                      <p className="mt-1 truncate font-mono text-[9px] text-gray-600" title={cli.path ?? ""}>
                        {cli.path ?? "-"}
                      </p>
                    </div>)}
                </div>
              </section>
            </div>}
        </div>
      </div>
    </div>;
}