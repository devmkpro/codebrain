import React from "react";
import { navigate, useRouter } from "../../lib/router";
import { useNavStore } from "../../stores/nav-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import "../../components/central/central.css";
import { AccountsSection } from "../../components/central/AccountsSection";
import { AccessVaultSection } from "../../components/central/AccessVaultSection";
import { central, useResource } from "../../components/central/api";
import { CatalogSection } from "../../components/central/CatalogSection";
import { FindingsSection } from "../../components/central/FindingsSection";
import { HarnessSection } from "../../components/central/HarnessSection";
import { basename } from "../../components/central/logic";
import { MediaSection } from "../../components/central/MediaSection";
import { MissionSection } from "../../components/central/MissionSection";
import { Prompt, Select } from "../../components/central/primitives";
import type { SectionId } from "../../components/central/types";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "missao", label: "Missão" },
  { id: "tarefas", label: "Quem faz cada tarefa" },
  { id: "catalogo", label: "Agentes e skills" },
  { id: "contas", label: "Contas e limites" },
  { id: "findings", label: "Findings" },
  { id: "midia", label: "Mídia" },
  { id: "acessos", label: "SSH e máquinas" },
];

function isSectionId(value: string | undefined): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function useWorkspaces() {
  const tabs = useNavStore((state: any) => state.tabs) as { workspacePath: string }[];
  const activeIndex = useNavStore((state: any) => state.activeTabIndex) as number;
  const current = useWorkspaceStore((state: any) => state.path) as string | null;
  const paths = React.useMemo(
    () => [...new Set([...tabs.map((tab) => tab.workspacePath), ...(current ? [current] : [])])],
    [tabs, current]
  );
  const preferred = tabs[activeIndex]?.workspacePath ?? current ?? null;
  const [chosen, setChosen] = React.useState<string | null>(null);
  // Trocar de aba fora da Central volta a seguir a aba ativa.
  React.useEffect(() => setChosen(null), [preferred]);
  const workspace = chosen && paths.includes(chosen) ? chosen : preferred;
  return { workspace, paths, setChosen };
}

export function CentralPage() {
  const { query } = useRouter();
  const section: SectionId = isSectionId(query.s) ? query.s : "missao";
  const { workspace, paths, setChosen } = useWorkspaces();
  const tabRefs = React.useRef(new Map<SectionId, HTMLButtonElement>());
  const rootRef = React.useRef<HTMLDivElement>(null);

  const stats = useResource<Record<string, number>>(
    async () => (workspace ? central.findings.stats(workspace) : {}),
    [workspace],
    15000
  );
  const openFindings = (stats.data?.open ?? 0) + (stats.data?.reopened ?? 0);

  // Na faixa horizontal de janela estreita, a seção ativa pode estar fora da vista.
  React.useEffect(() => {
    tabRefs.current.get(section)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);

  const go = React.useCallback(
    (id: SectionId, focus = false) => {
      navigate("/central", {
        query: { ...(id === "missao" && query.mission ? { mission: query.mission } : {}), s: id },
        replace: true,
      });
      if (focus) tabRefs.current.get(id)?.focus();
    },
    [query.mission]
  );

  const onTabKey = (event: React.KeyboardEvent) => {
    const index = SECTIONS.findIndex((item) => item.id === section);
    const move: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: SECTIONS.length - 1,
    };
    if (!(event.key in move)) return;
    event.preventDefault();
    go(SECTIONS[(move[event.key] + SECTIONS.length) % SECTIONS.length].id, true);
  };

  // 1 a 7 trocam de seção de qualquer ponto da página, fora de campos de texto.
  const onPageKey = (event: React.KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
    const target = SECTIONS[Number(event.key) - 1];
    if (target) go(target.id, true);
  };

  return (
    <div className="cb-central" ref={rootRef} onKeyDown={onPageKey}>
      <div className="cbc-layout">
        <nav className="cbc-nav" aria-label="Seções da Central">
          <div className="cbc-nav-brand">
            <Prompt /> Central
          </div>
          <div className="cbc-tabs" role="tablist" aria-orientation="vertical" onKeyDown={onTabKey}>
            {SECTIONS.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  if (element) tabRefs.current.set(item.id, element);
                  else tabRefs.current.delete(item.id);
                }}
                id={`central-tab-${item.id}`}
                type="button"
                role="tab"
                className="cbc-tab"
                aria-selected={section === item.id}
                aria-controls="central-panel"
                tabIndex={section === item.id ? 0 : -1}
                onClick={() => go(item.id)}
              >
                <span className="cbc-tab-key" aria-hidden>
                  {index + 1}
                </span>
                <span className="flex-1 min-w-0">{item.label}</span>
                {item.id === "findings" && openFindings > 0 && (
                  <span
                    className="text-2xs text-cb-danger"
                    aria-label={`${openFindings} em aberto`}
                  >
                    {openFindings}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="cbc-nav-foot">
            {paths.length > 1 && workspace ? (
              <Select
                aria-label="Workspace"
                value={workspace}
                onChange={setChosen}
                options={paths.map((path) => ({ value: path, label: basename(path) }))}
              />
            ) : (
              <span className="cbc-cut text-xs text-cb-fg-1" title={workspace ?? undefined}>
                {workspace ? basename(workspace) : "sem workspace"}
              </span>
            )}
            <span className="cbc-nav-hint">teclas 1 a 7 trocam de seção</span>
          </div>
        </nav>

        <main
          id="central-panel"
          role="tabpanel"
          aria-labelledby={`central-tab-${section}`}
          className="cbc-main"
          tabIndex={-1}
        >
          {section === "missao" && <MissionSection key={workspace} workspace={workspace} />}
          {section === "tarefas" && <HarnessSection key={workspace} workspace={workspace} />}
          {section === "catalogo" && <CatalogSection key={workspace} workspace={workspace} />}
          {section === "contas" && <AccountsSection key={workspace} workspace={workspace} />}
          {section === "findings" && (
            <FindingsSection key={workspace} workspace={workspace} onChanged={stats.reload} />
          )}
          {section === "midia" && <MediaSection key={workspace} workspace={workspace} />}
          {section === "acessos" && <AccessVaultSection />}
        </main>
      </div>
    </div>
  );
}
