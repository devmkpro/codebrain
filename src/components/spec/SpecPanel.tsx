import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, FileCode2, FolderOpen, Plus, Rocket, X } from "lucide-react";
import { useNavStore } from "../../stores/nav-store";
import { usePanesStore } from "../../stores/panes-store";
import { type SpecAnswers, useSpecStore } from "../../stores/spec-store";

const EMPTY_ANSWERS: SpecAnswers = {
  title: "",
  problem: "",
  users: "",
  outcome: "",
  acceptanceCriteria: "",
  constraints: "",
  nonGoals: "",
};

const STEPS = [
  { label: "spec", hint: "problema" },
  { label: "plan", hint: "resultado" },
  { label: "tasks", hint: "critérios" },
  { label: "code", hint: "revisar" },
];

function samePath(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase();
}

function fieldClass() {
  return "w-full bg-cb-bg-0 border border-cb-line-1 rounded-cb-1 px-2.5 py-2 text-xs outline-none focus:border-cb-accent placeholder:text-cb-fg-3";
}

export function SpecPanel() {
  const { visible, specs, loading, error, toggle, load, create } = useSpecStore();
  const tabs = useNavStore((state) => state.tabs) as Array<{ workspacePath: string }>;
  const active = useNavStore((state) => state.activeTabIndex);
  const panes = usePanesStore((state: any) => state.panes) as any[];
  const activePaneId = usePanesStore((state: any) => state.activePaneId) as string | null;
  const workspace = tabs[active]?.workspacePath;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SpecAnswers>(EMPTY_ANSWERS);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const agentPane = useMemo(() => {
    const candidates = panes.filter((pane) => samePath(pane.workspacePath ?? pane.cwd, workspace) && pane.kind !== "browser" && pane.agent !== "shell");
    return candidates.find((pane) => pane.id === activePaneId) ?? candidates[0] ?? null;
  }, [activePaneId, panes, workspace]);

  useEffect(() => { if (visible && workspace) void load(workspace); }, [visible, workspace, load]);
  if (!visible) return null;

  const update = (field: keyof SpecAnswers, value: string) => setAnswers((current) => ({ ...current, [field]: value }));
  const canContinue = [
    Boolean(answers.title.trim() && answers.problem.trim()),
    Boolean(answers.users.trim() && answers.outcome.trim()),
    Boolean(answers.acceptanceCriteria.trim()),
    true,
  ][step];

  const createSpec = async () => {
    if (!workspace) return;
    if (await create(workspace, answers)) {
      setAnswers(EMPTY_ANSWERS);
      setStep(0);
      setNotice("Spec, plano e tarefas criados em disco. Agora escolha Implementar com agente.");
    }
  };

  const implement = async (spec: (typeof specs)[number]) => {
    if (!workspace || !agentPane) return;
    setDispatching(spec.id);
    setNotice(null);
    const result = await window.codeBrainApp.conversation.send({
      toPane: agentPane.id,
      workspace,
      content: [
        `Implemente a feature ${spec.id} neste workspace.`,
        "",
        "Use o fluxo Spec Kit como contrato de execução:",
        `1. Leia ${spec.path}\\spec.md e confirme o comportamento esperado.`,
        `2. Leia ${spec.path}\\plan.md antes de alterar a arquitetura.`,
        `3. Execute ${spec.path}\\tasks.md em ordem e marque cada checkbox somente após obter evidência.`,
        "4. Rode os testes, lint e build disponíveis.",
        "5. Revise o diff contra todos os critérios de aceitação e registre no arquivo de tarefas qualquer desvio ou bloqueio.",
        "",
        "Não encerre na fase de análise: implemente o código e valide o resultado.",
      ].join("\n"),
    });
    setDispatching(null);
    setNotice(result.ok
      ? `Implementação enviada para ${agentPane.title || agentPane.agent}. Acompanhe o progresso no terminal.`
      : result.error || "Não foi possível iniciar a implementação.");
  };

  return <aside className="absolute inset-y-0 right-0 w-[min(560px,96vw)] flex flex-col bg-cb-bg-1 border-l border-cb-line-1 shadow-2xl" style={{ zIndex: "var(--cb-z-panel)" }}>
    <header className="h-cell-lg px-3 flex items-center gap-2 border-b border-cb-line-0">
      <FileCode2 size={14} className="text-cb-accent"/>
      <div className="flex-1"><div className="text-xs text-cb-fg-0">Spec Kit</div><div className="text-2xs text-cb-fg-3">perguntas → documentos → implementação</div></div>
      <span className="text-[9px] uppercase tracking-wider text-cb-accent border border-cb-accent/30 rounded px-1.5 py-0.5">experimental</span>
      <button onClick={toggle} aria-label="Fechar"><X size={14}/></button>
    </header>
    {!workspace ? <div className="m-auto max-w-xs text-center px-6"><FolderOpen size={28} className="mx-auto mb-3 text-cb-fg-3"/><p className="text-xs text-cb-fg-1">Abra um workspace para iniciar uma especificação guiada.</p></div> : <>
      <div className="px-4 py-3 border-b border-cb-line-0 bg-cb-bg-0/40">
        <div className="flex items-center">
          {STEPS.map((item, index) => <React.Fragment key={item.label}>
            <button type="button" onClick={() => index <= step && setStep(index)} className="min-w-0 text-left">
              <div className={`h-5 w-5 rounded-full border flex items-center justify-center text-[9px] ${index < step ? "bg-cb-success border-cb-success text-cb-bg-0" : index === step ? "border-cb-accent text-cb-accent" : "border-cb-line-1 text-cb-fg-3"}`}>{index < step ? <Check size={10}/> : index + 1}</div>
              <div className={`mt-1 text-[10px] ${index === step ? "text-cb-fg-0" : "text-cb-fg-3"}`}>/{item.label}</div>
              <div className="text-[9px] text-cb-fg-3">{item.hint}</div>
            </button>
            {index < STEPS.length - 1 && <div className={`h-px flex-1 mx-2 ${index < step ? "bg-cb-success" : "bg-cb-line-1"}`}/>}
          </React.Fragment>)}
        </div>
      </div>

      <div className="cb-scroll flex-1 overflow-auto">
        <form className="p-4 border-b border-cb-line-0" onSubmit={(event) => { event.preventDefault(); if (step < 3) setStep(step + 1); else void createSpec(); }}>
          {step === 0 && <div className="space-y-3">
            <div><div className="cb-label mb-1">O que vamos construir?</div><input autoFocus value={answers.title} onChange={(event) => update("title", event.target.value)} placeholder="Ex.: checkout sem cadastro" className={fieldClass()}/></div>
            <div><div className="cb-label mb-1">Qual problema real precisa ser resolvido?</div><textarea value={answers.problem} onChange={(event) => update("problem", event.target.value)} placeholder="Descreva o problema atual, não a solução imaginada." rows={4} className={`${fieldClass()} resize-none`}/></div>
          </div>}
          {step === 1 && <div className="space-y-3">
            <div><div className="cb-label mb-1">Quem sente esse problema?</div><textarea autoFocus value={answers.users} onChange={(event) => update("users", event.target.value)} placeholder="Usuários, equipe ou sistema afetado." rows={3} className={`${fieldClass()} resize-none`}/></div>
            <div><div className="cb-label mb-1">O que muda quando estiver pronto?</div><textarea value={answers.outcome} onChange={(event) => update("outcome", event.target.value)} placeholder="Resultado observável e mensurável." rows={4} className={`${fieldClass()} resize-none`}/></div>
          </div>}
          {step === 2 && <div className="space-y-3">
            <div><div className="cb-label mb-1">Como saberemos que funciona?</div><textarea autoFocus value={answers.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} placeholder={"Um critério verificável por linha\nEx.: usuário conclui a compra sem criar conta"} rows={5} className={`${fieldClass()} resize-none`}/></div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className="cb-label mb-1">Restrições</div><textarea value={answers.constraints} onChange={(event) => update("constraints", event.target.value)} placeholder="Prazo, compatibilidade..." rows={3} className={`${fieldClass()} resize-none`}/></div>
              <div><div className="cb-label mb-1">Fora de escopo</div><textarea value={answers.nonGoals} onChange={(event) => update("nonGoals", event.target.value)} placeholder="O que não será feito?" rows={3} className={`${fieldClass()} resize-none`}/></div>
            </div>
          </div>}
          {step === 3 && <div className="space-y-3">
            <div className="text-xs text-cb-fg-0">Pronto para materializar o fluxo</div>
            <div className="grid grid-cols-3 gap-2">
              {[{ name: "spec.md", detail: "problema + requisitos" }, { name: "plan.md", detail: "stack + estratégia" }, { name: "tasks.md", detail: "execução verificável" }].map((file) => <div key={file.name} className="border border-cb-line-1 rounded-cb-1 p-2 bg-cb-bg-0"><FileCode2 size={13} className="mb-2 text-cb-accent"/><div className="text-2xs text-cb-fg-0">{file.name}</div><div className="text-[9px] text-cb-fg-3 mt-0.5">{file.detail}</div></div>)}
            </div>
            <div className="rounded-cb-1 border border-cb-line-0 p-3 text-2xs text-cb-fg-2 space-y-1"><div><span className="text-cb-fg-3">Feature:</span> {answers.title}</div><div><span className="text-cb-fg-3">Resultado:</span> {answers.outcome}</div><div><span className="text-cb-fg-3">Destino:</span> {workspace}\\specs</div></div>
          </div>}
          <div className="flex items-center gap-2 mt-4">
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="h-cell px-3 border border-cb-line-1 rounded-cb-1 text-xs flex items-center gap-1"><ArrowLeft size={12}/> voltar</button>}
            <button disabled={!canContinue || loading} className="h-cell px-3 bg-cb-accent text-cb-bg-0 rounded-cb-1 text-xs flex items-center gap-1 disabled:opacity-40">{step < 3 ? <>continuar <ArrowRight size={12}/></> : <><Plus size={12}/> criar documentos</>}</button>
          </div>
          {error && <p className="mt-2 text-2xs text-cb-danger">{error}</p>}
        </form>

        {notice && <div className="mx-3 mt-3 px-3 py-2 border border-cb-accent/30 bg-cb-accent/5 rounded-cb-1 text-2xs text-cb-fg-1">{notice}</div>}
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between"><div className="cb-label">specs deste workspace</div><span className="text-2xs text-cb-fg-3">{specs.length}</span></div>
          {specs.length === 0 && !loading && <p className="py-6 text-xs text-cb-fg-3 text-center">Responda às perguntas acima para criar a primeira.</p>}
          {specs.map((spec) => <section key={spec.id} className="border border-cb-line-1 rounded-cb-1 bg-cb-bg-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-cb-line-0"><div className="text-xs text-cb-fg-0">{spec.title}</div><div className="text-2xs text-cb-fg-3">{spec.id}</div></div>
            <div className="flex">{spec.files.map((file, index) => <button key={file.name} onClick={() => void window.codeBrainApp.spec.open({ workspace, id: spec.id, file: file.name })} className={`flex-1 py-2 text-2xs hover:text-cb-accent ${index ? "border-l border-cb-line-0" : ""}`}><span className={file.exists ? "text-cb-success" : "text-cb-danger"}>{file.exists ? "●" : "○"}</span> {file.name}</button>)}</div>
            <button disabled={!agentPane || dispatching === spec.id} onClick={() => void implement(spec)} title={agentPane ? `Enviar para ${agentPane.title || agentPane.agent}` : "Abra um agente de IA neste workspace"} className="w-full h-cell border-t border-cb-line-0 px-3 flex items-center justify-center gap-1.5 text-2xs text-cb-accent hover:bg-cb-accent/5 disabled:text-cb-fg-3 disabled:opacity-60"><Rocket size={12}/>{dispatching === spec.id ? "enviando..." : agentPane ? `implementar com ${agentPane.title || agentPane.agent}` : <><Bot size={12}/> abra um agente para implementar</>}</button>
          </section>)}
        </div>
      </div>
    </>}
  </aside>;
}
