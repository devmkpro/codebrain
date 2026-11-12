import React from "react";

import { usePanesStore } from "../../stores/panes-store";
import { buildOffice, roomsSignature, type OfficeAgent } from "./office-model";

/* Escritório: os agentes de todos os workspaces abertos como personagens do
   Pixel Agents (MIT, src/public/office/NOTICE.md). Cada workspace é uma sala
   com o nome do projeto; quando um pane manda mensagem para outro, o
   personagem do remetente anda até o destinatário. Usado no pane
   "escritório" e na página inicial. */

const ENVELOPE = "codebrain-office";

interface Sent {
  room: string;
  name: string;
  activity: OfficeAgent["activity"];
}

export function useOfficeSummary() {
  const panes = usePanesStore((state: any) => state.panes) as any[];
  return React.useMemo(() => buildOffice(panes), [panes]);
}

export function OfficeView({
  onFocusPane,
  className,
  style,
}: {
  /** Clique num personagem. */
  onFocusPane?: (paneId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const office = useOfficeSummary();
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = React.useState(0);
  const ids = React.useRef(new Map<string, number>());
  const nextId = React.useRef(1);
  const sent = React.useRef(new Map<number, Sent>());
  const roomsSent = React.useRef("");
  const focusRef = React.useRef(onFocusPane);
  focusRef.current = onFocusPane;

  const src = React.useMemo(() => new URL("office/index.html?host=codebrain", window.location.href).toString(), []);

  const post = React.useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  const idFor = (paneId: string) => {
    let id = ids.current.get(paneId);
    if (id === undefined) {
      id = nextId.current++;
      ids.current.set(paneId, id);
    }
    return id;
  };

  // The office asks for a sync each time it (re)loads its layout.
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { envelope?: string; message?: { type?: string; id?: number } };
      if (data?.envelope !== ENVELOPE) return;
      const message = data.message;
      if (message?.type === "codebrainOfficeReady") {
        sent.current.clear();
        roomsSent.current = "";
        setReady((n) => n + 1);
      } else if (message?.type === "focusAgent" && typeof message.id === "number") {
        for (const [paneId, id] of ids.current) {
          if (id === message.id) focusRef.current?.(paneId);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Rooms first (seats live in rooms), then the diff of agents.
  React.useEffect(() => {
    if (!ready) return;
    const signature = roomsSignature(office.rooms);
    if (signature !== roomsSent.current) {
      roomsSent.current = signature;
      post({ type: "codebrainRooms", rooms: office.rooms });
    }
    const alive = new Set<number>();
    for (const agent of office.agents) {
      const id = idFor(agent.paneId);
      alive.add(id);
      const before = sent.current.get(id);
      if (!before) post({ type: "agentCreated", id, directoryName: agent.room });
      if (!before || before.name !== agent.name || before.room !== agent.room) {
        post({ type: "codebrainAgentMeta", id, name: agent.name, directoryName: agent.room });
      }
      if (!before || before.activity !== agent.activity) {
        if (agent.activity === "active") {
          post({ type: "agentStatus", id, status: "active" });
          post({ type: "agentToolStart", id, toolId: "codebrain", status: "trabalhando", toolName: "Bash" });
        } else {
          post({ type: "agentToolsClear", id });
          post({ type: "agentStatus", id, status: agent.activity, awaitingInput: agent.activity === "waiting" });
        }
      }
      sent.current.set(id, { room: agent.room, name: agent.name, activity: agent.activity });
    }
    for (const id of [...sent.current.keys()]) {
      if (alive.has(id)) continue;
      post({ type: "agentClosed", id });
      sent.current.delete(id);
    }
  }, [ready, office, post]);

  // pane_send_message between two panes: the sender walks to the recipient.
  React.useEffect(() => {
    const off = window.codeBrainApp?.office?.onMessage?.((event) => {
      const from = ids.current.get(event.from);
      const to = ids.current.get(event.to);
      if (from === undefined || to === undefined) return;
      if (!sent.current.has(from) || !sent.current.has(to)) return;
      post({ type: "codebrainVisit", from, to, kind: event.type });
    });
    return () => off?.();
  }, [post]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title="Escritório dos agentes"
      className={className}
      style={{ border: 0, backgroundColor: "#1e1e2e", ...style }}
    />
  );
}
