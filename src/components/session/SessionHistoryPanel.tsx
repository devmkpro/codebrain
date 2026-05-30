import React from "react";
import { History, X, Trash2, Clock, Cpu, Terminal, Download, FileJson, FileText } from "lucide-react";
import { useSessionHistoryStore } from "../../stores/session-history-store";
import type { SessionHistoryEntry } from "../../types/electron";

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function PreviewModal({ session, onClose }: { session: SessionHistoryEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0c0c14] border border-white/10 rounded-lg w-[600px] max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-violet-400" />
            <span className="font-mono text-[12px] font-bold text-white">{session.label || session.agent || "Session"}</span>
            <span className="font-mono text-[10px] text-gray-500">{session.model}</span>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white cursor-pointer transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex gap-4 mb-3 font-mono text-[10px] text-gray-500">
            <span>Início: {formatTime(session.started_at)}</span>
            <span>Fim: {formatTime(session.ended_at)}</span>
            <span>Duração: {formatDuration(session.duration_ms)}</span>
            <span>Exit: {session.exit_code ?? "—"}</span>
          </div>
          <pre className="bg-black/40 rounded p-3 font-mono text-[11px] text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-[50vh] leading-relaxed">
            {session.output_preview || "(sem output)"}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function SessionHistoryPanel() {
  const visible = useSessionHistoryStore((s) => s.visible);
  const sessions = useSessionHistoryStore((s) => s.sessions);
  const loading = useSessionHistoryStore((s) => s.loading);
  const toggle = useSessionHistoryStore((s) => s.toggle);
  const deleteOne = useSessionHistoryStore((s) => s.deleteOne);
  const [previewSession, setPreviewSession] = React.useState<SessionHistoryEntry | null>(null);

  if (!visible) return null;

  // Group sessions by date
  const grouped = new Map<string, SessionHistoryEntry[]>();
  for (const s of sessions) {
    const key = formatDate(s.ended_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  return (
    <>
      <div className="absolute right-0 top-0 bottom-0 z-20 w-80 bg-black border-l border-white/10 flex flex-col shadow-2xl" style={{ WebkitAppRegion: "no-drag" }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-1.5">
            <History size={13} strokeWidth={1.5} className="text-emerald-500/70" />
            <p className="font-mono text-[10px] font-bold text-white tracking-widest uppercase">Histórico</p>
            {sessions.length > 0 && (
              <span className="font-mono text-[9px] text-gray-600">{sessions.length}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={async () => {
                try {
                  await window.codeBrainApp.session.export({ format: "markdown", includeAll: true });
                } catch {}
              }}
              className="text-gray-600 hover:text-emerald-400 cursor-pointer transition-colors p-1"
              title="Exportar todos (MD)"
            >
              <Download size={12} strokeWidth={1.5} />
            </button>
            <button onClick={toggle} className="text-gray-600 hover:text-red-500 cursor-pointer transition-colors">
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-3 py-6 text-center">
              <p className="font-mono text-[10px] text-gray-600 animate-pulse">Carregando...</p>
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="font-mono text-[10px] text-gray-700 leading-relaxed">
                Nenhuma sessão registrada.
                <br />
                Histórico é salvo automaticamente
                <br />
                quando um terminal é fechado.
              </p>
            </div>
          )}

          {!loading &&
            Array.from(grouped.entries()).map(([date, items]) => (
              <div key={date}>
                <div className="px-3 py-1.5 bg-white/[0.02] border-b border-white/5">
                  <span className="font-mono text-[9px] font-bold text-gray-500 uppercase tracking-wider">{date}</span>
                </div>
                {items.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-start gap-2 px-3 py-2 border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition-colors group"
                    onClick={() => setPreviewSession(session)}
                  >
                    <Terminal size={12} strokeWidth={1.5} className="text-violet-400/50 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-mono text-[11px] text-white truncate">{session.label || session.agent || "unknown"}</p>
                        {session.exit_code !== undefined && session.exit_code !== 0 && (
                          <span className="font-mono text-[8px] text-red-400 bg-red-500/10 px-1 rounded">exit {session.exit_code}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {session.model && (
                          <span className="font-mono text-[9px] text-gray-500 flex items-center gap-0.5">
                            <Cpu size={8} /> {session.model}
                          </span>
                        )}
                        <span className="font-mono text-[9px] text-gray-600 flex items-center gap-0.5">
                          <Clock size={8} /> {formatTime(session.ended_at)} · {formatDuration(session.duration_ms)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteOne(session.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 cursor-pointer transition-all mt-0.5"
                      title="Deletar"
                    >
                      <Trash2 size={11} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>

      {previewSession && <PreviewModal session={previewSession} onClose={() => setPreviewSession(null)} />}
    </>
  );
}
