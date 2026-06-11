import React from "react";
import { useMrReviewStore } from "../../stores/mr-review-store";

export function MrFixModal() {
  const showFixModal = useMrReviewStore(s => s.showFixModal);
  const pendingFindings = useMrReviewStore(s => s.pendingFindings);
  const fixing = useMrReviewStore(s => s.fixing);
  const dismissFindings = useMrReviewStore(s => s.dismissFindings);
  const applyFixes = useMrReviewStore(s => s.applyFixes);

  if (!showFixModal || !pendingFindings) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={dismissFindings}
      />
      {/* Modal */}
      <div className="relative w-full max-w-xl mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700 bg-zinc-800/80">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-lg">{"⚠️"}</span>
            <h2 className="text-sm font-semibold text-zinc-100">
              Review Findings — MR !{pendingFindings.mrId}
            </h2>
          </div>
          <button
            onClick={dismissFindings}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-1"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* MR Info */}
        <div className="px-5 py-2 border-b border-zinc-800 text-xs text-zinc-400">
          <span className="text-zinc-300 font-medium">{pendingFindings.title}</span>
          <span className="mx-2">|</span>
          <span>{pendingFindings.sourceBranch} {"→"} {pendingFindings.targetBranch}</span>
        </div>

        {/* Findings list */}
        <div className="px-5 py-3 max-h-72 overflow-y-auto">
          <p className="text-xs text-zinc-500 mb-2">
            {pendingFindings.findings.length} finding{pendingFindings.findings.length !== 1 ? "s" : ""} detected:
          </p>
          <ul className="space-y-1.5">
            {pendingFindings.findings.map((f, i) => (
              <li
                key={i}
                className="text-sm text-zinc-300 bg-zinc-800/50 rounded px-3 py-1.5 border border-zinc-700/50"
              >
                <span className="text-zinc-500 mr-2 font-mono text-xs">{i + 1}.</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-zinc-700 bg-zinc-800/50">
          <button
            onClick={dismissFindings}
            className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 rounded border border-zinc-600 hover:border-zinc-500 transition-colors"
          >
            Ignorar
          </button>
          <button
            onClick={applyFixes}
            disabled={fixing}
            className="px-4 py-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:text-zinc-400 rounded transition-colors flex items-center gap-2"
          >
            {fixing ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Corrigindo...
              </>
            ) : (
              "Corrigir Automaticamente"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
