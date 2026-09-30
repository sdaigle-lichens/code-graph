import type { GraphVertex } from "../../../shared/ipc";
import type { Neighbor } from "../lib/graph-model";
import { edgeStyle, nodeStyle } from "../lib/graph-palette";
import Badge from "./badge";

function List({ label, items }: { label: string; items: string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <section>
      <h3 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--ink-3)">{label}</h3>
      <ul className="m-0 list-none space-y-0.5 p-0 font-mono text-xs text-(--ink-2)">
        {items.map((i, n) => (
          <li key={`${i}-${n}`}>{i}</li>
        ))}
      </ul>
    </section>
  );
}

interface Props {
  vertex: GraphVertex;
  neighbors: Neighbor[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

export default function VertexPanel({ vertex, neighbors, onSelect, onClose }: Props) {
  const stale = vertex.agent?.stale === true;
  const groups = new Map<string, Neighbor[]>();
  for (const n of neighbors) {
    const k = `${n.direction}:${n.edgeType}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return (
    <aside
      aria-label="Vertex details"
      data-testid="vertex-panel"
      className="h-full w-96 shrink-0 space-y-4 overflow-y-auto border-l border-(--line) bg-(--bg-elev) p-4"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 break-words text-base font-bold text-(--ink)">{vertex.name}</h2>
          <span
            className="mt-1 inline-block rounded border px-1.5 py-0.5 text-[11px] text-(--ink-2)"
            style={{ borderColor: nodeStyle(vertex.type).stroke, background: nodeStyle(vertex.type).fill }}
          >
            {vertex.type}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="cursor-pointer border-0 bg-transparent text-lg leading-none text-(--ink-3) hover:text-(--ink)"
        >
          ×
        </button>
      </header>

      <div data-testid="vertex-location" className="break-all font-mono text-xs text-(--ink-2)">
        {vertex.filepath}:{vertex.start_line}-{vertex.end_line}
      </div>

      <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-md bg-(--bg-2) p-2 font-mono text-xs text-(--ink)">
        {vertex.signature}
      </pre>

      <section>
        <h3 className="m-0 mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-(--ink-3)">
          Purpose
          {stale && <Badge tone="warn">Stale</Badge>}
        </h3>
        {vertex.purpose ? (
          <p className="m-0 text-[13px] text-(--ink)">{vertex.purpose}</p>
        ) : (
          <p className="m-0 text-xs text-(--ink-3)">No agent-written purpose yet.</p>
        )}
        {stale && (
          <p data-testid="stale-note" className="m-0 mt-1 text-xs text-(--yellow)">
            The body changed after this purpose was written.
          </p>
        )}
      </section>

      <List label="Inputs" items={vertex.inputs} />
      <List label="Outputs" items={vertex.outputs} />
      {vertex.tags && vertex.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {vertex.tags.map((t) => (
            <span key={t} className="rounded-full border border-(--line) px-2 py-0.5 text-[11px] text-(--ink-2)">
              {t}
            </span>
          ))}
        </div>
      )}

      <section>
        <h3 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--ink-3)">
          Neighbors ({neighbors.length})
        </h3>
        {neighbors.length === 0 && <p className="m-0 text-xs text-(--ink-3)">No edges.</p>}
        {[...groups.entries()].map(([k, list]) => (
          <div key={k} className="mb-2" data-neighbor-group={k}>
            <div className="flex items-center gap-1.5 text-[11px] text-(--ink-3)">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4"
                style={{ background: edgeStyle(list[0]!.edgeType).stroke }}
              />
              {list[0]!.direction === "out" ? `${list[0]!.edgeType} →` : `← ${list[0]!.edgeType}`}
            </div>
            <ul className="m-0 list-none p-0">
              {list.map((n) => (
                <li key={n.edgeKey} className="text-xs">
                  {n.vertex ? (
                    <button
                      type="button"
                      data-neighbor={n.key}
                      onClick={() => onSelect(n.key)}
                      className="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-(--primary) hover:underline"
                    >
                      {n.vertex.name}
                    </button>
                  ) : (
                    <span className="font-mono text-(--ink-3)">
                      {n.isDoc ? "skill document" : `${n.key.slice(0, 12)} (outside this concept)`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </aside>
  );
}
