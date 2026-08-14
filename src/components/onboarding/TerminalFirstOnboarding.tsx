import React from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Command,
  FileCode2,
  FolderGit2,
  Keyboard,
  LayoutPanelLeft,
  ListChecks,
  MousePointerClick,
  Settings2,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { navigate } from "../../lib/router";
import { useNavStore } from "../../stores/nav-store";
import { useOnboardingStore } from "../../stores/onboarding-store";
import { useSpecStore } from "../../stores/spec-store";

const STEPS = ["terminal-first", "navegação", "spec kit"];

function FlowStep({ index, title, command, description }: { index: number; title: string; command: string; description: string }) {
  return (
    <div className="relative flex-1 min-w-[130px] border border-cb-line-1 bg-cb-bg-0 rounded-cb-1 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cb-accent text-cb-bg-0 text-2xs font-bold">{index}</span>
        <span className="text-xs font-semibold text-cb-fg-0">{title}</span>
      </div>
      <code className="block text-2xs text-cb-accent-bright mb-2">/{command}</code>
      <p className="text-2xs leading-relaxed text-cb-fg-3">{description}</p>
      {index < 4 && <ArrowRight size={13} className="absolute -right-[15px] top-1/2 -translate-y-1/2 text-cb-accent z-10 hidden md:block" />}
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="grid md:grid-cols-[1.05fr_.95fr] gap-5 items-stretch">
      <div>
        <span className="cb-label text-cb-accent">nova experiência</span>
        <h2 className="text-2xl font-semibold text-cb-fg-0 mt-2 leading-tight">O Codebrain agora é<br /><span className="text-cb-accent-bright">terminal-first.</span></h2>
        <p className="text-sm text-cb-fg-2 leading-relaxed mt-4 max-w-md">Menos ícones escondidos, mais contexto. Workspaces, agentes e ações ficam visíveis no mesmo fluxo, sem tirar o terminal do centro.</p>
        <div className="mt-5 space-y-2">
          {["Clique no workspace no topo para trocar de projeto", "Use Ctrl+K para encontrar qualquer ação", "Acompanhe todos os agentes no rail lateral"].map((text) => <div key={text} className="flex items-center gap-2 text-xs text-cb-fg-1"><Check size={12} className="text-cb-success" />{text}</div>)}
        </div>
      </div>
      <div className="border border-cb-line-1 bg-cb-bg-0 rounded-cb-1 p-3 flex flex-col">
        <div className="h-7 border-b border-cb-line-0 flex items-center gap-2 text-2xs text-cb-fg-3"><span className="text-cb-accent">❯</span> meu-workspace <span className="ml-auto cb-kbd">Ctrl K</span></div>
        <div className="flex flex-1 min-h-[190px]">
          <div className="w-24 border-r border-cb-line-0 py-2 space-y-1"><div className="cb-label px-2">agentes · 3</div>{["orchestrator", "frontend", "tests"].map((item, index) => <div key={item} className={`px-2 py-1.5 text-2xs border-l-2 ${index === 1 ? "border-cb-accent bg-cb-accent-dim text-cb-fg-0" : "border-cb-line-1 text-cb-fg-3"}`}>● {item}</div>)}</div>
          <div className="flex-1 flex items-center justify-center"><div className="text-center"><TerminalSquare size={32} className="mx-auto text-cb-accent mb-3" /><div className="text-xs text-cb-fg-1">terminal ativo</div><div className="text-2xs text-cb-fg-3 mt-1">trabalho e comunicação no mesmo lugar</div></div></div>
        </div>
      </div>
    </div>
  );
}

function NavigationStep() {
  const items = [
    { icon: FolderGit2, title: "Trocar workspace", text: "Clique no nome do projeto no topo. Abertos e recentes aparecem em uma busca única." },
    { icon: Command, title: "Encontrar qualquer coisa", text: "Ctrl+K busca ações, painéis e configurações por nome ou sinônimo." },
    { icon: LayoutPanelLeft, title: "Conversar com agentes", text: "Passe sobre um agente no rail e abra a timeline durável pelo ícone de conversa." },
    { icon: Keyboard, title: "Atalhos essenciais", text: "Ctrl+O abre um workspace. Ctrl+T cria um pane. Ctrl+W fecha o pane ativo." },
  ];
  return <div><span className="cb-label text-cb-accent">orientação rápida</span><h2 className="text-xl font-semibold text-cb-fg-0 mt-2">Tudo importante em até dois cliques.</h2><div className="grid sm:grid-cols-2 gap-3 mt-5">{items.map(({ icon: Icon, title, text }) => <div key={title} className="border border-cb-line-1 bg-cb-bg-0 rounded-cb-1 p-4 flex gap-3"><div className="w-8 h-8 shrink-0 flex items-center justify-center bg-cb-accent-dim border border-cb-accent rounded-cb-1"><Icon size={15} className="text-cb-accent-bright" /></div><div><h3 className="text-xs font-semibold text-cb-fg-0">{title}</h3><p className="text-2xs text-cb-fg-3 leading-relaxed mt-1">{text}</p></div></div>)}</div><div className="mt-4 flex items-start gap-3 p-3 border border-cb-line-1 rounded-cb-1 bg-cb-bg-2"><Settings2 size={14} className="text-cb-fg-2 mt-0.5"/><p className="text-2xs text-cb-fg-2 leading-relaxed"><strong className="text-cb-fg-0">Prefere a interface clássica?</strong> Abra <em>Configurações → Laboratório</em> e desligue “Shell v2”. Há também um botão direto no fim deste tour.</p></div></div>;
}

function SpecKitStep() {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><span className="cb-label text-cb-accent">novidade principal</span><span className="px-1.5 py-0.5 text-[9px] uppercase border border-cb-warning text-cb-warning rounded-cb-1">experimental</span></div><h2 className="text-2xl font-semibold text-cb-fg-0 mt-2 flex items-center gap-2"><FileCode2 size={22} className="text-cb-accent" /> Spec Kit</h2><p className="text-sm text-cb-fg-2 mt-2">Transforme uma ideia vaga em implementação rastreável.</p></div>
        <div className="text-right text-2xs text-cb-fg-3"><div>salvo no próprio repositório</div><code className="text-cb-accent-bright">specs/001-minha-feature/</code></div>
      </div>
      <div className="flex flex-col md:flex-row gap-4 md:gap-5 mt-5">
        <FlowStep index={1} title="Especificar" command="specify" description="Problema, usuários, cenários e critérios de sucesso." />
        <FlowStep index={2} title="Planejar" command="plan" description="Arquitetura, dados, integrações, testes e rollback." />
        <FlowStep index={3} title="Decompor" command="tasks" description="Tarefas pequenas, ordenadas e verificáveis." />
        <FlowStep index={4} title="Implementar" command="implement" description="Execução guiada pelos requisitos versionados." />
      </div>
      <div className="grid sm:grid-cols-3 gap-px bg-cb-line-1 border border-cb-line-1 rounded-cb-1 overflow-hidden mt-5">
        {[{ icon: FileCode2, file: "spec.md", text: "o que e por quê" }, { icon: ListChecks, file: "plan.md", text: "como construir" }, { icon: Check, file: "tasks.md", text: "ordem de execução" }].map(({ icon: Icon, file, text }) => <div key={file} className="bg-cb-bg-0 p-3 flex items-center gap-3"><Icon size={14} className="text-cb-success"/><div><code className="text-xs text-cb-fg-0">{file}</code><div className="text-2xs text-cb-fg-3">{text}</div></div></div>)}
      </div>
      <p className="text-2xs text-cb-fg-3 mt-3 flex items-center gap-2"><MousePointerClick size={12}/> Abra com <strong className="text-cb-fg-1">Ctrl+K → Spec Kit</strong> ou use o botão abaixo. É necessário estar em um workspace.</p>
    </div>
  );
}

export function TerminalFirstOnboarding() {
  const visible = useOnboardingStore((state) => state.visible);
  const step = useOnboardingStore((state) => state.step);
  const setStep = useOnboardingStore((state) => state.setStep);
  const finish = useOnboardingStore((state) => state.finish);
  const tabs = useNavStore((state) => state.tabs);
  if (!visible) return null;

  const openSpecKit = () => {
    finish();
    if (tabs.length > 0) {
      const specStore = useSpecStore.getState();
      if (!specStore.visible) specStore.toggle();
    }
    else {
      useNavStore.getState().goHome();
      navigate("/workspaces");
    }
  };
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-cb-overlay" style={{ zIndex: "var(--cb-z-modal)" }} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="w-full max-w-[820px] bg-cb-bg-1 border border-cb-line-2 rounded-cb-2 shadow-2xl overflow-hidden">
        <header className="flex items-center gap-3 h-12 px-4 border-b border-cb-line-0"><div className="w-7 h-7 flex items-center justify-center bg-cb-accent text-cb-bg-0 rounded-cb-1"><Sparkles size={14}/></div><div className="flex-1"><div id="onboarding-title" className="text-xs font-semibold text-cb-fg-0">Bem-vindo ao novo Codebrain</div><div className="text-2xs text-cb-fg-3">tour de 1 minuto</div></div><button onClick={finish} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Fechar onboarding"><X size={14}/></button></header>
        <div className="flex border-b border-cb-line-0 px-4">{STEPS.map((label, index) => <button key={label} onClick={() => setStep(index)} className={`flex-1 py-2 text-2xs border-b ${step === index ? "text-cb-accent-bright border-cb-accent" : "text-cb-fg-3 border-transparent"}`}><span className="mr-1.5">0{index + 1}</span>{label}</button>)}</div>
        <main className="p-5 min-h-[390px]">{step === 0 ? <WelcomeStep /> : step === 1 ? <NavigationStep /> : <SpecKitStep />}</main>
        <footer className="min-h-14 px-4 py-3 border-t border-cb-line-0 flex flex-wrap items-center gap-2">
          <div className="flex-1" />
          {step > 0 && <button onClick={() => setStep(step - 1)} className="h-cell px-3 flex items-center gap-1 text-xs text-cb-fg-2 hover:text-cb-fg-0 border border-cb-line-1 rounded-cb-1"><ChevronLeft size={12}/> voltar</button>}
          {step < 2 ? <button onClick={() => setStep(step + 1)} className="h-cell px-4 flex items-center gap-1 bg-cb-accent text-cb-bg-0 text-xs font-semibold rounded-cb-1">continuar <ArrowRight size={12}/></button> : <><button onClick={finish} className="h-cell px-3 text-xs text-cb-fg-2 hover:text-cb-fg-0">concluir tour</button><button onClick={openSpecKit} className="h-cell px-4 flex items-center gap-2 bg-cb-accent text-cb-bg-0 text-xs font-semibold rounded-cb-1"><FileCode2 size={13}/> abrir Spec Kit</button></>}
        </footer>
      </div>
    </div>
  );
}
