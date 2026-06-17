/**
 * CloseMissionDialog — Confirmação de fechamento (arquivamento) de missão.
 * Cores do Codebrain: bg-[#0c0c14], indigo accents, slate text.
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
        className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#0c0c14] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Fechar missão?
          </p>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Description */}
        <div className="border-b border-white/[0.06] px-4 py-3">
          <p className="font-mono text-[10px] leading-relaxed text-slate-500">
            Isso arquiva <span className="text-slate-300">{mission.title}</span> neste workspace
            {paneCount > 0
              ? ` e encerra ${paneCount} pane${paneCount === 1 ? '' : 's'} dessa missão.`
              : '.'}
          </p>
        </div>

        {/* Info Grid */}
        <div className="space-y-2 border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Missão</span>
            <span className="font-mono text-[11px] text-slate-300">{mission.title}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Panes</span>
            <span className="font-mono text-[11px] text-slate-300">{paneCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Workspace</span>
            <span className="font-mono text-[10px] text-slate-500 truncate max-w-[220px]" title={workspacePath}>
              {basename(workspacePath)}
            </span>
          </div>
          {mission.mode && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">Modo</span>
              <span className="font-mono text-[11px] text-slate-300">
                {mission.mode === 'squad' ? 'Squad' : 'Livre'}
              </span>
            </div>
          )}
        </div>

        {/* Note */}
        <div className="px-4 py-3">
          <p className="font-mono text-[9px] leading-relaxed text-slate-600">
            Arquivos, branch e worktree no disco não serão apagados. A missão sai do seletor ativo e fica arquivada no estado local do Codebrain.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/[0.08] px-4 py-1.5 font-mono text-[11px] text-slate-500 hover:text-slate-300 hover:border-white/[0.15] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-[#4F46E5] px-4 py-1.5 font-mono text-[11px] font-bold text-white hover:bg-[#4338CA] transition-colors"
          >
            Fechar missão
          </button>
        </div>
      </div>
    </div>
  );
}
