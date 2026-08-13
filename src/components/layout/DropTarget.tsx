import React from "react";
import { CODEBRAIN_PANE_DRAG_TYPE, paneDropSide, type PaneDropSide } from "../../lib/pane-drag";

// DropTarget
export function DropTarget({
  pane,
  workspacePath,
  movePaneTo,
  children
}) {
  const [dropSide, setDropSide] = React.useState<PaneDropSide | null>(null);
  React.useEffect(() => {
    const clear = () => setDropSide(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);
  const computeSide = e => paneDropSide(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
  const zoneStyle: React.CSSProperties | undefined = dropSide === "left"
    ? { inset: "8px 50% 8px 8px" }
    : dropSide === "right"
      ? { inset: "8px 8px 8px 50%" }
      : dropSide === "top"
        ? { inset: "8px 8px 50% 8px" }
        : dropSide === "bottom"
          ? { inset: "50% 8px 8px 8px" }
          : undefined;
  const dropLabel = dropSide === "left" || dropSide === "right" ? "lado a lado" : dropSide === "top" ? "acima" : "abaixo";
  return <div className="relative h-full w-full" onDragOver={e => {
    if (!e.dataTransfer.types.includes(CODEBRAIN_PANE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropSide(computeSide(e));
  }} onDragLeave={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropSide(null);
  }} onDrop={e => {
    const fromId = e.dataTransfer.getData(CODEBRAIN_PANE_DRAG_TYPE);
    const side = computeSide(e);
    setDropSide(null);
    if (!fromId || fromId === pane.id) return;
    e.preventDefault();
    movePaneTo(workspacePath, fromId, pane.id, side);
  }}>
      {dropSide && <div data-drop-zone className="pointer-events-none absolute z-30 flex items-center justify-center border border-cb-accent bg-cb-accent-wash-strong rounded-cb-1 text-2xs text-cb-accent-bright uppercase tracking-wider transition-all" style={zoneStyle}>{dropLabel}</div>}
      {children}
    </div>;
}
export function basename(p) {
  if (!p) return "";
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
export function isPathWithin(rootPath, candidatePath) {
  if (!rootPath || !candidatePath) return false;
  const root2 = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const candidate = candidatePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return candidate === root2 || candidate.startsWith(`${root2}/`);
}
export const NODE_R = 30;
export const AGENT_COLORS = {
  claude: "#ef4444",
  codex: "#3b82f6",
  gemini: "#22c55e",
  opencode: "#a855f7",
  shell: "#6b7280"
};
export const EDGE_STYLE = {
  topic: {
    stroke: "#22c55e88",
    strokeHover: "#22c55ecc",
    width: 2
  },
  "same-cwd": {
    stroke: "#ef444466",
    strokeHover: "#ef4444cc",
    width: 2
  },
  subpath: {
    stroke: "#ffffff22",
    strokeHover: "#ffffff55",
    width: 1.5
  },
  "same-agent": {
    stroke: "#ffffff0f",
    strokeHover: "#ffffff33",
    width: 1,
    dash: "5 3"
  },
  temporal: {
    stroke: "#ffffff08",
    strokeHover: "#ffffff18",
    width: 1,
    dash: "2 5"
  }
};
export const EDGE_LABEL = {
  topic: "tópico em comum",
  "same-cwd": "mesmo diretório",
  subpath: "mesmo projeto",
  "same-agent": "mesmo agente",
  temporal: "mesma sessão"
};
export function agentColor(agent) {
  return AGENT_COLORS[agent] ?? "#6b7280";
}
export function paneSession(pane) {
  return pane.session ?? (pane.claudeSessionId ? {
    provider: "claude",
    id: pane.claudeSessionId,
    capturedAt: Date.now(),
    confidence: "high",
    source: "transcript-file"
  } : void 0);
}
function jaccard(a, b) {
  if (a.length === 0 || b.length === 0) return {
    score: 0,
    shared: []
  };
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [];
  for (const k2 of setA) if (setB.has(k2)) shared.push(k2);
  const union = new Set([...setA, ...setB]).size;
  return {
    score: shared.length / union,
    shared
  };
}
export function buildEdges(nodes) {
  const edges = [];
  const TEN_MIN = 10 * 60 * 1e3;
  const TOPIC_THRESHOLD = 0.08;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      const cwdA = a.pane.cwd,
        cwdB = b.pane.cwd;
      const j2 = jaccard(a.keywords, b.keywords);
      if (j2.score >= TOPIC_THRESHOLD) {
        edges.push({
          source: a.id,
          target: b.id,
          kind: "topic",
          idealDist: Math.max(70, 180 - j2.score * 600),
          strength: Math.min(0.3, j2.score * 1.5),
          shared: j2.shared.slice(0, 5)
        });
        continue;
      }
      if (cwdA === cwdB) {
        edges.push({
          source: a.id,
          target: b.id,
          kind: "same-cwd",
          idealDist: 90,
          strength: 0.18
        });
        continue;
      }
      const sub = cwdA.startsWith(cwdB + "/") || cwdB.startsWith(cwdA + "/");
      if (sub) {
        edges.push({
          source: a.id,
          target: b.id,
          kind: "subpath",
          idealDist: 140,
          strength: 0.1
        });
        continue;
      }
      if (a.pane.agent === b.pane.agent) {
        edges.push({
          source: a.id,
          target: b.id,
          kind: "same-agent",
          idealDist: 200,
          strength: 0.04
        });
        continue;
      }
      const dt = Math.abs(a.session.savedAt - b.session.savedAt);
      if (dt < TEN_MIN) {
        edges.push({
          source: a.id,
          target: b.id,
          kind: "temporal",
          idealDist: 180,
          strength: 0.03
        });
      }
    }
  }
  return edges;
}
