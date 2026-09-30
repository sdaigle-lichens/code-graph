import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ConceptGraph, ConceptListResult } from "../../../shared/ipc";
import { api, message, unwrap } from "../lib/api";
import { useAsync } from "../lib/use-async";
import { defaultEnabledTypes, edgeCounts, layoutGraph, neighborsOf } from "../lib/graph-model";
import { DOCUMENTATION_EDGES } from "../lib/graph-palette";
import GraphCanvas from "../components/graph-canvas";
import EdgeToolbar from "../components/edge-toolbar";
import VertexPanel from "../components/vertex-panel";

export const Route = createFileRoute("/graph")({
  validateSearch: (s: Record<string, unknown>): { concept?: string } =>
    typeof s.concept === "string" && s.concept ? { concept: s.concept } : {},
  component: GraphPage,
});

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function GraphPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const concepts = useAsync<ConceptListResult>(async () => unwrap(await api.concept.list()), []);
  const withVertices = concepts.data?.concepts.filter((c) => c.liveVertices > 0) ?? [];
  const concept = search.concept ?? withVertices[0]?.name ?? null;

  const graph = useAsync<ConceptGraph | null>(
    async () => (concept ? unwrap(await api.concept.graph({ concept })) : null),
    [concept]
  );
  // A stale response for the previous concept is never drawn under the new selection.
  const data = graph.data && graph.data.concept === concept ? graph.data : null;

  const [toggled, setToggled] = useState<{ concept: string | null; enabled: Set<string> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2);
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);

  useEffect(() => setToggled(null), [concept]);

  const enabled = useMemo(
    () =>
      toggled && toggled.concept === concept
        ? toggled.enabled
        : data
          ? defaultEnabledTypes(data.edges)
          : new Set<string>(),
    [toggled, concept, data]
  );
  const counts = useMemo(() => (data ? edgeCounts(data.edges) : []), [data]);
  const laidOut = useMemo(() => {
    if (!data) return { layout: null, error: null };
    try {
      return { layout: layoutGraph(data, enabled), error: null };
    } catch (e) {
      return { layout: null, error: `Layout failed: ${message(e)}` };
    }
  }, [data, enabled]);
  const layout = laidOut.layout;

  // Keys are content hashes, stable across re-extraction, so a selection survives a refetch.
  const vertex = data && selected ? (data.vertices.find((v) => v._key === selected) ?? null) : null;
  const neighbors = useMemo(() => (data && vertex ? neighborsOf(data, vertex._key) : []), [data, vertex]);

  function toggle(type: string) {
    const next = new Set(enabled);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setToggled({ concept, enabled: next });
    // Turning documentation edges on: bring the skill-document hub into view.
    if (next.has(type) && DOCUMENTATION_EDGES.includes(type as never) && data?.doc)
      setFocus({ key: data.doc._key, n: (focus?.n ?? 0) + 1 });
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-(--line) px-4 py-3">
        <Link to="/project" className="text-xs text-(--ink-3) no-underline hover:text-(--ink)">
          ← Project
        </Link>
        <label className="flex items-center gap-2 text-xs text-(--ink-2)">
          Concept
          <select
            aria-label="Concept"
            value={concept ?? ""}
            disabled={withVertices.length === 0}
            onChange={(e) => {
              setSelected(null);
              void navigate({ to: "/graph", search: { concept: e.target.value } });
            }}
            className="rounded-md border border-(--line-2) bg-(--bg-elev) px-2 py-1 text-[13px] text-(--ink)"
          >
            {withVertices.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.liveVertices})
              </option>
            ))}
          </select>
        </label>
        {data && (
          <span className="text-xs text-(--ink-3)" data-testid="graph-summary">
            {data.vertices.length} vertices · {data.edges.length} edges
            {layout && layout.skipped > 0 ? ` · ${layout.skipped} skipped (no node in this concept)` : ""}
            {layout && layout.selfLoops > 0 ? ` · ${layout.selfLoops} self-references not drawn` : ""}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-xs text-(--ink-2)">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            className="cursor-pointer rounded border border-(--line-2) bg-(--bg-elev) px-2 py-0.5 text-(--ink)"
          >
            −
          </button>
          <span className="w-10 text-center font-mono">{Math.round(ZOOMS[zoom]! * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            className="cursor-pointer rounded border border-(--line-2) bg-(--bg-elev) px-2 py-0.5 text-(--ink)"
          >
            +
          </button>
        </div>
      </header>
      <div className="border-b border-(--line) px-4 py-2">
        <EdgeToolbar counts={counts} enabled={enabled} onToggle={toggle} />
      </div>

      {(concepts.error || graph.error || laidOut.error) && (
        <p className="m-0 px-4 py-2 text-[13px] text-(--red)">{concepts.error ?? graph.error ?? laidOut.error}</p>
      )}
      {!concepts.loading && !concepts.error && withVertices.length === 0 && (
        <p className="m-0 px-4 py-6 text-[13px] text-(--ink-3)">
          No concept has live vertices yet. Run the extract and apply pipeline first.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {layout && (
            <GraphCanvas
              layout={layout}
              scale={ZOOMS[zoom]!}
              selected={selected}
              focus={focus}
              onSelect={setSelected}
            />
          )}
          {graph.loading && !layout && <p className="m-0 px-4 py-6 text-[13px] text-(--ink-3)">Loading…</p>}
        </div>
        {vertex && (
          <VertexPanel vertex={vertex} neighbors={neighbors} onSelect={setSelected} onClose={() => setSelected(null)} />
        )}
      </div>
    </main>
  );
}
