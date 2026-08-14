import React from "react";
import { Bot, FileText, Sparkles, X } from "lucide-react";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";

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
    const openPreparation = () => { setDismissed(false); setOpen(true); };
    window.addEventListener("codebrain:prepare-repository", openPreparation);
    return () => window.removeEventListener("codebrain:prepare-repository", openPreparation);
  }, []);

  const startPreparationAgent = () => {
    if (!status) return;
    const stack = status.stack.join(", ") || "ainda não identificada";
    const commands = status.commands.length ? status.commands.map((command) => `- ${command}`).join("\n") : "- Descubra os comandos de lint, teste e build adequados.";
    usePaneLauncherStore.getState().show({
      title: "Agente de preparação",
      subtitle: "1 de 2 · escolha o provider para analisar este repositório",
      initialPrompt: `Prepare este repositório para trabalho assistido por IA. Você é o agente responsável pela preparação inicial.\n\nWorkspace: ${workspacePath}\nStack detectada pelo Codebrain: ${stack}\nComandos candidatos:\n${commands}\n\nExecute esta missão agora:\n1. Inspecione a estrutura, instruções existentes e a stack real antes de editar.\n2. Crie ou atualize, sem apagar conteúdo humano, .codebrain/context.md, .codebrain/repository-map.md e .codebrain/workflow.md.\n3. Crie Skills em .codebrain/skills/ específicas para a stack realmente encontrada e para os comandos/arquitetura deste projeto. Não instale presets globais ou Skills genéricas de outro projeto.\n4. Registre como verificar mudanças com lint, testes e build reais.\n5. Crie .codebrain/baseline.json com a stack e os comandos detectados para marcar esta preparação como concluída.\n6. Não altere funcionalidades do produto. Não faça commit sem pedir confirmação ao usuário.\n7. Ao terminar, mostre um resumo curto dos arquivos criados, stack detectada e verificações recomendadas.`,
    });
    setOpen(false);
    setDismissed(true);
  };

  if (!status?.ok) return null;
  const files = ["context.md", "repository-map.md", "workflow.md", "skills/project-conventions", "skills/test-and-verify", ...status.skills.map((skill) => `skills/${skill.id}`), "baseline.json"];

  return <>
    {!status.initialized && !dismissed && <aside className="absolute top-3 right-3 z-[120] w-[min(360px,calc(100%-24px))] border border-cb-accent/40 bg-cb-bg-1 shadow-cb-pop rounded-cb-1 p-3">
      <div className="flex gap-2"><div className="mt-0.5 h-7 w-7 shrink-0 flex items-center justify-center border border-cb-accent/40 bg-cb-accent-wash rounded-cb-1"><Sparkles size={14} className="text-cb-accent" /></div><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-cb-fg-0">Preparar este repositório</div><p className="mt-1 text-2xs leading-relaxed text-cb-fg-2">Detecta a stack e gera contexto, verificações e Skills específicas para os agentes.</p></div><button type="button" onClick={() => setDismissed(true)} className="p-1 self-start text-cb-fg-3 hover:text-cb-fg-0" title="Agora não" aria-label="Fechar recomendação"><X size={13}/></button></div>
      <div className="mt-3 flex items-center justify-between gap-2"><span className="text-2xs text-cb-fg-3 truncate">{status.stack.join(" · ") || "stack não detectada"}</span><button type="button" onClick={() => setOpen(true)} className="h-cell px-3 shrink-0 border border-cb-accent bg-cb-accent text-cb-on-accent text-xs font-semibold rounded-cb-1">Preparar</button></div>
    </aside>}
    {open && <div className="fixed inset-0 z-[var(--cb-z-modal)] flex items-center justify-center p-4 bg-cb-scrim" role="dialog" aria-modal="true" aria-label="Preparar repositório"><section className="w-full max-w-[650px] overflow-hidden border border-cb-line-2 bg-cb-bg-1 shadow-cb-modal rounded-cb-2"><header className="h-12 px-4 flex items-center gap-3 border-b border-cb-line-0"><Sparkles size={15} className="text-cb-accent"/><div className="flex-1"><h2 className="text-sm font-semibold text-cb-fg-0">Preparação inteligente do repositório</h2><p className="text-2xs text-cb-fg-3">Você escolhe o provider; o agente cria o contexto e as Skills locais.</p></div><button onClick={() => setOpen(false)} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Fechar"><X size={14}/></button></header><div className="p-4 grid sm:grid-cols-2 gap-4"><div><div className="cb-label mb-2">entregáveis do agente</div><div className="space-y-1">{files.map((file) => <div key={file} className="flex gap-2 text-2xs text-cb-fg-1"><FileText size={12} className="text-cb-accent shrink-0"/><code>{file}</code></div>)}</div></div><div><div className="cb-label mb-2">detecção atual</div><p className="text-xs text-cb-fg-1">{status.stack.join(" · ") || "Nenhuma stack reconhecida"}</p><div className="mt-3 cb-label mb-2">verificações sugeridas</div>{status.commands.length ? status.commands.map((command) => <code key={command} className="block mb-1 text-2xs text-cb-success">{command}</code>) : <p className="text-2xs text-cb-fg-3">O agente vai identificar as verificações.</p>}</div></div><footer className="p-4 border-t border-cb-line-0 flex flex-wrap justify-end gap-2"><button onClick={() => setOpen(false)} className="h-cell px-3 text-xs text-cb-fg-2 hover:text-cb-fg-0">cancelar</button><button onClick={startPreparationAgent} className="h-cell px-3 flex items-center gap-2 border border-cb-accent bg-cb-accent text-cb-on-accent text-xs font-semibold"><Bot size={13}/>escolher provider e iniciar</button></footer></section></div>}
  </>;
}
