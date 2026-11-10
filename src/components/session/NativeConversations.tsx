import React from "react";
import { resumeIdentity, resumeSavedPane, type ResumePane } from "../../lib/native-resume";
import { usePanesStore } from "../../stores/panes-store";
import { NativeResumeForm } from "./NativeResumeForm";

export function NativeConversations({ workspacePath, addPane, onResumed }: {
  workspacePath: string; addPane: (pane: any) => void; onResumed: () => void;
}) {
  const [panes, setPanes] = React.useState<(ResumePane & { savedAt: number })[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.codeBrainApp.session.loadAll(workspacePath).then(rows => {
      if (!cancelled) setPanes(rows.flatMap(row => row.panes.map(pane => ({ ...pane, savedAt: row.savedAt }))));
    }).catch(() => { if (!cancelled) setError("Não foi possível carregar as conversas salvas."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspacePath]);
  return <div className="space-y-3">
    <div><h3 className="cb-label">Conversas deste projeto</h3><p className="text-2xs text-cb-fg-2 mt-1">Retome o histórico nativo no mesmo harness e conta, sem reenviar a tarefa.</p></div>
    {loading ? <p role="status" className="text-xs text-cb-fg-2">Carregando conversas…</p> : panes.length === 0 ? <p className="text-xs text-cb-fg-2">Nenhuma conversa salva neste projeto. Uma sessão existente pode ser retomada pelo ID abaixo.</p> : <ul className="space-y-2" aria-label="Conversas salvas">
      {panes.map(pane => <li key={`${pane.id}:${pane.savedAt}`}>
        <button type="button" disabled={busy || pane.session?.confidence !== "high"} className="cb-btn w-full min-h-11 text-left justify-start disabled:opacity-50" title={pane.session?.id ?? "Prévia antiga sem ID nativo; use Retomar por ID."} onClick={async () => {
          setBusy(true); setError("");
          try {
            const identity = resumeIdentity(pane);
            const store = usePanesStore.getState() as { panes: any[]; setActive: (id: string) => void };
            const existing = store.panes.find(item => item.status !== "exited" && item.status !== "error" && resumeIdentity(item) === identity);
            if (existing) store.setActive(existing.id);
            else await resumeSavedPane(pane, workspacePath, addPane);
            onResumed();
          } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
          finally { setBusy(false); }
        }}>
          <span className="min-w-0"><span className="block text-xs">{pane.agent} · {pane.accountLabel ?? "perfil padrão"} · {pane.model ?? "modelo da sessão"}</span><span className="block truncate text-2xs text-cb-fg-2">{pane.session?.id ?? "Prévia antiga sem ID nativo"} · {new Date(pane.savedAt).toLocaleString("pt-BR")}</span></span>
        </button>
      </li>)}
    </ul>}
    {error && <p role="alert" className="text-xs text-cb-danger">{error}</p>}
    <NativeResumeForm workspacePath={workspacePath} addPane={addPane} onResumed={onResumed} />
  </div>;
}
