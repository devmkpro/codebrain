import React from "react";
import { Check, FileText, GitCommitHorizontal, LoaderCircle, Sparkles, X } from "lucide-react";
import { notify } from "../../lib/notify";

type Preparation = {
  ok: boolean;
  initialized: boolean;
  workspace: string;
  stack: string[];
  commands: string[];
  skills: { id: string; title: string }[];
  files: string[];
  git: boolean;
  created?: string[];
  commit?: string;
  commitError?: string;
  error?: string;
};

export function RepositoryPreparation({ workspacePath }: { workspacePath: string }) {
  const [status, setStatus] = React.useState<Preparation | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<"apply" | "commit" | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    setStatus(null);
    setDismissed(false);
    const preparationStatus = window.codeBrainApp?.workspace?.preparationStatus;
    if (!preparationStatus) return;
    preparationStatus(workspacePath)
      .then((result) => setStatus(result))
      .catch(() => setStatus(null));
  }, [workspacePath]);

  React.useEffect(() => {
    const openPreparation = () => setOpen(true);
    window.addEventListener("codebrain:prepare-repository", openPreparation);
    return () => window.removeEventListener("codebrain:prepare-repository", openPreparation);
  }, []);

  const prepare = async (createCommit: boolean) => {
    if (busy) return;
    const prepareWorkspace = window.codeBrainApp?.workspace?.prepare;
    if (!prepareWorkspace) {
      notify("Reinicie o Codebrain", "O preload ainda não possui a preparação de repositório.", "error");
      return;
    }
    setBusy(createCommit ? "commit" : "apply");
    try {
      const result = await prepareWorkspace({ workspace: workspacePath, createCommit });
      if (!result.ok) throw new Error(result.error || "Não foi possível preparar o repositório.");
      setStatus(result);
      setOpen(false);
      setDismissed(true);
      notify("Repositório preparado", result.commit ? "Contexto, Skills e commit criados." : "Contexto e Skills locais criados.", "success");
    } catch (error) {
      notify("Preparação falhou", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  if (!status?.ok || status.initialized || dismissed) return null;
  const files = ["context.md", "repository-map.md", "workflow.md", "skills/project-conventions", "skills/test-and-verify", ...status.skills.map((skill) => `skills/${skill.id}`), "baseline.json"];

  return <>
    <aside className="absolute top-3 right-3 z-[120] w-[min(360px,calc(100%-24px))] border border-cb-accent/40 bg-cb-bg-1 shadow-cb-pop rounded-cb-1 p-3">
      <div className="flex gap-2"><div className="mt-0.5 h-7 w-7 shrink-0 flex items-center justify-center border border-cb-accent/40 bg-cb-accent-wash rounded-cb-1"><Sparkles size={14} className="text-cb-accent" /></div><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-cb-fg-0">Preparar este repositório</div><p className="mt-1 text-2xs leading-relaxed text-cb-fg-2">Detecta a stack e gera contexto, verificações e Skills específicas para os agentes.</p></div><button type="button" onClick={() => setDismissed(true)} className="p-1 self-start text-cb-fg-3 hover:text-cb-fg-0" title="Agora não" aria-label="Fechar recomendação"><X size={13}/></button></div>
      <div className="mt-3 flex items-center justify-between gap-2"><span className="text-2xs text-cb-fg-3 truncate">{status.stack.join(" · ") || "stack não detectada"}</span><button type="button" onClick={() => setOpen(true)} className="h-cell px-3 shrink-0 border border-cb-accent bg-cb-accent text-cb-on-accent text-xs font-semibold rounded-cb-1">Preparar</button></div>
    </aside>
    {open && <div className="fixed inset-0 z-[var(--cb-z-modal)] flex items-center justify-center p-4 bg-cb-scrim" role="dialog" aria-modal="true" aria-label="Preparar repositório"><section className="w-full max-w-[650px] overflow-hidden border border-cb-line-2 bg-cb-bg-1 shadow-cb-modal rounded-cb-2"><header className="h-12 px-4 flex items-center gap-3 border-b border-cb-line-0"><Sparkles size={15} className="text-cb-accent"/><div className="flex-1"><h2 className="text-sm font-semibold text-cb-fg-0">Preparação inteligente do repositório</h2><p className="text-2xs text-cb-fg-3">Cria contexto portátil e versionável em <code>.codebrain/</code></p></div><button onClick={() => setOpen(false)} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Fechar"><X size={14}/></button></header><div className="p-4 grid sm:grid-cols-2 gap-4"><div><div className="cb-label mb-2">o que será criado</div><div className="space-y-1">{files.map((file) => <div key={file} className="flex gap-2 text-2xs text-cb-fg-1"><FileText size={12} className="text-cb-accent shrink-0"/><code>{file}</code></div>)}</div></div><div><div className="cb-label mb-2">detecção atual</div><p className="text-xs text-cb-fg-1">{status.stack.join(" · ") || "Nenhuma stack reconhecida"}</p><div className="mt-3 cb-label mb-2">verificações sugeridas</div>{status.commands.length ? status.commands.map((command) => <code key={command} className="block mb-1 text-2xs text-cb-success">{command}</code>) : <p className="text-2xs text-cb-fg-3">Defina os comandos após a preparação.</p>}</div></div><footer className="p-4 border-t border-cb-line-0 flex flex-wrap justify-end gap-2"><button onClick={() => setOpen(false)} disabled={Boolean(busy)} className="h-cell px-3 text-xs text-cb-fg-2 hover:text-cb-fg-0">cancelar</button><button onClick={() => void prepare(false)} disabled={Boolean(busy)} className="h-cell px-3 flex items-center gap-2 border border-cb-line-1 text-xs text-cb-fg-1 hover:border-cb-line-2">{busy === "apply" ? <LoaderCircle size={12} className="animate-spin"/> : <Check size={12}/>}aplicar sem commit</button>{status.git && <button onClick={() => void prepare(true)} disabled={Boolean(busy)} className="h-cell px-3 flex items-center gap-2 border border-cb-accent bg-cb-accent text-cb-on-accent text-xs font-semibold">{busy === "commit" ? <LoaderCircle size={12} className="animate-spin"/> : <GitCommitHorizontal size={13}/>}aplicar e criar commit</button>}</footer></section></div>}
  </>;
}
