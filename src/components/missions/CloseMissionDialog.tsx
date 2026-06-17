/**
 * CloseMissionDialog — Confirmação de fechamento (arquivamento) de missão.
 * Estilo Overclock: título bold, info grid, nota sobre persistência no disco.
 */
import React from 'react';
import { X } from 'lucide-react';
import type { Mission } from '../../stores/missions-store';

interface CloseMissionDialogProps {
  open: boolean;
  mission: Mission | null;
  paneCount: number;
  workspacePath: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function CloseMissionDialog({ open, mission, paneCount, workspacePath, onClose, onConfirm }: CloseMissionDialogProps) {
  if (!open || !mission) return null;

  function basename(p: string): string {
    return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#141414] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-100">
            Fechar missão?
          </p>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Description */}
        <div className="border-b border-white/5 px-4 py-3">
          <p className="font-mono text-[10px] leading-relaxed text-gray-500">
            Isso arquiva <span className="text-gray-300">{mission.title}</span> neste workspace
            {paneCount > 0
              ? ` e encerra ${paneCount} pane${paneCount === 1 ? '' : 's'} dessa missão.`
              : '.'}
          </p>
        </div>

        {/* Info Grid */}
        <div className="space-y-2 border-b border-white/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Missão</span>
            <span className="font-mono text-[11px] text-gray-200">{mission.title}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Panes</span>
            <span className="font-mono text-[11px] text-gray-200">{paneCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Workspace</span>
            <span className="font-mono text-[10px] text-gray-400 truncate max-w-[220px]" title={workspacePath}>
              {basename(workspacePath)}
            </span>
          </div>
          {mission.mode && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500">Modo</span>
              <span className="font-mono text-[11px] text-gray-200">
                {mission.mode === 'squad' ? 'Squad' : 'Livre'}
              </span>
            </div>
          )}
        </div>

        {/* Note */}
        <div className="px-4 py-3">
          <p className="font-mono text-[9px] leading-relaxed text-gray-600">
            Arquivos, branch e worktree no disco não serão apagados. A missão sai do seletor ativo e fica arquivada no estado local do Codebrain.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-1.5 font-mono text-[11px] text-gray-400 hover:text-gray-200 hover:border-white/20 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-500/15 border border-red-500/30 px-4 py-1.5 font-mono text-[11px] font-bold text-red-400 hover:bg-red-500/25 transition-colors"
          >
            Fechar missão
          </button>
        </div>
      </div>
    </div>
  );
}
