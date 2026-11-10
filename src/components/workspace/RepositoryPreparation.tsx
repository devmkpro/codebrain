import React from "react";
import { Bot, FileText, Sparkles, X } from "lucide-react";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useNavStore } from "../../stores/nav-store";

type Preparation = {
  ok: boolean;
  initialized: boolean;
  workspace: string;
  stack: string[];
  commands: string[];
  skills: { id: string; title: string }[];
  files: string[];
  missing?: string[];
  git: boolean;
  created?: string[];
  commit?: string;
  commitError?: string;
  error?: string;
};

export function RepositoryPreparation({
  workspacePath,
  showRecommendation = true,
}: {
  workspacePath: string;
  showRecommendation?: boolean;
}) {
  const active = useNavStore(
    (state: any) =>
      !state.onHome && state.tabs[state.activeTabIndex]?.workspacePath === workspacePath
  );
  const [status, setStatus] = React.useState<Preparation | null>(null);
  const [open, setOpen] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Preparation | null>(null);
  const generation = React.useRef(0);
  const busyRef = React.useRef(false);
  const operation = React.useRef(0);
  const actionFailed = React.useRef(false);
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    const key = ++generation.current;
    let refreshing = false;
    setStatus(null);
    setResult(null);
    setError(null);
    setOpen(false);
    setDismissed(false);
    setBusy(false);
    busyRef.current = false;
    actionFailed.current = false;
    const refresh = async (manual = false) => {
      if (refreshing || busyRef.current) return;
      refreshing = true;
      const revision = operation.current;
      try {
        const load = window.codeBrainApp?.workspace?.preparationStatus;
        if (!load) throw new Error("A preparação não está disponível nesta versão do app.");
        const next = await load(workspacePath);
        if (key !== generation.current || revision !== operation.current || busyRef.current) return;
        if (!next?.ok)
          throw new Error(next?.error || "Não foi possível inspecionar este repositório.");
        setStatus(next);
        if (!actionFailed.current || manual) {
          setError(null);
          actionFailed.current = false;
        }
        if (next.initialized) setDismissed(true);
      } catch (err) {
        if (key === generation.current && revision === operation.current && !busyRef.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        refreshing = false;
      }
    };
    refreshRef.current = () => {
      void refresh(true);
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8_000);
    return () => {
      ++generation.current;
      window.clearInterval(timer);
    };
  }, [workspacePath]);

  React.useEffect(() => {
    if (!active) {
      setOpen(false);
      return;
    }
    const show = () => setOpen(true);
    window.addEventListener("codebrain:prepare-repository", show);
    return () => window.removeEventListener("codebrain:prepare-repository", show);
  }, [active]);

  const prepare = async () => {
    if (busyRef.current || !status?.ok) return;
    const key = generation.current;
    ++operation.current;
    actionFailed.current = false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const run = window.codeBrainApp?.workspace?.prepare;
      if (!run) throw new Error("A preparação local não está disponível nesta versão.");
      let next: Preparation = await run({ workspace: workspacePath, createCommit: false });
      if (key !== generation.current) return;
      // Uma versão anterior pode devolver o status anterior à gravação; confirme no disco.
      if (next?.ok && !next.initialized) {
        const inspected = await window.codeBrainApp.workspace.preparationStatus?.(workspacePath);
        if (key !== generation.current) return;
        if (inspected) next = { ...next, ...inspected };
      }
      setResult(next);
      if (!next?.ok || !next.initialized)
        throw new Error(
          next?.error ||
            (next?.missing?.length
              ? `Preparação incompleta. Arquivos pendentes ou inválidos: ${next.missing.join(", ")}`
              : "A preparação não confirmou os arquivos locais. Verifique a versão do app e os entregáveis listados.")
        );
      setStatus(next);
      setDismissed(true);
    } catch (err) {
      if (key === generation.current) {
        actionFailed.current = true;
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (key === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const startPreparationAgent = () => {
    if (!status?.initialized) return;
    usePaneLauncherStore.getState().show({
      title: "Agente de preparação",
      subtitle: "Aprofundar contexto local · escolha um provider",
      initialPrompt: `Aprofunde a preparação existente deste repositório. Workspace: ${workspacePath}\n\nA preparação nativa local já criou contexto, scripts e skills sem catálogo online. Leia .codebrain/context.md, .codebrain/repository-map.md e .codebrain/workflow.md; use node .codebrain/scripts/context.cjs para consultar o contexto e node .codebrain/scripts/verify.cjs --list para listar verificações, antes de decidir quais executar.\n\nInspecione o código real e preserve conteúdo humano. Atualize somente instruções locais relevantes à stack ${status.stack.join(", ") || "a confirmar"}. Skills nativas ficam em .codebrain/skills/<id>/ com skill.json (id, name, type: prompt, version, description, entrypoint) e o arquivo Markdown do entrypoint. SKILL.md sozinho não basta para skill_list/skill_get. Não baixe skills do marketplace nem dependa de uma skill ausente. Não altere funcionalidades e não faça commit. Informe os arquivos alterados, os comandos realmente executados e limitações.`,
    });
    setOpen(false);
  };

  if (!active) return null;
  const files = status?.initialized
    ? status.files
    : [
        ".codebrain/context.md",
        ".codebrain/repository-map.md",
        ".codebrain/workflow.md",
        ".codebrain/scripts/context.cjs",
        ".codebrain/scripts/verify.cjs",
        ".codebrain/skills/<id>/skill.json + SKILL.md",
        ".codebrain/baseline.json",
      ];
  return (
    <>
      {showRecommendation && !status?.initialized && !dismissed && (
        <aside className="absolute top-3 right-3 z-[120] w-[min(360px,calc(100%-24px))] border border-cb-accent/40 bg-cb-bg-1 shadow-cb-pop rounded-cb-1 p-3">
          <div className="flex gap-2">
            <div className="mt-0.5 h-7 w-7 shrink-0 flex items-center justify-center border border-cb-accent/40 bg-cb-accent-wash rounded-cb-1">
              <Sparkles size={14} className="text-cb-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-cb-fg-0">Preparar este repositório</div>
              <p className="mt-1 text-2xs leading-relaxed text-cb-fg-2">
                Contexto, scripts e skills nativas locais. Funciona sem provider ou catálogo online.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="p-1 self-start text-cb-fg-3 hover:text-cb-fg-0"
              aria-label="Fechar recomendação"
            >
              <X size={13} />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-2xs text-cb-fg-3 truncate">
              {error
                ? "Não foi possível verificar a preparação"
                : status
                  ? status.stack.join(" · ") || "stack não detectada"
                  : "Inspecionando repositório…"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="h-cell px-3 shrink-0 border border-cb-accent bg-cb-accent text-cb-on-accent text-xs font-semibold rounded-cb-1"
            >
              Preparar
            </button>
          </div>
        </aside>
      )}
      {open && (
        <div
          className="fixed inset-0 z-[var(--cb-z-modal)] flex items-center justify-center p-4 bg-cb-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Preparar repositório"
        >
          <section className="w-full max-w-[650px] max-h-[90vh] flex flex-col overflow-hidden border border-cb-line-2 bg-cb-bg-1 shadow-cb-modal rounded-cb-2">
            <header className="h-14 px-4 flex items-center gap-3 border-b border-cb-line-0 shrink-0">
              <Sparkles size={15} className="text-cb-accent" />
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-cb-fg-0">Preparação do repositório</h2>
                <p className="text-2xs text-cb-fg-3">
                  Geração local com skills nativas Codebrain. O agente é opcional.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="p-1 text-cb-fg-3 hover:text-cb-fg-0"
                aria-label="Fechar"
              >
                <X size={14} />
              </button>
            </header>
            <div className="p-4 cb-scroll overflow-auto">
              <p className="text-xs text-cb-fg-2 break-all mb-3">{workspacePath}</p>
              {error && (
                <div className="text-xs text-cb-danger mb-3" role="alert">
                  {error}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => refreshRef.current()}
                    className="ml-2 underline"
                  >
                    verificar novamente
                  </button>
                </div>
              )}
              {result?.ok && result.initialized && (
                <div className="text-xs text-cb-success mb-3" role="status">
                  Preparação concluída: {result.created?.length ?? 0} arquivo(s) criado(s) ou
                  atualizado(s). Nenhum teste foi executado e nenhum commit foi criado.
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="cb-label mb-2">arquivos locais</div>
                  <div className="space-y-1">
                    {files.map((file) => (
                      <div key={file} className="flex gap-2 text-2xs text-cb-fg-1">
                        <FileText size={12} className="text-cb-accent shrink-0" />
                        <code className="break-all">{file}</code>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="cb-label mb-2">detecção atual</div>
                  <p className="text-xs text-cb-fg-1">
                    {status
                      ? status.stack.join(" · ") || "Nenhuma stack reconhecida"
                      : "Aguardando inspeção do repositório"}
                  </p>
                  <div className="mt-3 cb-label mb-2">
                    comandos detectados, ainda não executados
                  </div>
                  {status?.commands.length ? (
                    status.commands.map((command) => (
                      <code key={command} className="block mb-1 text-2xs text-cb-fg-1">
                        {command}
                      </code>
                    ))
                  ) : (
                    <p className="text-2xs text-cb-fg-3">
                      Nenhum comando reconhecido. Será necessário defini-los a partir do projeto.
                    </p>
                  )}
                </div>
              </div>
              {busy && (
                <p className="text-xs text-cb-fg-2 mt-3" role="status">
                  Preparando arquivos e verificando os entregáveis locais…
                </p>
              )}
            </div>
            <footer className="p-4 border-t border-cb-line-0 flex flex-wrap justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="h-cell px-3 text-xs text-cb-fg-2 hover:text-cb-fg-0"
              >
                fechar
              </button>
              {status?.initialized && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={startPreparationAgent}
                  className="h-cell px-3 flex items-center gap-2 border border-cb-line-1 text-cb-fg-1 text-xs"
                >
                  <Bot size={13} />
                  aprofundar com agente
                </button>
              )}
              <button
                type="button"
                disabled={busy || !status?.ok}
                onClick={() => void prepare()}
                className="h-cell px-3 flex items-center gap-2 border border-cb-accent bg-cb-accent text-cb-on-accent text-xs font-semibold disabled:opacity-50"
              >
                <Sparkles size={13} />
                {busy
                  ? "preparando…"
                  : status?.initialized
                    ? "verificar e completar arquivos"
                    : "preparar localmente"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
