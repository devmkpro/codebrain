import React from "react";
import { NODE_R, AGENT_COLORS, agentColor, paneSession, isPathWithin } from "../layout/DropTarget";
import { FileLock, FileBraces, FileCode, FileText, FileImage, FileType, File } from "../../stores/providers-store";

// SessionMap
import { usePanesStore } from "../../stores/panes-store";
import { useNavStore } from "../../stores/nav-store";

const EDGE_STYLE = {
  temporal:    { stroke: "#555",   strokeHover: "#aaa", width: 1.2, dash: "4,3" },
  "same-agent":{ stroke: "#3b82f6",strokeHover: "#60a5fa", width: 1.5, dash: "" },
  subpath:     { stroke: "#a855f7",strokeHover: "#c084fc", width: 1.2, dash: "6,2" },
  "same-cwd":  { stroke: "#22c55e",strokeHover: "#4ade80", width: 1.2, dash: "3,3" },
  topic:       { stroke: "#eab308",strokeHover: "#facc15", width: 1.2, dash: "8,3" },
};

const EDGE_LABEL = {
  temporal:    "sequência temporal",
  "same-agent": "mesmo agente",
  subpath:     "mesmo subdiretório",
  "same-cwd":  "mesmo diretório",
  topic:       "tópico similar",
};

export function SessionMap({
  workspacePath
}) {
  const addPane = usePanesStore(s => s.addPane);
  const openPanes = usePanesStore(s => s.panes);
  const openPaneIds = React.useMemo(() => new Set(openPanes.map(p => p.id)), [openPanes]);
  const navigateInActiveTab = useNavStore(s => s.navigateInActiveTab);
  const [sessions, setSessions] = React.useState([]);
  const [keywordsByClaudeId, setKeywordsByClaudeId] = React.useState(new Map());
  const [nodes, setNodes] = React.useState([]);
  const [view, setView] = React.useState({
    x: 0,
    y: 0,
    scale: 1
  });
  const panRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0
  });
  const [edges, setEdges] = React.useState([]);
  const [hoverId, setHoverId] = React.useState(null);
  const [resumingId, setResumingId] = React.useState(null);
  const [restoreError, setRestoreError] = React.useState(null);
  const svgRef = React.useRef(null);
  const [svgSize, setSvgSize] = React.useState({
    w: 0,
    h: 0
  });
  React.useEffect(() => {
    if (!svgRef.current) return;
    const update = () => {
      const r = svgRef.current?.getBoundingClientRect();
      if (r && (r.width !== svgSize.w || r.height !== svgSize.h)) setSvgSize({
        w: r.width,
        h: r.height
      });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(svgRef.current);
    return () => obs.disconnect();
  }, []);
  const animRef = React.useRef(0);
  const nodesRef = React.useRef([]);
  const edgesRef = React.useRef([]);
  React.useEffect(() => {
    Promise.all([window.codeBrainApp?.session?.loadAll?.(workspacePath).catch(() => []) ?? Promise.resolve([]), window.codeBrainApp?.claude?.sessions?.(workspacePath).catch(() => []) ?? Promise.resolve([])]).then(([saved, claudeSessions]) => {
      const synth = claudeSessions.map(cs => ({
        id: cs.sessionId,
        workspacePath,
        savedAt: cs.savedAt ?? cs.lastUsedAt ?? cs.firstSeenAt,
        panes: [{
          id: cs.paneId ?? cs.sessionId,
          agent: "claude",
          cwd: cs.cwd,
          lastLines: cs.summary ? [cs.summary] : [],
          session: cs.session ?? {
            provider: "claude",
            id: cs.sessionId,
            capturedAt: cs.savedAt ?? cs.lastUsedAt ?? cs.firstSeenAt,
            confidence: "high",
            source: "transcript-file"
          },
          claudeSessionId: cs.sessionId,
          providerId: cs.providerId,
          model: cs.model
        }]
      }));
      const byKey = new Map();
      for (const item of [...saved, ...synth]) {
        const p = item.panes[0];
        const ps = p ? paneSession(p) : void 0;
        const key = ps ? `${ps.provider}:${ps.id}` : p ? `${p.agent}:${p.id}` : item.id;
        const existing = byKey.get(key);
        if (!existing || item.savedAt > existing.savedAt) byKey.set(key, item);
      }
      setSessions([...byKey.values()].sort((a, b) => b.savedAt - a.savedAt));
      const map = new Map();
      for (const cs of claudeSessions) map.set(cs.sessionId, cs.keywords ?? []);
      setKeywordsByClaudeId(map);
    }).catch(() => setSessions([]));
  }, [workspacePath]);
  React.useEffect(() => {
    if (!svgRef.current) return;
    const livePanesInWorkspace = openPanes.filter(p => (p.workspacePath ?? p.cwd) === workspacePath || isPathWithin(workspacePath, p.cwd));
    const savedPaneIds = new Set(sessions.flatMap(s => s.panes.map(p => p.id)));
    const liveOnly = livePanesInWorkspace.filter(p => !savedPaneIds.has(p.id));
    const liveSessions = liveOnly.map(p => ({
      id: `live-${p.id}`,
      workspacePath,
      savedAt: Date.now(),
      panes: [{
        id: p.id,
        agent: p.agent,
        cwd: p.cwd,
        args: p.args,
        session: p.session,
        claudeSessionId: p.claudeSessionId,
        lastLines: []
      }]
    }));
    const allSessions = [...sessions, ...liveSessions];
    if (allSessions.length === 0) return;
    cancelAnimationFrame(animRef.current);
    const width = svgSize.w || svgRef.current?.getBoundingClientRect().width || 800;
    const height = svgSize.h || svgRef.current?.getBoundingClientRect().height || 600;
    const cx = width / 2,
      cy = height / 2;
    const r = Math.min(cx, cy) * 0.6;
    const prevById = new Map(nodesRef.current.map(n => [n.id, n]));
    const ns = allSessions.flatMap(s => s.panes.map(p => {
      const id = `${s.id}-${p.id}`;
      const ps = paneSession(p);
      const keywords = ps?.provider === "claude" && keywordsByClaudeId.get(ps.id) || [];
      const prev = prevById.get(id);
      if (prev) return {
        ...prev,
        session: s,
        pane: p,
        keywords
      };
      const angle = Math.random() * Math.PI * 2;
      return {
        id,
        session: s,
        pane: p,
        keywords,
        x: cx + Math.cos(angle) * r * (0.4 + Math.random() * 0.6),
        y: cy + Math.sin(angle) * r * (0.4 + Math.random() * 0.6),
        vx: 0,
        vy: 0
      };
    }));
    const es = buildEdges(ns);
    nodesRef.current = ns;
    edgesRef.current = es;
    setNodes([...ns]);
    setEdges(es);
    let frame = 0;
    const MAX_FRAMES = 200;
    const tick = () => {
      const n = nodesRef.current;
      const e = edgesRef.current;
      if (!n.length || frame >= MAX_FRAMES) return;
      const nodeMap2 = new Map(n.map(node => [node.id, node]));
      for (const node of n) {
        let fx = 0,
          fy = 0;
        for (const other of n) {
          if (other.id === node.id) continue;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = 3200 / (d * d);
          fx += dx / d * f;
          fy += dy / d * f;
        }
        for (const edge of e) {
          const isA = edge.source === node.id;
          const isB = edge.target === node.id;
          if (!isA && !isB) continue;
          const other = nodeMap2.get(isA ? edge.target : edge.source);
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = d - edge.idealDist;
          const f = displacement * edge.strength;
          fx += dx / d * f;
          fy += dy / d * f;
        }
        fx += (cx - node.x) * 0.01;
        fy += (cy - node.y) * 0.01;
        node.vx = (node.vx + fx) * 0.55;
        node.vy = (node.vy + fy) * 0.55;
        node.x = Math.max(NODE_R + 10, Math.min(width - NODE_R - 10, node.x + node.vx));
        node.y = Math.max(NODE_R + 10, Math.min(height - NODE_R - 10, node.y + node.vy));
      }
      frame++;
      setNodes([...n]);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [sessions, openPanes.map(p => p.id).sort().join("|"), workspacePath, keywordsByClaudeId, svgSize.w, svgSize.h]);
  const handleResume = React.useCallback(async node => {
    if (resumingId) return;
    setResumingId(node.id);
    setRestoreError(null);
    const p = node.pane;
    const ps = paneSession(p);
    if (ps?.confidence === "high") {
      const existing = usePanesStore.getState().panes.find(x => x.session?.provider === ps.provider && x.session?.id === ps.id);
      if (existing) {
        usePanesStore.getState().setActive(existing.id);
        navigateInActiveTab({
          kind: "workspace"
        });
        setResumingId(null);
        return;
      }
    }
    const spawn = window.codeBrainApp?.pty.spawn;
    if (!spawn) {
      setRestoreError("Restore indisponivel neste build.");
      setResumingId(null);
      return;
    }
    let usedFallback = false;
    let result = await spawn({
      agent: p.agent,
      cwd: p.cwd,
      args: p.args,
      session: p.session,
      claudeSessionId: p.claudeSessionId,
      providerId: p.providerId,
      model: p.model
    });
    if (!result?.ok && p.claudeSessionId && (p.providerId || p.model || p.args?.length)) {
      usedFallback = true;
      result = await spawn({
        agent: p.agent,
        cwd: p.cwd,
        claudeSessionId: p.claudeSessionId
      });
    }
    if (result?.ok && result.paneId) {
      addPane({
        id: result.paneId,
        agent: p.agent,
        cwd: p.cwd,
        args: usedFallback ? void 0 : p.args,
        workspacePath,
        session: usedFallback ? void 0 : p.session,
        claudeSessionId: p.claudeSessionId,
        lastLines: p.lastLines,
        providerId: usedFallback ? void 0 : p.providerId,
        model: usedFallback ? void 0 : p.model,
        externallySpawned: true
      });
      navigateInActiveTab({
        kind: "workspace"
      });
    } else {
      setRestoreError(result?.error ?? "Nao foi possivel restaurar a sessao.");
    }
    setResumingId(null);
  }, [resumingId, addPane, navigateInActiveTab]);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const hoveredEdgeKinds = new Set();
  if (hoverId) {
    for (const e of edges) {
      if (e.source === hoverId || e.target === hoverId) hoveredEdgeKinds.add(e.kind);
    }
  }
  return <div className="flex-1 overflow-hidden bg-black relative select-none">
      {restoreError && <div className="absolute left-3 top-3 z-20 max-w-md rounded-lg border border-indigo-500/20 bg-black/90 px-3 py-2 shadow-xl">
          <p className="font-mono text-[10px] text-red-400">{restoreError}</p>
        </div>}
      {sessions.length === 0 && openPanes.filter(p => (p.workspacePath ?? p.cwd) === workspacePath || isPathWithin(workspacePath, p.cwd)).length === 0 ? <div className="flex items-center justify-center h-full">
          <p className="font-mono text-[12px] text-gray-400 bg-white/5 px-4 py-2 rounded border border-white/10 shadow-sm">Nenhuma sessão salva.</p>
        </div> : <React.Fragment>
          <svg ref={svgRef} className="w-full h-full" onWheel={e => {
        e.preventDefault();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        setView(v2 => {
          const nextScale = Math.max(0.2, Math.min(4, v2.scale * factor));
          const k2 = nextScale / v2.scale;
          return {
            x: mouseX - (mouseX - v2.x) * k2,
            y: mouseY - (mouseY - v2.y) * k2,
            scale: nextScale
          };
        });
      }} onMouseDown={e => {
        if (e.target.tagName === "rect" || e.currentTarget === e.target) {
          panRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            origX: view.x,
            origY: view.y
          };
        }
      }} onMouseMove={e => {
        if (!panRef.current.active) return;
        setView(v2 => ({
          ...v2,
          x: panRef.current.origX + (e.clientX - panRef.current.startX),
          y: panRef.current.origY + (e.clientY - panRef.current.startY)
        }));
      }} onMouseUp={() => {
        panRef.current.active = false;
      }} onMouseLeave={() => {
        panRef.current.active = false;
      }} style={{
        cursor: panRef.current.active ? "grabbing" : "grab"
      }}>
            <rect width="100%" height="100%" fill="#000" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
              {["temporal", "same-agent", "subpath", "same-cwd", "topic"].map(kind => edges.filter(e => e.kind === kind).map(e => {
            const s = nodeMap.get(e.source);
            const t = nodeMap.get(e.target);
            if (!s || !t) return null;
            const style = EDGE_STYLE[kind];
            const isHovered = hoverId === e.source || hoverId === e.target;
            return <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={isHovered ? style.strokeHover : style.stroke} strokeWidth={isHovered ? style.width * 1.5 : style.width} strokeDasharray={style.dash} />;
          }))}
              {nodes.map(node => {
            const color = agentColor(node.pane.agent);
            const isHovered = hoverId === node.id;
            const isResuming = resumingId === node.id;
            const preview = node.pane.lastLines.filter(Boolean).slice(-1)[0] ?? "";
            const folderName = node.pane.cwd.split("/").pop() ?? node.pane.cwd;
            const svgW = svgRef.current?.getBoundingClientRect().width ?? 800;
            const flipLeft = node.x > svgW * 0.65;
            const tipX = flipLeft ? -212 : NODE_R + 10;
            return <g transform={`translate(${node.x},${node.y})`} style={{
              cursor: isResuming ? "wait" : "pointer"
            }} onMouseEnter={() => setHoverId(node.id)} onMouseLeave={() => setHoverId(null)} onClick={() => handleResume(node)}>
                    {(() => {
                const isOpen = openPaneIds.has(node.pane.id);
                return <React.Fragment>
                          {isOpen && <circle r={NODE_R + 6} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5}>
                              <animate attributeName="r" values={`${NODE_R + 6};${NODE_R + 14};${NODE_R + 6}`} dur="2s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
                            </circle>}
                          {isHovered && <circle r={NODE_R + 12} fill={color} opacity={0.06} />}
                          <circle r={NODE_R} fill={isOpen ? "#1a0808" : "#0c0c0c"} stroke={color} strokeWidth={isOpen ? 2.5 : isHovered ? 2 : 1} opacity={isOpen ? 1 : isHovered ? 1 : 0.65} />
                        </React.Fragment>;
              })()}
                    <text textAnchor="middle" dominantBaseline="middle" y={-3} fill={color} fontSize={10} fontFamily="Menlo,monospace" fontWeight="bold" opacity={isHovered ? 1 : 0.85}>
                      {node.pane.agent.slice(0, 3).toUpperCase()}
                    </text>
                    <text textAnchor="middle" dominantBaseline="middle" y={12} fill="#777" fontSize={8} fontFamily="Menlo,monospace">
                      {(node.keywords[0] ?? "").slice(0, 12)}
                    </text>
                    <text textAnchor="middle" dominantBaseline="middle" y={NODE_R + 12} fill="#666" fontSize={8} fontFamily="Menlo,monospace">
                      {node.pane.id}
                    </text>
                    {paneSession(node.pane) && <text textAnchor="middle" dominantBaseline="middle" y={NODE_R + 22} fill="#ef4444" opacity={0.5} fontSize={7} fontFamily="Menlo,monospace">
                        {paneSession(node.pane).provider}:{paneSession(node.pane).id.slice(0, 8)}
                      </text>}
                    {isResuming && <circle r={NODE_R + 5} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.7}>
                        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite" />
                      </circle>}
                    {isHovered && <g transform={`translate(${tipX}, -28)`}>
                        <rect x={0} y={0} width={220} height={preview ? 58 : 42} rx={5} fill="#111" stroke="#222" strokeWidth={1} />
                        <text x={10} y={16} fill="#ccc" fontSize={10} fontFamily="Menlo,monospace" fontWeight="bold">
                          {folderName}
                        </text>
                        <text x={10} y={29} fill="#444" fontSize={8} fontFamily="Menlo,monospace">
                          {node.pane.cwd.split("/").slice(-3, -1).join("/")}
                        </text>
                        {preview && <text x={10} y={42} fill="#555" fontSize={8} fontFamily="Menlo,monospace">
                            {preview.replace(/\x1b\[[^m]+m/g, "").slice(0, 24)}
                          </text>}
                        <text x={10} y={preview ? 54 : 40} fill={color} fontSize={8} fontFamily="Menlo,monospace">
                          {paneSession(node.pane)?.confidence === "high" ? "↵ Resume conversation" : "↵ Reopen pane (new session)"}
                        </text>
                        {hoveredEdgeKinds.size > 0 && <g transform={`translate(0, ${preview ? 60 : 44})`}>
                            {[...hoveredEdgeKinds].map((k2, ki) => <g transform={`translate(10, ${ki * 14})`}>
                                <line x1={0} y1={4} x2={14} y2={4} stroke={EDGE_STYLE[k2].stroke} strokeWidth={EDGE_STYLE[k2].width + 0.5} strokeDasharray={EDGE_STYLE[k2].dash} />
                                <text x={18} y={8} fill="#444" fontSize={7} fontFamily="Menlo,monospace">
                                  {EDGE_LABEL[k2]}
                                </text>
                              </g>)}
                          </g>}
                      </g>}
                  </g>;
          })}
            </g>
          </svg>
          <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 pointer-events-none">
            {Object.entries(EDGE_LABEL).map(([kind, label]) => {
          const style = EDGE_STYLE[kind];
          return <div className="flex items-center gap-2">
                  <svg width={24} height={8}>
                    <line x1={0} y1={4} x2={24} y2={4} stroke={style.strokeHover} strokeWidth={style.width} strokeDasharray={style.dash} />
                  </svg>
                  <span className="font-mono text-[8px] text-gray-700">{label}</span>
                </div>;
        })}
          </div>
        </React.Fragment>}
    </div>;
}
export const CODEBRAIN_FILE_DRAG_TYPE = "application/x-codebrain-file";
export function fileIcon(name) {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  const codeExts = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "swift", "kt", "php", "sh", "bash", "zsh", "lua", "sql", "css", "scss", "html", "vue", "svelte", "astro"]);
  const textExts = new Set(["md", "mdx", "txt", "rst", "adoc"]);
  const imgExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);
  const lockNames = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "cargo.lock"]);
  if (lockNames.has(lower)) return {
    Icon: FileLock,
    color: "text-yellow-600"
  };
  if (ext === "json") return {
    Icon: FileBraces,
    color: "text-yellow-500"
  };
  if (codeExts.has(ext)) return {
    Icon: FileCode,
    color: "text-blue-400"
  };
  if (textExts.has(ext)) return {
    Icon: FileText,
    color: "text-gray-400"
  };
  if (imgExts.has(ext)) return {
    Icon: FileImage,
    color: "text-pink-400"
  };
  if (ext === "env" || lower.startsWith(".env")) return {
    Icon: FileLock,
    color: "text-orange-500"
  };
  if (ext === "yaml" || ext === "yml" || ext === "toml" || ext === "ini") return {
    Icon: FileType,
    color: "text-purple-400"
  };
  return {
    Icon: File,
    color: "text-gray-500"
  };
}