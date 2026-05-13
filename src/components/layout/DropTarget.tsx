import React from "react";

// DropTarget
export function DropTarget({
  pane,
  workspacePath,
  movePaneTo,
  children
}) {
  const computeSide = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    const dists = [{
      side: "top",
      d: yPct
    }, {
      side: "bottom",
      d: 1 - yPct
    }, {
      side: "left",
      d: xPct
    }, {
      side: "right",
      d: 1 - xPct
    }];
    dists.sort((a, b) => a.d - b.d);
    return dists[0].side;
  };
  return <div className="relative h-full w-full" onDragOver={e => {
    if (!e.dataTransfer.types.includes("application/x-codebrain-pane")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = computeSide(e);
    const zone = e.currentTarget.querySelector("[data-drop-zone]");
    if (zone) zone.dataset.side = side;
  }} onDragLeave={e => {
    const zone = e.currentTarget.querySelector("[data-drop-zone]");
    if (zone) zone.dataset.side = "";
  }} onDrop={e => {
    const fromId = e.dataTransfer.getData("application/x-codebrain-pane");
    const zone = e.currentTarget.querySelector("[data-drop-zone]");
    if (zone) zone.dataset.side = "";
    if (!fromId || fromId === pane.id) return;
    e.preventDefault();
    const side = computeSide(e);
    movePaneTo(workspacePath, fromId, pane.id, side);
  }}>
      <div data-drop-zone data-side="" className="pointer-events-none absolute inset-0 z-10 transition-all data-[side=top]:border-t-4 data-[side=bottom]:border-b-4 data-[side=left]:border-l-4 data-[side=right]:border-r-4 data-[side=top]:border-red-500 data-[side=bottom]:border-red-500 data-[side=left]:border-red-500 data-[side=right]:border-red-500" />
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
function buildEdges(nodes) {
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