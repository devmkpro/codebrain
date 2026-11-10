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
  X,
} from "lucide-react";
import { navigate } from "../../lib/router";
import { useNavStore } from "../../stores/nav-store";
import { useOnboardingStore } from "../../stores/onboarding-store";
import { useSpecStore } from "../../stores/spec-store";
import { CodebrainMark, CodebrainWordmark } from "../ui/AppLogo";
import { Badge, Button, Prompt } from "../ui/primitives";
import { HarnessDetection } from "./HarnessDetection";

const STEPS = ["terminal-first", "navegação", "spec kit"];

function FlowStep({
  index,
  title,
  command,
  description,
}: {
  index: number;
  title: string;
  command: string;
  description: string;
}) {
  return (
    <li
      className="min-w-0 cb-rail"
      style={{ "--cb-rail-color": "var(--cb-accent)" } as React.CSSProperties}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-cb-accent tabular-nums">0{index}</span>
        <span className="text-base font-medium text-cb-fg-0">{title}</span>
      </div>
      <code className="block text-sm text-cb-accent mt-1">/{command}</code>
      <p className="text-sm leading-relaxed text-cb-fg-2 mt-1">{description}</p>
    </li>
  );
}

function WelcomeStep() {
  return (
    <div className="grid md:grid-cols-[1.05fr_.95fr] gap-6 items-stretch">
      <div>
        <h2 className="text-2xl font-bold text-cb-fg-0 leading-tight">
          O Codebrain agora é<br />
          <span className="text-cb-accent">terminal-first.</span>
        </h2>
        <p className="text-base text-cb-fg-1 leading-relaxed mt-4 max-w-md">
          Menos ícones escondidos, mais contexto. Workspaces, agentes e ações ficam visíveis no
          mesmo fluxo, sem tirar o terminal do centro.
        </p>
        <ul className="mt-5 space-y-2">
          {[
            "Clique no workspace no topo para trocar de projeto",
            "Use Ctrl+K para encontrar qualquer ação",
            "Acompanhe todos os agentes no rail lateral",
          ].map((text) => (
            <li key={text} className="flex items-start gap-2 text-sm text-cb-fg-1">
              <Check size={13} className="text-cb-success shrink-0 mt-0.5" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div
        className="border border-cb-line-1 bg-cb-bg-inset rounded-cb-1 flex flex-col overflow-hidden"
        aria-hidden
      >
        <div className="h-cell-lg px-3 border-b border-cb-line-0 flex items-center gap-2 text-sm text-cb-fg-1">
          <Prompt>meu-workspace</Prompt>
          <span className="ml-auto cb-kbd">Ctrl K</span>
        </div>
        <div className="flex flex-1 min-h-[190px]">
          <div className="w-32 shrink-0 border-r border-cb-line-0 py-2">
            <div className="cb-label px-3 mb-1">agentes · 3</div>
            {[
              ["orchestrator", "var(--cb-agent-thinking)"],
              ["frontend", "var(--cb-agent-running)"],
              ["tests", "var(--cb-agent-idle)"],
            ].map(([item, color]) => (
              <div
                key={item}
                className="cb-rail ml-1 min-h-cell flex items-center text-sm text-cb-fg-1 truncate"
                style={{ "--cb-rail-color": color } as React.CSSProperties}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="flex-1 flex items-center justify-center p-3">
            <div className="text-center">
              <CodebrainMark size={36} className="mx-auto mb-3" />
              <div className="text-sm text-cb-fg-0">terminal ativo</div>
              <div className="text-xs text-cb-fg-2 mt-1">trabalho e conversa no mesmo lugar</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavigationStep() {
  const items = [
    {
      icon: FolderGit2,
      title: "Trocar workspace",
      text: "Clique no nome do projeto no topo. Abertos e recentes aparecem em uma busca única.",
    },
    {
      icon: Command,
      title: "Encontrar qualquer coisa",
      text: "Ctrl+K busca ações, painéis e configurações por nome ou sinônimo.",
    },
    {
      icon: LayoutPanelLeft,
      title: "Conversar com agentes",
      text: "Passe sobre um agente no rail e abra a timeline durável pelo ícone de conversa.",
    },
    {
      icon: Keyboard,
      title: "Atalhos essenciais",
      text: "Ctrl+O abre um workspace. Ctrl+T cria um pane. Ctrl+W fecha o pane ativo.",
    },
  ];
  return (
    <div>
      <h2 className="text-xl font-bold text-cb-fg-0">Tudo importante em até dois cliques.</h2>
      <div className="grid sm:grid-cols-2 gap-x-7 gap-y-5 mt-5">
        {items.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3">
            <Icon size={16} className="text-cb-accent shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-medium text-cb-fg-0">{title}</h3>
              <p className="text-sm text-cb-fg-2 leading-relaxed mt-1">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpecKitStep() {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-cb-fg-0">Spec Kit</h2>
            <Badge tone="warn">experimental</Badge>
          </div>
          <p className="text-base text-cb-fg-1 mt-2">
            Transforme uma ideia vaga em implementação rastreável.
          </p>
        </div>
        <div className="text-right text-sm text-cb-fg-2">
          <div>salvo no próprio repositório</div>
          <code className="text-cb-accent">specs/001-minha-feature/</code>
        </div>
      </div>
      <ol className="grid sm:grid-cols-2 md:grid-cols-4 gap-5 mt-6">
        <FlowStep
          index={1}
          title="Especificar"
          command="specify"
          description="Problema, usuários, cenários e critérios de sucesso."
        />
        <FlowStep
          index={2}
          title="Planejar"
          command="plan"
          description="Arquitetura, dados, integrações, testes e rollback."
        />
        <FlowStep
          index={3}
          title="Decompor"
          command="tasks"
          description="Tarefas pequenas, ordenadas e verificáveis."
        />
        <FlowStep
          index={4}
          title="Implementar"
          command="implement"
          description="Execução guiada pelos requisitos versionados."
        />
      </ol>
      <div className="grid sm:grid-cols-3 gap-px bg-cb-line-1 border border-cb-line-1 rounded-cb-1 overflow-hidden mt-6">
        {[
          { icon: FileCode2, file: "spec.md", text: "o que e por quê" },
          { icon: ListChecks, file: "plan.md", text: "como construir" },
          { icon: Check, file: "tasks.md", text: "ordem de execução" },
        ].map(({ icon: Icon, file, text }) => (
          <div key={file} className="bg-cb-bg-inset p-3 flex items-center gap-3">
            <Icon size={14} className="text-cb-fg-2 shrink-0" />
            <div>
              <code className="text-sm text-cb-fg-0">{file}</code>
              <div className="text-xs text-cb-fg-2">{text}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-cb-fg-2 mt-4 flex items-center gap-2">
        <MousePointerClick size={13} className="shrink-0" />
        <span>
          Abra com <strong className="text-cb-fg-0 font-medium">Ctrl+K → Spec Kit</strong> ou use o
          botão abaixo. É necessário estar em um workspace.
        </span>
      </p>
    </div>
  );
}

export function TerminalFirstOnboarding() {
  const visible = useOnboardingStore((state) => state.visible);
  const step = useOnboardingStore((state) => state.step);
  const setStep = useOnboardingStore((state) => state.setStep);
  const finish = useOnboardingStore((state) => state.finish);
  const tabs = useNavStore((state: any) => state.tabs) as { workspacePath: string }[];
  if (!visible) return null;

  const openSpecKit = () => {
    finish();
    if (tabs.length > 0) {
      const specStore = useSpecStore.getState();
      if (!specStore.visible) specStore.toggle();
    } else {
      (useNavStore.getState() as { goHome: () => void }).goHome();
      navigate("/workspaces");
    }
  };
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-cb-scrim"
      style={{ zIndex: "var(--cb-z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="w-full max-w-[820px] max-h-full flex flex-col bg-cb-overlay border border-cb-line-2 rounded-cb-2 shadow-cb-modal overflow-hidden">
        <header className="flex items-center gap-3 h-11 px-4 border-b border-cb-line-0 shrink-0">
          <CodebrainMark size={20} />
          <div id="onboarding-title" className="flex-1 min-w-0 text-base truncate">
            <CodebrainWordmark />
            <span className="text-cb-fg-2"> · tour de 1 minuto</span>
          </div>
          <button
            type="button"
            onClick={finish}
            className="cb-btn cb-btn--ghost cb-btn--sm cb-btn--icon"
            aria-label="Fechar onboarding"
          >
            <X size={14} />
          </button>
        </header>
        <div
          className="flex gap-5 px-4 border-b border-cb-line-1 shrink-0 overflow-x-auto"
          role="tablist"
          aria-label="Etapas do tour"
        >
          {STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={step === index}
              onClick={() => setStep(index)}
              className="cb-tab whitespace-nowrap"
            >
              <span className="text-cb-accent tabular-nums">0{index + 1}</span>
              {label}
            </button>
          ))}
        </div>
        <HarnessDetection />
        <main className="cb-scroll flex-1 min-h-0 p-6">
          {step === 0 ? <WelcomeStep /> : step === 1 ? <NavigationStep /> : <SpecKitStep />}
        </main>
        <footer className="shrink-0 px-4 py-3 border-t border-cb-line-0 flex flex-wrap items-center justify-end gap-2">
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)}>
              <ChevronLeft size={13} /> voltar
            </Button>
          )}
          {step < 2 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              continuar <ArrowRight size={13} />
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={finish}>
                concluir tour
              </Button>
              <Button variant="primary" onClick={openSpecKit}>
                <FileCode2 size={13} /> abrir Spec Kit
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
