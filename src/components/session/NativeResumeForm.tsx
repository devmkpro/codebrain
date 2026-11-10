import React from "react";
import { resumeSavedPane } from "../../lib/native-resume";
import { useProvidersStore } from "../../stores/providers-store";

/** Explicit-ID fallback for older sessions and CLIs without a safe ID watcher. */
export function NativeResumeForm({ workspacePath, addPane, onResumed }: {
  workspacePath: string; addPane: (pane: any) => void; onResumed: () => void;
}) {
  const [harnesses, setHarnesses] = React.useState<{ id: string; evidence: string }[]>([]);
  const [accounts, setAccounts] = React.useState<{ id: string; cli: string; label: string }[]>([]);
  const [agent, setAgent] = React.useState("codex");
  const [accountId, setAccountId] = React.useState("");
  const [providerId, setProviderId] = React.useState("");
  const providers = useProvidersStore((state: any) => state.providers) as { id: string; host?: string; label?: string }[];
  const [id, setId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    const load = window.codeBrainApp?.session?.resumeHarnesses;
    if (!load) { setError("Catálogo de retomada indisponível neste build."); return; }
    load().then(setHarnesses).catch(() => setError("Catálogo de retomada indisponível."));
    window.codeBrainApp?.accounts?.list().then((result: any) => setAccounts(Array.isArray(result) ? result : result?.accounts ?? [])).catch(() => {});
  }, []);
  return <details className="px-3 py-2 border-b border-white/5" onClick={event => event.stopPropagation()}>
    <summary className="font-mono text-xs cursor-pointer min-h-9 focus-visible:outline focus-visible:outline-cb-accent">Retomar por ID</summary>
    <form className="flex flex-col gap-2 pt-2" onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError("");
      try {
        await resumeSavedPane({ agent, cwd: workspacePath, accountId: accountId || undefined, providerId: providerId || undefined,
          session: { provider: agent, harnessId: agent, id: id.trim(), capturedAt: Date.now(), confidence: "high", source: "explicit-user-id" } }, workspacePath, addPane);
        onResumed();
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setBusy(false); }
    }}>
      <label className="text-[11px]">Harness
        <select aria-label="Harness para retomar" value={agent} onChange={event => { setAgent(event.target.value); setAccountId(""); setProviderId(""); }} className="cb-input w-full min-h-11">
          {harnesses.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
      </label>
      {agent === "openclaude" && <label className="text-[11px]">Provider original
        <select aria-label="Provider original da conversa" value={providerId} required onChange={event => setProviderId(event.target.value)} className="cb-input w-full min-h-11">
          <option value="">Escolha o provider original</option>
          {providers.filter(provider => provider.host === "openclaude").map(provider => <option key={provider.id} value={provider.id}>{provider.label ?? provider.id}</option>)}
        </select>
      </label>}
      {accounts.some(account => account.cli === agent) && <label className="text-[11px]">Conta original
        <select aria-label="Conta original da conversa" value={accountId} onChange={event => setAccountId(event.target.value)} className="cb-input w-full min-h-11">
          <option value="">Perfil padrão da CLI</option>
          {accounts.filter(account => account.cli === agent).map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select>
      </label>}
      <label className="text-[11px]">ID nativo completo
        <input aria-label="ID nativo completo" value={id} onChange={event => setId(event.target.value)} required maxLength={256} autoComplete="off" className="cb-input w-full min-h-11" />
      </label>
      <p className="text-[10px] text-cb-fg-2">Use o mesmo projeto e perfil. O histórico completo continua armazenado pela CLI, não pela prévia do terminal.</p>
      {error && <p role="alert" className="text-xs text-cb-danger">{error}</p>}
      <button type="submit" disabled={busy || !id.trim() || harnesses.length === 0} className="cb-btn min-h-11 disabled:opacity-50">{busy ? "Retomando…" : "Retomar conversa"}</button>
    </form>
  </details>;
}
