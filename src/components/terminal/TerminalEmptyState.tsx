import React from "react";
import { MissionWizard } from "../missions/MissionWizard";
import { usePaneLauncherStore } from "../../stores/pane-launcher-store";
import "../../styles/terminal.css";

/**
 * Workspace sem terminais. Em vez de um cartão com ícone, é o próprio prompt
 * esperando comando: as duas saídas possíveis aparecem como linhas de menu.
 */
export function TerminalEmptyState({ workspacePath }: { workspacePath: string }) {
  const openLauncher = usePaneLauncherStore((state) => state.show);
  const [wizardOpen, setWizardOpen] = React.useState(false);

  return (
    <div className="cb-terminal-empty">
      <div className="cb-terminal-empty-box">
        <div className="cb-terminal-empty-title">
          <span aria-hidden>❯</span>
          <span>nenhum terminal aberto</span>
          <span className="cb-terminal-empty-cursor" aria-hidden />
        </div>
        <p>Abra um terminal para um agente só, ou crie uma missão com piloto e ajudantes.</p>
        <div className="cb-terminal-empty-actions">
          <button type="button" className="cb-terminal-empty-action" onClick={() => openLauncher()}>
            <span aria-hidden>❯</span>
            <span>novo terminal</span>
            <kbd className="cb-kbd">Ctrl T</kbd>
          </button>
          <button type="button" className="cb-terminal-empty-action" onClick={() => setWizardOpen(true)}>
            <span aria-hidden>❯</span>
            <span>nova missão</span>
          </button>
        </div>
      </div>
      <MissionWizard open={wizardOpen} onClose={() => setWizardOpen(false)} workspacePath={workspacePath} />
    </div>
  );
}
