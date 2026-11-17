import React from "react";
import type { GitDigestEdge, GitDigestNode } from "../../types/git-digest";

/* Mapa neural radial: o dia no centro, projetos no primeiro anel, temas no
   segundo e arquivos na borda. Cada projeto recebe uma fatia mínima do
   círculo (metade igual para todos, metade proporcional ao que carrega), para
   projeto pequeno não ficar espremido contra o vizinho. Rótulos de tema e de
   arquivo seguem o raio, cada um no seu corredor: tema para dentro, arquivo
   para fora. Arquivos tocados por mais de um tema ganham sinapse tracejada. */

const RINGS = { day: 0, project: 180, theme: 360, file: 480 } as const;
const PALETTE = ["var(--cb-accent)", "var(--cb-info)", "var(--cb-success)", "var(--cb-warn)", "var(--cb-danger)"];
const KIND_LABEL = { day: "Dia", project: "Projeto", theme: "Tema", file: "Arquivo" } as const;
/** Espaço radial reservado para o texto do lado de fora do anel de arquivos. */
const FILE_LABEL_ROOM = 170;
const MAX_CHARS = { project: 24, theme: 26, file: 26 } as const;

export const truncateLabel = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export interface PlacedNode extends GitDigestNode {
  x: number;
  y: number;
  angle: number;
  r: number;
  color: string;
}

function radiusOf(node: GitDigestNode): number {
  const w = Math.max(1, node.weight);
  if (node.kind === "day") return 30;
  if (node.kind === "project") return Math.min(26, 12 + Math.sqrt(w) * 2.4);
  if (node.kind === "theme") return Math.min(16, 7 + Math.sqrt(w) * 2);
  return Math.min(9, 3.5 + Math.log10(w + 1) * 2.2);
}

export function layoutNeuralMap(nodes: GitDigestNode[]): Map<string, PlacedNode> {
  const children = new Map<string | null, GitDigestNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parent) ?? [];
    list.push(node);
    children.set(node.parent, list);
  }
  const leaves = new Map<string, number>();
  const countLeaves = (node: GitDigestNode): number => {
    const kids = children.get(node.id) ?? [];
    const total = kids.length ? kids.reduce((sum, kid) => sum + countLeaves(kid), 0) : 1;
    leaves.set(node.id, total);
    return total;
  };
  const roots = children.get(null) ?? [];
  roots.forEach(countLeaves);

  const placed = new Map<string, PlacedNode>();
  const projectIds = (children.get("day") ?? []).map((node) => node.id);
  const place = (node: GitDigestNode, from: number, to: number, inherited: string) => {
    const angle = (from + to) / 2;
    const ring = RINGS[node.kind];
    const color = node.kind === "project" ? PALETTE[projectIds.indexOf(node.id) % PALETTE.length] : inherited;
    placed.set(node.id, { ...node, angle, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, r: radiusOf(node), color });
    const kids = children.get(node.id) ?? [];
    const total = kids.reduce((sum, kid) => sum + (leaves.get(kid.id) ?? 1), 0) || 1;
    // No dia, metade da volta é dividida igualmente entre os projetos.
    const share = (kid: GitDigestNode) =>
      node.kind === "day" ? 0.5 / kids.length + (0.5 * (leaves.get(kid.id) ?? 1)) / total : (leaves.get(kid.id) ?? 1) / total;
    let cursor = from;
    for (const kid of kids) {
      const span = (to - from) * share(kid);
      place(kid, cursor, cursor + span, color);
      cursor += span;
    }
  };
  for (const root of roots) place(root, -Math.PI / 2, (Math.PI * 3) / 2, "var(--cb-accent)");
  return placed;
}

/** Ramo de árvore: sai do pai no raio dele e chega ao filho no raio dele, como um dendrograma. */
function edgePath(a: PlacedNode, b: PlacedNode, synapse: boolean): string {
  if (synapse) {
    const cx = ((a.x + b.x) / 2) * 0.55;
    const cy = ((a.y + b.y) / 2) * 0.55;
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  const ra = Math.hypot(a.x, a.y);
  const rb = Math.hypot(b.x, b.y);
  const mid = (ra + rb) / 2;
  const c1 = { x: Math.cos(a.angle) * mid, y: Math.sin(a.angle) * mid };
  const c2 = { x: Math.cos(b.angle) * mid, y: Math.sin(b.angle) * mid };
  // O nó do dia está no centro: a curva parte direto na direção do filho.
  if (ra < 1) {
    c1.x = Math.cos(b.angle) * rb * 0.35;
    c1.y = Math.sin(b.angle) * rb * 0.35;
  }
  const f = (value: number) => value.toFixed(1);
  return `M${f(a.x)},${f(a.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(b.x)},${f(b.y)}`;
}

/** Posição do rótulo em relação ao nó. Tema: ao longo do raio, para dentro. Arquivo: ao longo do raio, para fora. Projeto: horizontal, voltado ao centro. */
function labelProps(node: PlacedNode): React.SVGProps<SVGTextElement> {
  const right = Math.cos(node.angle) >= 0;
  const degrees = (node.angle * 180) / Math.PI + (right ? 0 : 180);
  const gap = node.r + 6;
  // Tema: ao longo do raio, deslocado para o lado da linha que chega do projeto.
  if (node.kind === "theme")
    return { transform: `rotate(${degrees.toFixed(1)})`, textAnchor: right ? "end" : "start", dx: right ? -gap : gap, dy: -7 };
  if (node.kind === "file")
    return { transform: `rotate(${degrees.toFixed(1)})`, textAnchor: right ? "start" : "end", dx: right ? gap : -gap, dy: 3.5 };
  // Projeto: horizontal, centrado, do lado voltado ao centro (para fora ficam os ramos dos temas).
  return { textAnchor: "middle", dx: 0, dy: Math.sin(node.angle) < 0 ? node.r + 16 : -(node.r + 8) };
}

export function NeuralMap({
  nodes,
  edges,
  selected,
  onSelect,
}: {
  nodes: GitDigestNode[];
  edges: GitDigestEdge[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const placed = React.useMemo(() => layoutNeuralMap(nodes), [nodes]);
  const [view, setView] = React.useState({ x: 0, y: 0, zoom: 1 });
  const [hover, setHover] = React.useState<string | null>(null);
  const drag = React.useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => setView({ x: 0, y: 0, zoom: 1 }), [nodes]);

  const zoomBy = React.useCallback(
    (factor: number) => setView((current) => ({ ...current, zoom: Math.min(4, Math.max(0.5, current.zoom * factor)) })),
    []
  );

  // O onWheel do React é passivo; o listener nativo permite segurar o scroll da página.
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const extent = React.useMemo(() => {
    let max = 120;
    for (const node of placed.values()) max = Math.max(max, Math.hypot(node.x, node.y) + node.r);
    // Rótulos de arquivo saem para fora do último anel: reserva o corredor deles.
    const hasFiles = [...placed.values()].some((node) => node.kind === "file");
    return max + (hasFiles ? FILE_LABEL_ROOM : 140);
  }, [placed]);
  // Até ~200 arquivos os rótulos radiais cabem lado a lado sem encostar.
  const fileCount = React.useMemo(() => [...placed.values()].filter((node) => node.kind === "file").length, [placed]);
  // Desenha de fora para dentro: rótulos de projeto e do dia ficam por cima.
  const drawOrder = React.useMemo(() => {
    const rank = { file: 0, theme: 1, project: 2, day: 3 } as const;
    return [...placed.values()].sort((a, b) => rank[a.kind] - rank[b.kind]);
  }, [placed]);
  const size = (extent * 2) / view.zoom;
  const viewBox = `${(-size / 2 + view.x).toFixed(1)} ${(-size / 2 + view.y).toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}`;

  // Ramo ativo: o nó, ancestrais, descendentes e quem divide sinapse com ele.
  const active = React.useMemo(() => {
    const focus = hover ?? selected;
    if (!focus || focus === "day" || !placed.has(focus)) return null;
    const set = new Set<string>([focus]);
    let cursor = placed.get(focus)?.parent ?? null;
    while (cursor) {
      set.add(cursor);
      cursor = placed.get(cursor)?.parent ?? null;
    }
    const down = (id: string) => {
      for (const node of placed.values())
        if (node.parent === id && !set.has(node.id)) {
          set.add(node.id);
          down(node.id);
        }
    };
    down(focus);
    for (const edge of edges)
      if (edge.kind === "synapse" && (edge.from === focus || edge.to === focus)) {
        set.add(edge.from);
        set.add(edge.to);
      }
    return set;
  }, [hover, selected, placed, edges]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-node]")) return;
    drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start || !svgRef.current) return;
    const scale = size / svgRef.current.getBoundingClientRect().width;
    setView((current) => ({ ...current, x: start.vx - (event.clientX - start.x) * scale, y: start.vy - (event.clientY - start.y) * scale }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const showLabel = (node: PlacedNode) => node.kind !== "file" || fileCount <= 200 || view.zoom >= 1.6 || !!active?.has(node.id);

  return (
    <div className="cbc-neural">
      <div className="cbc-neural-tools" role="group" aria-label="Zoom do mapa">
        <button type="button" className="cbc-btn" onClick={() => zoomBy(1.25)} aria-label="Aproximar">+</button>
        <button type="button" className="cbc-btn" onClick={() => zoomBy(0.8)} aria-label="Afastar">−</button>
        <button type="button" className="cbc-btn" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>centralizar</button>
      </div>
      <svg
        ref={svgRef}
        className="cbc-neural-svg"
        viewBox={viewBox}
        role="group"
        aria-label="Mapa neural das edições do dia"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <filter id="cbc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[RINGS.project, RINGS.theme, RINGS.file].map((ring) => (
          <circle key={ring} r={ring} className="cbc-neural-ring" />
        ))}
        <g>
          {edges.map((edge) => {
            const a = placed.get(edge.from);
            const b = placed.get(edge.to);
            if (!a || !b) return null;
            const lit = !!active && active.has(edge.from) && active.has(edge.to);
            return (
              <path
                key={`${edge.from}>${edge.to}>${edge.kind}`}
                d={edgePath(a, b, edge.kind === "synapse")}
                className="cbc-neural-edge"
                data-kind={edge.kind}
                data-lit={lit || undefined}
                data-dim={active && !lit ? true : undefined}
                style={{ stroke: b.color }}
              />
            );
          })}
        </g>
        <g>
          {drawOrder.map((node) => {
            const fullLabel = node.kind === "file" ? node.detail ?? node.label : node.label;
            return (
              <g
                key={node.id}
                data-node
                transform={`translate(${node.x.toFixed(1)},${node.y.toFixed(1)})`}
                className="cbc-neural-node"
                data-kind={node.kind}
                data-selected={selected === node.id || undefined}
                data-dim={active && !active.has(node.id) ? true : undefined}
                tabIndex={0}
                role="button"
                aria-label={`${KIND_LABEL[node.kind]} ${node.detail && node.kind === "file" ? node.detail : node.label}`}
                aria-pressed={selected === node.id}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node.id);
                  }
                }}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(node.id)}
                onBlur={() => setHover(null)}
              >
                <title>{fullLabel}</title>
                <circle r={node.r + 5} className="cbc-neural-halo" style={{ fill: node.color }} />
                <circle r={node.r} className="cbc-neural-core" style={{ fill: node.color }} filter={node.kind === "file" ? undefined : "url(#cbc-glow)"} />
                {node.kind === "day" ? (
                  <text className="cbc-neural-label" data-kind="day" textAnchor="middle" dy={node.r + 18}>
                    {node.label}
                  </text>
                ) : (
                  showLabel(node) && (
                    <text className="cbc-neural-label" data-kind={node.kind} {...labelProps(node)}>
                      {truncateLabel(node.label, MAX_CHARS[node.kind])}
                    </text>
                  )
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
