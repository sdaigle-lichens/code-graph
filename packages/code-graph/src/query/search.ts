import type { DatabaseSync } from "node:sqlite";
import { preflight } from "./preflight.js";
import type { Vertex, Edge } from "../schema.js";
import { oneHop, twoHops, skillDoc, type DocVertex } from "./queries.js";
import { toDocs, toMatchExpr, vertexId } from "../scribe/rows.js";
import { FTS_WEIGHTS, ensureSearchIndexFormat } from "../scribe/bootstrap.js";
import { analyzeConceptGaps, fetchConceptCounts, isCompactGaps, type CompactGaps, type ConceptGap } from "./gaps.js";

export class SearchNoResultsError extends Error {
  constructor(query: string) {
    super(`no matches for "${query}"; try rephrasing or fall back to Explore`);
    this.name = "SearchNoResultsError";
  }
}

export type SearchHit = {
  vertex: Vertex | null;
  edges_in: Array<{ edge: Edge; from: Vertex }>;
  edges_out: Array<{ edge: Edge; to: Vertex }>;
  cross_edges: Array<{ edge: Edge; other: Vertex }>;
  bm25: number;
  degree: number;
  score: number;
};

export type SearchResult = {
  query: string;
  hits: SearchHit[];
  clusters: Array<{
    concept: string;
    skill: DocVertex | null;
    hits: SearchHit[];
  }>;
  totals: { concepts: number; vertices: number; docs: number; tokens: number };
  /** True when every hit came only through a skill doc (no vertex matched the query text). */
  docOnly?: boolean;
  confidence?: SearchConfidence;
};

/** Below this raw BM25 seed score the best match in the top cluster is too weak to act on (doc-only matches score ~1). */
export const LOW_CONFIDENCE_MIN_SCORE = 4;
/** A top concept with a smaller enriched share of its core (all live vertices when the core is empty) counts as mostly un-enriched. */
export const LOW_CONFIDENCE_MIN_ENRICHED = 0.5;

export type SearchConfidence = {
  low: boolean;
  /** Why the result is unreliable; set only when `low`. */
  reason?: string;
  /** The top cluster's SKILL.md path, named as the fallback to grep. */
  fallbackSkill?: string;
};

/**
 * Whether the top cluster can be trusted. Low when its best seed scores under
 * `LOW_CONFIDENCE_MIN_SCORE`, or its concept is un-enriched / under `LOW_CONFIDENCE_MIN_ENRICHED`
 * enriched. A top hit whose name equals the query is exact and always trusted: it needs no purpose.
 */
export function assessConfidence(
  top: { concept: string; skillPath: string | null; bestScore: number; exact: boolean } | null,
  gap: Pick<ConceptGap, "status" | "ratio" | "coreVertices" | "liveVertices"> | null
): SearchConfidence {
  if (!top || top.exact) return { low: false };
  // A concept with no live vertices is docs-only: its SKILL.md is the answer, there is nothing to enrich.
  if (gap?.status === "un-applied") return { low: false };
  const fallbackSkill = top.skillPath ?? undefined;
  if (top.bestScore < LOW_CONFIDENCE_MIN_SCORE) {
    return {
      low: true,
      reason: `weak match (best score ${top.bestScore.toFixed(1)} < ${LOW_CONFIDENCE_MIN_SCORE}) in concept ${top.concept}`,
      fallbackSkill,
    };
  }
  if (gap && (gap.status === "un-enriched" || gap.ratio < LOW_CONFIDENCE_MIN_ENRICHED)) {
    const share = Math.round(gap.ratio * 100);
    return {
      low: true,
      reason: `concept ${top.concept} is ${gap.status === "un-enriched" ? "un-enriched" : `mostly un-enriched (${share}% of ${gap.coreVertices > 0 ? "core " : ""}vertices have a purpose)`}, so ranking leans on names only`,
      fallbackSkill,
    };
  }
  return { low: false };
}

/** The one-line fallback printed under the totals when confidence is low. */
export function lowConfidenceLine(c: SearchConfidence): string {
  const skill = c.fallbackSkill ? `read the concept's SKILL.md (${c.fallbackSkill})` : "read the concept's SKILL.md";
  return `> Low confidence: ${c.reason}. Do not rely on these results alone; grep, or ${skill}.`;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

type EdgeGroup<V> = { edges: Edge[]; other: V; type: string };

/** Collapse edges between the same vertex pair with the same type (one stored edge per call site). */
function groupEdges<V>(items: Array<{ edge: Edge; other: V; otherKey: string }>): Array<EdgeGroup<V>> {
  const groups = new Map<string, EdgeGroup<V>>();
  for (const { edge, other, otherKey } of items) {
    const k = `${otherKey}|${edge.type}`;
    const g = groups.get(k);
    if (g) g.edges.push(edge);
    else groups.set(k, { edges: [edge], other, type: edge.type });
  }
  return Array.from(groups.values());
}

/** " (line 5)", " (lines 5, 9)" from the call sites carried by the edges, else " ×3" when repeated. */
function callSiteSuffix(edges: Edge[]): string {
  const lines = Array.from(new Set(edges.map((e) => e.line).filter((n): n is number => typeof n === "number"))).sort(
    (a, b) => a - b
  );
  if (lines.length === 1) return ` (line ${lines[0]})`;
  if (lines.length > 1) return ` (lines ${lines.join(", ")})`;
  return edges.length > 1 ? ` ×${edges.length}` : "";
}

/** One ` — why: "..."` per distinct reason, so the budget's reason-stripping regex removes them all. */
function whyText(edges: Edge[]): string {
  const reasons = Array.from(new Set(edges.map((e) => e.reason).filter((r): r is string => !!r)));
  return reasons.map((r) => ` — why: "${r}"`).join("");
}

/** How an inbound edge reads from the hit's side: `A calls hit` renders "← called by `A`". */
const INBOUND_LABELS: Record<Edge["type"], string> = {
  calls: "called by",
  reads: "read by",
  writes: "written by",
  mounts: "mounted by",
  subscribes: "subscribed to by",
  "uses-hook": "used as a hook by",
  "delegates-to": "delegated to by",
  "has-type": "type of",
  triggers: "triggered by",
  describes: "described by",
  "documented-by": "documents",
};

function inboundLabel(type: string): string {
  return INBOUND_LABELS[type as Edge["type"]] ?? `${type} from`;
}

function appendToMap<T>(map: Map<string, T[]>, key: string, item: T): void {
  const existing = map.get(key);
  if (existing) existing.push(item);
  else map.set(key, [item]);
}

async function expandVertex(
  db: DatabaseSync,
  vertex: Vertex,
  bm25: number,
  vertexMap: Map<string, { vertex: Vertex; bm25: number }>,
  edgesInMap: Map<string, Array<{ edge: Edge; from: Vertex }>>,
  edgesOutMap: Map<string, Array<{ edge: Edge; to: Vertex }>>,
  crossEdgesMap: Map<string, Array<{ edge: Edge; other: Vertex }>>,
  incidentEdges: Map<string, Set<string>>,
  skillDocs: Map<string, DocVertex | null>
): Promise<void> {
  const key = vertex._key;

  const existing = vertexMap.get(key);
  if (!existing || bm25 > existing.bm25) {
    vertexMap.set(key, { vertex, bm25 });
  }

  if (!skillDocs.has(vertex.concept)) {
    skillDocs.set(vertex.concept, skillDoc(db, vertex.concept));
  }

  collectEdges(db, key, { vertexMap, edgesInMap, edgesOutMap, crossEdgesMap, incidentEdges }, true);
}

type EdgeMaps = {
  vertexMap: Map<string, { vertex: Vertex; bm25: number }>;
  edgesInMap: Map<string, Array<{ edge: Edge; from: Vertex }>>;
  edgesOutMap: Map<string, Array<{ edge: Edge; to: Vertex }>>;
  crossEdgesMap: Map<string, Array<{ edge: Edge; other: Vertex }>>;
  incidentEdges: Map<string, Set<string>>;
};

/**
 * One-hop structural/impact/cross edges for `key`. With `addNeighbors` the far
 * ends join `vertexMap` (vertex seeds); without it they only appear in the edge
 * lists (doc-loaded vertices, where pulling neighbours in would flood the result).
 */
function collectEdges(db: DatabaseSync, key: string, maps: EdgeMaps, addNeighbors: boolean): void {
  const { vertexMap, edgesInMap, edgesOutMap, crossEdgesMap, incidentEdges } = maps;
  const trackEdge = (edgeKey: string, ...vkeys: string[]) => {
    for (const vk of vkeys) {
      let s = incidentEdges.get(vk);
      if (!s) {
        s = new Set();
        incidentEdges.set(vk, s);
      }
      s.add(edgeKey);
    }
  };
  const addVertex = (v: Vertex) => {
    if (addNeighbors && !vertexMap.has(v._key)) vertexMap.set(v._key, { vertex: v, bm25: 0 });
  };

  const structuralTypes = ["calls", "reads", "writes", "uses-hook", "mounts", "has-type"];
  const startId = vertexId(key);
  for (const row of oneHop(db, "out", startId, structuralTypes)) {
    addVertex(row.vertex);
    appendToMap(edgesOutMap, key, { edge: row.edge, to: row.vertex });
    trackEdge(row.edge._key, key, row.vertex._key);
  }

  const impactTypes = ["calls", "triggers", "delegates-to"];
  // Depth-2 rows are attributed to the seed as well, which inflates its degree
  // — an oddity of the original traversal that the scores and the rendered
  // "triggered by" list both depend on, so it is reproduced rather than fixed.
  for (const row of twoHops(db, "in", startId, impactTypes, -1)) {
    addVertex(row.vertex);
    appendToMap(edgesInMap, key, { edge: row.edge, from: row.vertex });
    trackEdge(row.edge._key, key, row.vertex._key);
  }

  const crossRows = [...oneHop(db, "in", startId, null, true), ...oneHop(db, "out", startId, null, true)];
  for (const row of crossRows) {
    addVertex(row.vertex);
    appendToMap(crossEdgesMap, key, { edge: row.edge, other: row.vertex });
    trackEdge(row.edge._key, key, row.vertex._key);
  }
}

/** Most vertices a skill-doc seed contributes per concept, ranked by degree. */
const DOC_VERTEX_CAP = 20;

async function expandDoc(
  db: DatabaseSync,
  doc: DocVertex,
  maps: EdgeMaps,
  skillDocs: Map<string, DocVertex | null>,
  loadVertices: boolean
): Promise<void> {
  if (!skillDocs.has(doc.concept)) {
    skillDocs.set(doc.concept, doc);
  }

  if (!loadVertices) return;

  const rows = toDocs<Vertex>(
    db
      .prepare("SELECT doc FROM vertices WHERE concept = ? AND status = 'live' ORDER BY type, key")
      .all(doc.concept) as { doc: string }[]
  );
  // Give each loaded vertex its one-hop edges (so it has a real degree), then
  // keep only the best-connected DOC_VERTEX_CAP: a concept can hold hundreds.
  const loaded: Array<{ v: Vertex; degree: number }> = [];
  for (const v of rows) {
    if (maps.vertexMap.has(v._key)) continue;
    collectEdges(db, v._key, maps, false);
    loaded.push({ v, degree: maps.incidentEdges.get(v._key)?.size ?? 0 });
  }
  loaded.sort((a, b) => b.degree - a.degree); // stable: ties keep type,key order
  for (const { v } of loaded.slice(0, DOC_VERTEX_CAP)) {
    maps.vertexMap.set(v._key, { vertex: v, bm25: 0 });
  }
}

export type SkillMode = "names" | "full";

export async function search(
  query: string,
  opts: { maxTokens: number; json: boolean; skillMode?: SkillMode }
): Promise<SearchResult> {
  const { db: store } = await preflight();
  // stderr: `--json` keeps stdout parseable.
  if (ensureSearchIndexFormat(store) === "unwritable") {
    console.error("search index predates this code-graph and the store is read-only: run `code-graph reindex`");
  }
  return searchStore(store, query, opts);
}

export async function searchStore(
  store: DatabaseSync,
  query: string,
  opts: { maxTokens: number; json: boolean; skillMode?: SkillMode }
): Promise<SearchResult> {
  const match = toMatchExpr(query);
  if (match === null) throw new SearchNoResultsError(query);

  // The ArangoSearch view scored five boosted clauses at once. FTS5 has no
  // per-clause boost, so the four token boosts become bm25() column weights and
  // the exact-name boost becomes a sort tier: a direct symbol hit outranks every
  // token match outright, rather than relying on a multiplier being big enough.
  const w = `${FTS_WEIGHTS.name}, ${FTS_WEIGHTS.purpose}, ${FTS_WEIGHTS.tags}, ${FTS_WEIGHTS.body_md}`;
  const seeds = (
    store
      .prepare(
        `WITH seed AS (
           SELECT ref_kind, ref_key, -bm25(search_fts, 0.0, 0.0, ${w}) AS base
             FROM search_fts
            WHERE search_fts MATCH ?
         )
         SELECT s.ref_kind AS kind,
                coalesce(v.doc, d.doc) AS doc,
                CASE WHEN v.key IS NOT NULL AND lower(v.name) = lower(?) THEN 1 ELSE 0 END AS exact,
                s.base AS base
           FROM seed s
           LEFT JOIN vertices v ON s.ref_kind = 'vertex' AND v.key = s.ref_key
           LEFT JOIN docs     d ON s.ref_kind = 'doc'    AND d.key = s.ref_key
          WHERE coalesce(v.doc, d.doc) IS NOT NULL
          ORDER BY exact DESC, base DESC
          LIMIT 10`
      )
      .all(match, query) as Array<{ kind: string; doc: string; exact: number; base: number }>
  ).map((r) => ({
    kind: r.kind,
    doc: JSON.parse(r.doc) as Record<string, unknown>,
    // Keep the old 5-vs-3 ratio between an exact name hit and a token name hit,
    // so the 0.7-weighted score term keeps roughly its previous shape.
    score: r.exact ? r.base * (5 / 3) : r.base,
  }));

  if (seeds.length === 0) {
    throw new SearchNoResultsError(query);
  }

  const vertexMap = new Map<string, { vertex: Vertex; bm25: number }>();
  const edgesInMap = new Map<string, Array<{ edge: Edge; from: Vertex }>>();
  const edgesOutMap = new Map<string, Array<{ edge: Edge; to: Vertex }>>();
  const crossEdgesMap = new Map<string, Array<{ edge: Edge; other: Vertex }>>();
  const incidentEdges = new Map<string, Set<string>>();
  const skillDocs = new Map<string, DocVertex | null>();

  const vertexSeeds = seeds.filter((s) => s.kind === "vertex");
  const docSeeds = seeds.filter((s) => s.kind !== "vertex");
  const docLoadsVertices = vertexSeeds.length === 0;

  for (let i = 0; i < vertexSeeds.length; i += 5) {
    await Promise.all(
      vertexSeeds
        .slice(i, i + 5)
        .map((seed) =>
          expandVertex(
            store,
            seed.doc as unknown as Vertex,
            seed.score,
            vertexMap,
            edgesInMap,
            edgesOutMap,
            crossEdgesMap,
            incidentEdges,
            skillDocs
          )
        )
    );
  }

  for (let i = 0; i < docSeeds.length; i += 5) {
    await Promise.all(
      docSeeds
        .slice(i, i + 5)
        .map((seed) =>
          expandDoc(
            store,
            seed.doc as unknown as DocVertex,
            { vertexMap, edgesInMap, edgesOutMap, crossEdgesMap, incidentEdges },
            skillDocs,
            docLoadsVertices
          )
        )
    );
  }

  // Fetch skill docs for concepts discovered only via expansion
  const conceptsToFetch = Array.from(new Set(Array.from(vertexMap.values()).map((v) => v.vertex.concept))).filter(
    (c) => !skillDocs.has(c)
  );

  for (const concept of conceptsToFetch) {
    skillDocs.set(concept, skillDoc(store, concept));
  }

  const maxBm25 = Math.max(...Array.from(vertexMap.values()).map((v) => v.bm25), 1);
  const maxDegree = Math.max(...Array.from(incidentEdges.values()).map((s) => s.size), 1);

  const hits: SearchHit[] = Array.from(vertexMap.entries()).map(([key, { vertex, bm25 }]) => {
    const degree = incidentEdges.get(key)?.size ?? 0;
    const score = (bm25 / maxBm25) * 0.7 + (degree / maxDegree) * 0.3;
    return {
      vertex,
      edges_in: edgesInMap.get(key) ?? [],
      edges_out: edgesOutMap.get(key) ?? [],
      cross_edges: crossEdgesMap.get(key) ?? [],
      bm25,
      degree,
      score,
    };
  });

  hits.sort((a, b) => b.score - a.score);

  const conceptToHits = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const concept = hit.vertex?.concept ?? "__unknown__";
    const arr = conceptToHits.get(concept) ?? [];
    arr.push(hit);
    conceptToHits.set(concept, arr);
  }

  const clusters = Array.from(conceptToHits.entries())
    .map(([concept, clusterHits]) => ({
      concept,
      skill: skillDocs.get(concept) ?? null,
      hits: clusterHits,
    }))
    .sort((a, b) => {
      const maxA = Math.max(...a.hits.map((h) => h.score));
      const maxB = Math.max(...b.hits.map((h) => h.score));
      return maxB - maxA;
    });

  // A docs-only concept has a skill doc and no vertices, so no hit would ever put it in a cluster.
  // Surface it (after the code clusters) when its doc was itself a search seed.
  for (const seed of docSeeds) {
    const concept = (seed.doc as unknown as DocVertex).concept;
    if (conceptToHits.has(concept) || clusters.some((c) => c.concept === concept)) continue;
    const live = store.prepare("SELECT 1 FROM vertices WHERE concept = ? AND status = 'live' LIMIT 1").get(concept);
    if (live) continue;
    clusters.push({ concept, skill: skillDocs.get(concept) ?? null, hits: [] });
  }

  const topCluster = clusters[0];
  let confidence: SearchConfidence = { low: false };
  if (topCluster) {
    const counts = await fetchConceptCounts(store, { core: true });
    const [gap] = analyzeConceptGaps([{ name: topCluster.concept, enrichable: true }], counts).concepts;
    const lq = query.toLowerCase();
    confidence = assessConfidence(
      {
        concept: topCluster.concept,
        skillPath: topCluster.skill?.path ?? null,
        bestScore: Math.max(0, ...topCluster.hits.map((h) => h.bm25)),
        exact: topCluster.hits.some((h) => h.vertex?.name.toLowerCase() === lq),
      },
      gap ?? null
    );
  }

  const totalVertices = hits.filter((h) => h.vertex !== null).length;
  const totalDocs = Array.from(skillDocs.values()).filter((d) => d !== null).length;

  const result: SearchResult = {
    query,
    hits,
    clusters,
    totals: { concepts: clusters.length, vertices: totalVertices, docs: totalDocs, tokens: 0 },
    docOnly: vertexSeeds.length === 0,
    confidence,
  };
  formatSearch(result, { skillMode: opts.skillMode }); // populates totals.tokens
  return result;
}

export function formatSearch(result: SearchResult, opts?: { skillMode?: SkillMode }): string {
  const { query, clusters, totals } = result;
  const skillMode = opts?.skillMode ?? "names";
  const lines: string[] = [];

  lines.push(`# Search: "${query}"`);
  lines.push("__TOTALS_PLACEHOLDER__");
  if (result.confidence?.low) lines.push(lowConfidenceLine(result.confidence));
  if (result.docOnly) {
    lines.push(
      "> Hint: matched only through skill docs; enrich the concept with the `scribe` skill to make its vertices searchable by purpose and tags."
    );
  }
  lines.push("");

  for (const { concept, skill, hits } of clusters) {
    lines.push(`## Concept: ${concept}`);
    lines.push("");

    if (skill) {
      if (skillMode === "full" && skill.body_md) {
        lines.push("### Skill (invariants, algorithms, gotchas)");
        lines.push("");
        lines.push("<!--SKILL_START-->");
        lines.push(skill.body_md);
        lines.push("<!--SKILL_END-->");
        lines.push("");
      } else if (skillMode === "names") {
        lines.push(`> Skill: \`${skill.concept}\` (${skill.path})`);
        lines.push("");
      }
    }

    const vertexHits = hits.filter((h) => h.vertex !== null);
    if (vertexHits.length > 0) {
      lines.push("### Relevant code");
      lines.push("");
      for (const hit of vertexHits) {
        const v = hit.vertex!;
        const loc = `@${v.filepath}:${v.start_line}-${v.end_line}`;
        // An un-enriched hit is marked so an agent can tell it apart from "nothing to say"
        // and report it through the gap channel (code-graph-retrieval). --json is unchanged.
        const purpose = v.purpose ? ` — ${v.purpose}` : " — _not enriched_";
        lines.push(`- ${loc} — \`${v.name}\`${purpose}`);

        const ins = hit.edges_in.map(({ edge, from }) => ({ edge, other: from, otherKey: from._key }));
        for (const g of groupEdges(ins)) {
          const f = g.other;
          lines.push(
            `  - ← ${inboundLabel(g.type)} \`${f.name}\` at ${f.filepath}:${f.start_line}${callSiteSuffix(g.edges)}${whyText(g.edges)}`
          );
        }
        const outs = hit.edges_out.map(({ edge, to }) => ({ edge, other: to, otherKey: to._key }));
        for (const g of groupEdges(outs)) {
          const t = g.other;
          lines.push(`  - → ${g.type} \`${t.name}\` (${t.concept})${callSiteSuffix(g.edges)}${whyText(g.edges)}`);
        }
      }
      lines.push("");
    }

    const allCross = vertexHits.flatMap((h) => h.cross_edges.map((ce) => ({ hit: h, ...ce })));
    const crossGroups = new Map<string, { hit: SearchHit; other: Vertex; edges: Edge[] }>();
    for (const c of allCross) {
      const k = `${c.edge._from}|${c.edge._to}|${c.edge.type}`;
      const g = crossGroups.get(k);
      if (!g) crossGroups.set(k, { hit: c.hit, other: c.other, edges: [c.edge] });
      else if (!g.edges.some((e) => e._key === c.edge._key)) g.edges.push(c.edge);
    }
    const uniqueCross = Array.from(crossGroups.values());
    if (uniqueCross.length > 0) {
      lines.push("### Cross-concept side effects");
      lines.push("");
      for (const { hit, edges, other } of uniqueCross) {
        const edge = edges[0];
        const isOut = edge._from === `vertices/${hit.vertex!._key}`;
        const fromName = isOut ? hit.vertex!.name : other.name;
        const toName = isOut ? other.name : hit.vertex!.name;
        const reasons = Array.from(new Set(edges.map((e) => e.reason).filter((r): r is string => !!r)));
        const reason = reasons.map((r) => ` — ${r}`).join("");
        lines.push(
          `- → **${other.concept}** — \`${fromName}\` ${edge.type} \`${toName}\`${callSiteSuffix(edges)}${reason}`
        );
      }
      lines.push("");
    }
  }

  return withTotals(lines.join("\n"), totals, result);
}

const TOTALS_LINE_RE = /^> \d+ concepts matched, .*$/m;

/** Fill the totals line so its token figure is the size of the text it sits in. */
function withTotals(body: string, totals: SearchResult["totals"], result?: SearchResult): string {
  const line = (t: number) =>
    `> ${totals.concepts} concepts matched, ${totals.vertices} vertices, ${totals.docs} skill docs, ~${t} tokens`;
  let tokens = estimateTokens(body.replace("__TOTALS_PLACEHOLDER__", line(0)));
  for (let i = 0; i < 3; i++) {
    const next = estimateTokens(body.replace("__TOTALS_PLACEHOLDER__", line(tokens)));
    if (next === tokens) break;
    tokens = next;
  }
  if (result) result.totals.tokens = tokens;
  return body.replace("__TOTALS_PLACEHOLDER__", line(tokens));
}

/** Re-state the totals line of already-trimmed markdown with the size actually printed. */
function restateTokens(md: string): string {
  const m = TOTALS_LINE_RE.exec(md);
  if (!m) return md;
  const set = (t: number) => md.replace(TOTALS_LINE_RE, m[0].replace(/~\d+ tokens/, `~${t} tokens`));
  let tokens = estimateTokens(md);
  for (let i = 0; i < 3; i++) {
    const next = estimateTokens(set(tokens));
    if (next === tokens) break;
    tokens = next;
  }
  return set(tokens);
}

export function applyTokenBudget(result: SearchResult, maxTokens: number, opts?: { skillMode?: SkillMode }): string {
  const done = (text: string) => restateTokens(stripSentinels(text));
  let md = formatSearch(result, opts);
  if (estimateTokens(md) <= maxTokens) return done(md);

  // Step 1: drop edge reason strings
  md = md.replace(/ — why: "[^"]*"/g, "");
  if (estimateTokens(md) <= maxTokens) return done(md);

  // Step 2: drop low-degree leaves (degree ≤ 1, not seeds)
  // A cluster whose hits would all be dropped (doc-seeded concepts) keeps its
  // best few, so trimming never removes the concept itself.
  const filtered: SearchResult = {
    ...result,
    clusters: result.clusters.map((c) => {
      const kept = c.hits.filter((h) => h.degree > 1 || h.bm25 > 0);
      return { ...c, hits: kept.length > 0 || c.hits.length === 0 ? kept : c.hits.slice(0, 5) };
    }),
    totals: { ...result.totals },
  };
  filtered.totals.vertices = filtered.clusters.reduce((n, c) => n + c.hits.length, 0);
  filtered.totals.concepts = filtered.clusters.length;

  md = formatSearch(filtered, opts).replace(/ — why: "[^"]*"/g, "");
  if (estimateTokens(md) <= maxTokens) return done(md);

  // Step 3: truncate skill body between sentinels to first ~2000 chars
  const skillBlockRe = /<!--SKILL_START-->\n([\s\S]*?)\n<!--SKILL_END-->/g;
  const truncated = md.replace(skillBlockRe, (_, body: string) => {
    if (body.length <= 2000) return `<!--SKILL_START-->\n${body}\n<!--SKILL_END-->`;
    return `<!--SKILL_START-->\n${body.slice(0, 2000)}\n\n_[skill body truncated]_\n<!--SKILL_END-->`;
  });
  if (estimateTokens(truncated) <= maxTokens) return done(truncated);
  md = truncated;

  return done(md.slice(0, maxTokens * 4) + "\n\n_[truncated]_");
}

function stripSentinels(s: string): string {
  return s.replace(/<!--SKILL_(START|END)-->\n?/g, "");
}

export type SearchJsonDropped = {
  hits: number;
  edges: number;
  clusters: number;
  skillBodiesTruncated: number;
  /** Concept lines cut from the compact `gaps` block. */
  gaps: number;
};

/**
 * The `search --json` payload trimmed to `maxTokens` (same 4-chars-per-token estimate as the plain-text
 * budget). `extra` (strength, gaps) is always kept and counted against the budget. Order: lowest-ranked
 * hits and their edges first (down to the single best hit), then skill bodies, then edge lists and
 * vertex payloads inside the surviving hits (capped 10, 3, 0 per list, vertices and edges slimmed;
 * counted in `dropped.edges`), and only then the last hit and emptied clusters. Same shape; adds `truncated: true` and `dropped` counts only when it trims.
 */
export function budgetSearchJson(
  result: SearchResult,
  extra: Record<string, unknown>,
  maxTokens: number
): Record<string, unknown> {
  // A compact `gaps` block (CompactGaps) is trimmed before any hit is: all lines, then the concepts
  // the results are about (or the first 3), then counts only. Any other `gaps` shape is opaque.
  const gaps = isCompactGaps(extra.gaps) ? (extra.gaps as CompactGaps) : null;
  const relevant = new Set(result.clusters.map((c) => c.concept));
  const gapLines = (level: number): string[] => {
    if (!gaps || level === 0) return gaps?.concepts ?? [];
    if (level >= 2) return [];
    const hit = gaps.concepts.filter((l) => relevant.has(l.slice(0, l.indexOf(":"))));
    return hit.length > 0 ? hit : gaps.concepts.slice(0, 3);
  };
  let gapLevel = 0;
  const render = (r: SearchResult, meta?: Record<string, unknown>) => ({
    ...r,
    ...extra,
    ...(gaps ? { gaps: { ...gaps, concepts: gapLines(gapLevel) } } : {}),
    ...meta,
  });
  const size = (o: unknown) => estimateTokens(JSON.stringify(o, null, 2));
  const gapsDropped = () => (gaps ? gaps.concepts.length - gapLines(gapLevel).length : 0);
  if (size(render(result)) <= maxTokens) return render(result);
  if (gaps) {
    for (gapLevel = 1; gapLevel <= 2; gapLevel++) {
      const trimmed = render(result, {
        truncated: true,
        dropped: { hits: 0, edges: 0, clusters: 0, skillBodiesTruncated: 0, gaps: gapsDropped() },
      });
      if (size(trimmed) <= maxTokens) return trimmed;
    }
    gapLevel = 2;
  }

  const edgeCount = (h: SearchHit) => h.edges_in.length + h.edges_out.length + h.cross_edges.length;
  const ranked = Array.from(new Set(result.hits.concat(result.clusters.flatMap((c) => c.hits)))).sort(
    (a, b) => b.score - a.score
  );
  const dropped: SearchJsonDropped = { hits: 0, edges: 0, clusters: 0, skillBodiesTruncated: 0, gaps: gapsDropped() };
  const gone = new Set<SearchHit>();
  let skillLimit: number | null = null;
  // Per-hit compaction: cap each edge list and slim the vertices/edges inside it. null = untouched.
  let edgeCap: number | null = null;
  let slimVertex = false;
  const SLIM_V = ["_key", "concept", "type", "name", "filepath", "start_line", "end_line"];
  const SLIM_E = ["_key", "_from", "_to", "type", "concept", "crosses_concept", "line"];
  const pick = <T>(o: T, keys: string[]): T => {
    if (!o || typeof o !== "object") return o;
    const src = o as Record<string, unknown>;
    return Object.fromEntries(keys.filter((k) => k in src).map((k) => [k, src[k]])) as T;
  };
  const compacted = new Map<SearchHit, SearchHit>();
  const view = (h: SearchHit): SearchHit => {
    if (edgeCap === null) return h;
    const hit = compacted.get(h);
    if (hit) return hit;
    const cap = edgeCap;
    const made: SearchHit = {
      ...h,
      vertex: slimVertex ? pick(h.vertex, SLIM_V) : h.vertex,
      edges_in: h.edges_in.slice(0, cap).map((x) => ({ edge: pick(x.edge, SLIM_E), from: pick(x.from, SLIM_V) })),
      edges_out: h.edges_out.slice(0, cap).map((x) => ({ edge: pick(x.edge, SLIM_E), to: pick(x.to, SLIM_V) })),
      cross_edges: h.cross_edges
        .slice(0, cap)
        .map((x) => ({ edge: pick(x.edge, SLIM_E), other: pick(x.other, SLIM_V) })),
    };
    compacted.set(h, made);
    return made;
  };
  const setCompaction = (cap: number | null, slim: boolean) => {
    edgeCap = cap;
    slimVertex = slim;
    compacted.clear();
  };

  const build = () => {
    dropped.edges = 0;
    for (const h of ranked) {
      if (gone.has(h)) dropped.edges += edgeCount(h);
      else if (edgeCap !== null) dropped.edges += edgeCount(h) - edgeCount(view(h));
    }
    const clusters = result.clusters
      .map((c) => ({
        ...c,
        hits: c.hits.filter((h) => !gone.has(h)).map(view),
        skill:
          c.skill && skillLimit !== null && c.skill.body_md.length > skillLimit
            ? { ...c.skill, body_md: c.skill.body_md.slice(0, skillLimit) }
            : c.skill,
      }))
      .filter((c) => c.hits.length > 0 || gone.size === 0);
    dropped.clusters = result.clusters.length - clusters.length;
    dropped.skillBodiesTruncated =
      skillLimit === null ? 0 : result.clusters.filter((c) => c.skill && c.skill.body_md.length > skillLimit!).length;
    const kept = { ...result, hits: result.hits.filter((h) => !gone.has(h)).map(view), clusters };
    return render(kept, { truncated: true, dropped: { ...dropped } });
  };
  const drop = (h: SearchHit) => {
    gone.add(h);
    dropped.hits++;
  };

  let out = build();
  const fits = () => size(out) <= maxTokens;
  const attempt = (cap: number | null, minKeep: number): boolean => {
    gone.clear();
    dropped.hits = 0;
    skillLimit = null;
    setCompaction(cap, cap !== null);
    out = build();
    for (let i = ranked.length - 1; i >= minKeep && !fits(); i--) {
      drop(ranked[i]);
      out = build();
    }
    for (const limit of [2000, 500, 0]) {
      if (fits()) break;
      skillLimit = limit;
      out = build();
    }
    return fits();
  };
  // Prefer several compacted hits over one full one; keep the best hit before giving it up.
  let ok = false;
  for (const keep of Array.from(new Set([Math.min(5, ranked.length), 1]))) {
    for (const cap of [null, 10, 3, 0]) {
      if ((ok = attempt(cap, keep))) break;
    }
    if (ok) break;
  }
  if (!ok && ranked.length > 0) {
    drop(ranked[0]);
    out = build();
  }
  return out;
}
