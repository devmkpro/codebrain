import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, Send, X } from "lucide-react";
import { useConversationStore } from "../../stores/conversation-store";
import { usePanesStore } from "../../stores/panes-store";

function timeLabel(timestamp: number): string {
  const millis = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(millis);
}

export function ConversationPanel() {
  const { open, paneId, messages, loading, sending, error, close, refresh, send } = useConversationStore();
  const panes = usePanesStore((state) => state.panes) as Array<{ id: string; title?: string; agent?: string }>;
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);
  const pane = panes.find((item) => item.id === paneId);

  useEffect(() => {
    if (!open || !paneId) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [open, paneId, refresh]);

  useEffect(() => {
    if (!open || !paneId) return;
    return window.codeBrainApp.conversation.onUpdated((updatedPaneId) => {
      if (updatedPaneId === paneId) void refresh();
    });
  }, [open, paneId, refresh]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages]);
  if (!open || !paneId) return null;

  const submit = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    const parentId = replyTo;
    setDraft("");
    setReplyTo(undefined);
    if (!(await send(content, parentId))) setDraft((current) => current || content);
  };

  return (
    <aside className="absolute inset-y-0 right-0 w-[min(430px,92vw)] flex flex-col bg-cb-bg-1 border-l border-cb-line-1 shadow-2xl" style={{ zIndex: "var(--cb-z-panel)" }} aria-label="Conversa do agente">
      <header className="h-cell-lg px-3 flex items-center gap-2 border-b border-cb-line-0">
        <MessageSquare size={13} className="text-cb-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-cb-fg-0 truncate">{pane?.title || pane?.agent || "agente"}</div>
          <div className="text-2xs text-cb-fg-3">timeline · {paneId.slice(0, 8)}</div>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Atualizar"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
        <button onClick={close} className="p-1 text-cb-fg-3 hover:text-cb-fg-0" aria-label="Fechar conversa"><X size={14} /></button>
      </header>

      <div className="cb-scroll flex-1 overflow-auto p-3 space-y-2">
        {!loading && messages.length === 0 && <p className="text-xs text-cb-fg-3 text-center py-10">Nenhuma mensagem durável com este agente.</p>}
        {messages.map((message) => {
          const mine = message.from_pane === "operator";
          return (
            <button key={message.id} type="button" onClick={() => setReplyTo(message.id)} className={`block max-w-[88%] text-left px-3 py-2 border rounded-cb-1 transition-colors ${mine ? "ml-auto bg-cb-accent-wash border-cb-accent-dim text-cb-fg-0 hover:bg-cb-accent-wash-strong" : "mr-auto bg-cb-bg-2 border-cb-line-1 text-cb-fg-0 hover:border-cb-line-focus"}`}>
              <div className={`flex gap-2 mb-1 text-2xs ${mine ? "text-cb-accent-bright" : "text-cb-fg-2"}`}><span>{message.from_pane === "operator" ? "você" : pane?.agent || message.from_pane.slice(0, 8)}</span><span>{message.type}</span><time>{timeLabel(message.created_at)}</time></div>
              <div className="text-xs whitespace-pre-wrap break-words">{message.content}</div>
            </button>
          );
        })}
        <div ref={endRef} />
      </div>

      <footer className="border-t border-cb-line-0 p-2">
        {replyTo && <div className="flex items-center justify-between text-2xs text-cb-fg-3 px-1 pb-1"><span>respondendo a {replyTo.slice(0, 12)}</span><button onClick={() => setReplyTo(undefined)}>cancelar</button></div>}
        {error && <div className="text-2xs text-cb-danger px-1 pb-1">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!event.repeat) void submit(); } }} disabled={sending} rows={2} placeholder={sending ? "Enviando…" : "Mensagem ao agente…"} className="flex-1 resize-none bg-cb-bg-0 border border-cb-line-1 rounded-cb-1 px-2 py-1.5 text-xs text-cb-fg-0 outline-none focus:border-cb-accent disabled:opacity-60" />
          <button onClick={() => void submit()} disabled={sending || !draft.trim()} className="h-8 px-3 flex items-center gap-1 bg-cb-accent text-cb-bg-0 disabled:opacity-40 rounded-cb-1 text-xs"><Send size={12} /> enviar</button>
        </div>
      </footer>
    </aside>
  );
}
