import { useEffect, useMemo, useRef } from "react";
import type { GraphLayout, LayoutEdge } from "../lib/graph-model";
import { EDGE_TYPES, edgeStyle, nodeStyle } from "../lib/graph-palette";

function pathOf(e: LayoutEdge): string {
  const [first, ...rest] = e.points;
  if (!first) return "";
  return `M${first.x},${first.y}` + rest.map((p) => `L${p.x},${p.y}`).join("");
}

interface Props {
  layout: GraphLayout;
  scale: number;
  selected: string | null;
  /** Scroll this node into view whenever `n` changes. */
  focus?: { key: string; n: number } | null;
  onSelect: (key: string) => void;
}

/** SVG canvas. The scroll container is the pan; `scale` is the zoom. Positions come from the layout. */
export default function GraphCanvas({ layout, scale, selected, focus, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const markerTypes = useMemo(() => {
    const seen = new Set<string>(EDGE_TYPES);
    for (const e of layout.edges) seen.add(e.type);
    return [...seen];
  }, [layout]);

  function reveal(key: string | null | undefined, always: boolean) {
    const el = box.current;
    const n = key ? layout.nodes.find((x) => x.key === key) : undefined;
    if (!el || !n) return;
    const x = n.x * scale;
    const y = n.y * scale;
    const inX = x - n.width * scale > el.scrollLeft && x + n.width * scale < el.scrollLeft + el.clientWidth;
    const inY = y - n.height * scale > el.scrollTop && y + n.height * scale < el.scrollTop + el.clientHeight;
    if (always || !inX || !inY) el.scrollTo({ left: x - el.clientWidth / 2, top: y - el.clientHeight / 2 });
  }

  // Only when the selection or focus request changes; a toggle re-layout must not yank the viewport.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => reveal(selected, false), [selected]);
  useEffect(() => reveal(focus?.key, true), [focus?.n]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div ref={box} data-testid="graph-canvas" className="h-full w-full overflow-auto bg-(--bg)">
      <svg
        width={layout.width * scale}
        height={layout.height * scale}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`Concept graph, ${layout.nodes.length} nodes and ${layout.edges.length} edges`}
        data-nodes={layout.nodes.length}
        data-edges={layout.edges.length}
      >
        <defs>
          {markerTypes.map((t) => (
            <marker
              key={t}
              id={`arrow-${t}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: edgeStyle(t).stroke }} />
            </marker>
          ))}
        </defs>
        <g fill="none">
          {layout.edges.map((e) => {
            const s = edgeStyle(e.type);
            return (
              <path
                key={e.key}
                d={pathOf(e)}
                data-edge-type={e.type}
                style={{ stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash, opacity: 0.85 }}
                markerEnd={`url(#arrow-${e.type})`}
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((n) => {
            const s = nodeStyle(n.type);
            const isSel = n.key === selected;
            return (
              <g
                key={n.key}
                data-node={n.key}
                data-type={n.type}
                transform={`translate(${n.x - n.width / 2},${n.y - n.height / 2})`}
                className={n.isDoc ? "cursor-default" : "cursor-pointer"}
                onClick={n.isDoc ? undefined : () => onSelect(n.key)}
              >
                <title>{`${n.name}\n${n.detail}`}</title>
                <rect
                  width={n.width}
                  height={n.height}
                  rx={n.isDoc ? n.height / 2 : 6}
                  style={{ fill: s.fill, stroke: s.stroke, strokeWidth: isSel ? 3 : n.isDoc ? 2 : 1.25 }}
                />
                <text x={10} y={18} style={{ fill: "var(--ink)", fontSize: 12, fontWeight: 600 }}>
                  {n.name}
                </text>
                <text x={10} y={34} style={{ fill: "var(--ink-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                  {n.detail}
                </text>
                {n.stale && <circle cx={n.width - 8} cy={8} r={4} style={{ fill: "var(--yellow)" }} />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
