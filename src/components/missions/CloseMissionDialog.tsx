/**
 * CloseMissionDialog — confirmação de fechamento (arquivamento) de missão.
 */
import React from 'react';
import { X } from 'lucide-react';
import { MISSION_MODE_LABEL, type Mission } from '../../stores/missions-store';
import '../central/central.css';

interface CloseMissionDialogProps {
  open: boolean;
  mission: Mission | null;
  paneCount: number;
  workspacePath: string;
  onClose: () => void;
  onConfirm: () => void;
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-cell">
      <span className="text-xs text-cb-fg-2">{label}</span>
      <span className="text-xs text-cb-fg-0 truncate">{children}</span>
    </div>
  );
}

export function CloseMissionDialog({ open, mission, paneCount, workspacePath, onClose, onConfirm }: CloseMissionDialogProps) {
  if (!open || !mission) return null;

  return (
    <div className="cbm-scrim" onClick={onClose}>
      <div className="cbm-dialog" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-label="Fechar missão" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between h-cell-lg px-4 border-b border-cb-line-0">
          <span className="text-sm font-bold text-cb-fg-0">
            <span className="cbc-prompt" aria-hidden>❯</span> Fechar missão?
          </span>
          <button type="button" onClick={onClose} className="text-cb-fg-2 hover:text-cb-fg-0" aria-label="Fechar">
            <X size={14} />
          </button>
        </div>

        <p className="px-4 py-3 text-xs text-cb-fg-1 border-b border-cb-line-0">
          Isso arquiva <span className="text-cb-fg-0">{mission.title}</span> neste workspace
          {paneCount > 0 ? ` e encerra ${paneCount} terminal${paneCount === 1 ? '' : 'is'} dessa missão.` : '.'}
        </p>

        <div className="px-4 py-2 border-b border-cb-line-0">
          <Row label="Terminais">{paneCount}</Row>
          <Row label="Workspace">{basename(workspacePath)}</Row>
          {mission.mode && <Row label="Modo">{MISSION_MODE_LABEL[mission.mode]}</Row>}
        </div>

        <p className="px-4 py-3 text-2xs text-cb-fg-2">
          Arquivos, branch e worktree no disco não são apagados. A missão só sai da lista ativa.
        </p>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-cb-line-0">
          <button type="button" className="cbc-btn" onClick={onClose}>cancelar</button>
          <button type="button" className="cbc-btn" data-tone="danger" onClick={onConfirm}>fechar missão</button>
        </div>
      </div>
    </div>
  );
}
