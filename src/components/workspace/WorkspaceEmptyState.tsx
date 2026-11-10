import { ArrowUpRight, Command, Plus, SquareTerminal, Users } from "lucide-react";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import { useModalsStore } from "../../stores/modals-store";
import { useProvidersStore } from "../../stores/providers-store";
import { CLAUDE_CODEX_PRESET, resolveSquadPreset } from "../../lib/squad-presets";
import { useNavStore } from "../../stores/nav-store";
import "./workspace-empty-state.css";

export function WorkspaceEmptyState() {
  const openPaneLauncher = usePaneLauncherStore(state => state.show);
  const openSquadWizardWithPreset = useModalsStore(state => state.openSquadWizardWithPreset);
  const openProviders = useModalsStore(state => state.openProviders);
  const providers = useProvidersStore((state: any) => state.providers) as any[];
  const workspace = useNavStore((state: any) => state.tabs[state.activeTabIndex]?.workspacePath) as string | undefined;
  const projectName = workspace?.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  const available = providers.filter((provider) => provider.models?.length).length;

  const openTeam = () => {
    const preset = resolveSquadPreset(CLAUDE_CODEX_PRESET, providers ?? []);
    // No provider has models yet — a pre-filled wizard would be unusable, so
    // send the user where they can fix it instead.
    if (!preset) {
      openProviders("list");
      return;
    }
    openSquadWizardWithPreset(preset);
  };

  return (
    <section className="workspace-start cb-scroll" aria-labelledby="workspace-start-title">
      <div className="workspace-start__content">
        <header className="workspace-start__heading">
          <div className="workspace-start__eyebrow"><span aria-hidden="true">❯</span>{projectName || "Seu workspace"}<span className="workspace-start__divider" aria-hidden="true">/</span><span>comece aqui</span></div>
          <h1 id="workspace-start-title">O que vamos fazer<br />neste projeto?</h1>
          <p>Da primeira ideia à última revisão.<br className="workspace-start__desktop-break" /> Escolha como quer trabalhar.</p>
        </header>

        <div className="workspace-start__actions">
          <article className="workspace-start__solo">
            <div className="workspace-start__action-top"><SquareTerminal size={23} strokeWidth={1.5} aria-hidden="true" /><span>01 / foco</span></div>
            <h2>Uma tarefa.<br />Um agente.</h2>
            <p>Converse, implemente ou investigue. Escolha o agente e o modelo para o seu próximo passo.</p>
            <button className="workspace-start__primary" type="button" aria-label="Abrir pane de agente" onClick={() => openPaneLauncher()}><Plus size={16} aria-hidden="true" />Iniciar um agente<ArrowUpRight size={17} aria-hidden="true" /></button>
          </article>
          <article className="workspace-start__team">
            <div className="workspace-start__action-top"><Users size={23} strokeWidth={1.5} aria-hidden="true" /><span>02 / colaboração</span></div>
            <h2>Um objetivo.<br />Várias perspectivas.</h2>
            <p>Um agente coordena. Outros executam e revisam em paralelo. Você acompanha tudo no mesmo lugar.</p>
            <button className="workspace-start__secondary" type="button" onClick={openTeam}>Montar um time<ArrowUpRight size={17} aria-hidden="true" /></button>
          </article>
        </div>

        <footer className="workspace-start__footer">
          <span className="workspace-start__shortcut"><Command size={13} aria-hidden="true" />Abra um agente com <kbd className="cb-kbd">Ctrl T</kbd></span>
          <button type="button" onClick={() => openProviders("list")}>{available ? `${available} ${available === 1 ? "provedor disponível" : "provedores disponíveis"}` : "Configurar provedores"}<ArrowUpRight size={13} aria-hidden="true" /></button>
        </footer>
      </div>
    </section>
  );
}
