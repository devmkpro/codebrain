import { useEffect, useState, useCallback } from "react";
import { useClarifyStore, type ClarifyRequest } from "../../stores/clarify-store";

// ── Inline Icons ───────────────────────────────────────────────────────────
const HelpCircle = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const X = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const Send = ({ size = 12, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

// ── Single Clarify Card ────────────────────────────────────────────────────

function ClarifyCard({ req, onDismiss }: {
  req: ClarifyRequest;
  onDismiss: (id: string) => void;
}) {
  const [customAnswer, setCustomAnswer] = useState("");
  const [sending, setSending] = useState(false);

  const sendAnswer = useCallback(async (answer: string) => {
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      await window.codeBrainApp.pty.write(req.paneId, answer.trim());
      onDismiss(req.id);
    } catch (err) {
      console.error("[ClarifyPrompt] Failed to send answer:", err);
    } finally {
      setSending(false);
    }
  }, [req.paneId, req.id, onDismiss, sending]);

  return (
    <div className="bg-[#0c0c14]/95 border border-amber-500/20 rounded-lg shadow-[0_0_24px_rgba(245,158,11,0.1)] backdrop-blur-md overflow-hidden w-[340px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/10 bg-amber-500/5">
        <div className="flex items-center gap-1.5">
          <HelpCircle size={12} className="text-amber-400" />
          <span className="font-mono text-[9px] font-bold text-amber-400 uppercase tracking-wider">
            Clarification Needed
          </span>
          <span className="font-mono text-[8px] text-gray-600">
            {req.paneId.slice(0, 8)}
          </span>
        </div>
        <button onClick={() => onDismiss(req.id)} className="text-gray-600 hover:text-red-400 cursor-pointer">
          <X />
        </button>
      </div>

      {/* Question */}
      <div className="px-3 py-2">
        <p className="font-mono text-[11px] text-white leading-relaxed">
          {req.question}
        </p>
      </div>

      {/* Suggestions */}
      {req.suggestions.length > 0 && (
        <div className="px-3 pb-2 space-y-1">
          <p className="font-mono text-[8px] text-gray-600 uppercase tracking-wider">Suggestions</p>
          <div className="flex flex-wrap gap-1.5">
            {req.suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendAnswer(s)}
                disabled={sending}
                className="font-mono text-[10px] text-indigo-300 bg-indigo-500/15 border border-indigo-500/25 rounded px-2 py-1 hover:bg-indigo-500/25 hover:text-indigo-200 disabled:opacity-40 cursor-pointer transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom answer */}
      <div className="px-3 pb-2">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendAnswer(customAnswer); }}
            placeholder="Type custom answer..."
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 font-mono text-[10px] text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/40"
          />
          <button
            onClick={() => sendAnswer(customAnswer)}
            disabled={sending || !customAnswer.trim()}
            className="text-gray-500 hover:text-amber-400 disabled:opacity-30 cursor-pointer"
          >
            <Send />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ClarifyPrompt (floating overlay) ───────────────────────────────────────

export function ClarifyPrompt() {
  const requests = useClarifyStore((s) => s.requests);
  const addRequest = useClarifyStore((s) => s.addRequest);
  const dismiss = useClarifyStore((s) => s.dismiss);

  // Listen for clarify:request IPC events from main process
  useEffect(() => {
    const api = window.codeBrainApp as any;
    if (!api?.electron?.ipcRenderer) return;

    const handler = (_evt: unknown, payload: { paneId: string; question: string; suggestions: string[] }) => {
      if (payload?.paneId && payload?.question) {
        addRequest({
          paneId: payload.paneId,
          question: payload.question,
          suggestions: payload.suggestions || [],
        });
      }
    };

    api.electron.ipcRenderer.on("clarify:request", handler);
    return () => {
      api.electron.ipcRenderer.off("clarify:request", handler);
    };
  }, [addRequest]);

  if (requests.length === 0) return null;

  return (
    <div className="fixed bottom-16 right-4 z-[9998] flex flex-col gap-2 pointer-events-auto">
      {requests.map((req) => (
        <ClarifyCard key={req.id} req={req} onDismiss={dismiss} />
      ))}
    </div>
  );
}
