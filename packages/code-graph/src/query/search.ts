import type { DatabaseSync } from "node:sqlite";
import { preflight } from "./preflight.js";
import type { Vertex, Edge } from "../schema.js";
import { oneHop, twoHops, skillDoc, type DocVertex } from "./queries.js";
import { toDocs, toMatchExpr, vertexId } from "../scribe/rows.js";
import { FTS_WEIGHTS } from "../scribe/bootstrap.js";

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
};

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
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

  const structuralTypes = ["calls", "reads", "writes", "uses-hook", "mounts", "has-type"];
  const startId = vertexId(key);
  for (const row of oneHop(db, "out", startId, structuralTypes)) {
    if (!vertexMap.has(row.vertex._key)) vertexMap.set(row.vertex._key, { vertex: row.vertex, bm25: 0 });
    appendToMap(edgesOutMap, key, { edge: row.edge, to: row.vertex });
    trackEdge(row.edge._key, key, row.vertex._key);
  }

  const impactTypes = ["calls", "triggers", "delegates-to"];
  // Depth-2 rows are attributed to the seed as well, which inflates its degree
  // — an oddity of the original traversal that the scores and the rendered
  // "triggered by" list both depend on, so it is reproduced rather than fixed.
  for (const row of twoHops(db, "in", startId, impactTypes, -1)) {
    if (!vertexMap.has(row.vertex._key)) vertexMap.set(row.vertex._key, { vertex: row.vertex, bm25: 0 });
    appendToMap(edgesInMap, key, { edge: row.edge, from: row.vertex });
    trackEdge(row.edge._key, key, row.vertex._key);
  }

  const crossRows = [...oneHop(db, "in", startId, null, true), ...oneHop(db, "out", startId, null, true)];
  for (const row of crossRows) {
    if (!vertexMap.has(row.vertex._key)) vertexMap.set(row.vertex._key, { vertex: row.vertex, bm25: 0 });
    appendToMap(crossEdgesMap, key, { edge: row.edge, other: row.vertex });
    trackEdge(row.edge._key, key, row.vertex._key);
  }
}

async function expandDoc(
  db: DatabaseSync,
  doc: DocVertex,
  vertexMap: Map<string, { vertex: Vertex; bm25: number }>,
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
  for (const v of rows) {
    if (!vertexMap.has(v._key)) vertexMap.set(v._key, { vertex: v, bm25: 0 });
  }
}

export type SkillMode = "names" | "full";

export async function search(
  query: string,
  opts: { maxTokens: number; json: boolean; skillMode?: SkillMode }
): Promise<SearchResult> {
  const { db: store } = await preflight();

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
        .map((seed) => expandDoc(store, seed.doc as unknown as DocVertex, vertexMap, skillDocs, docLoadsVertices))
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

  const totalVertices = hits.filter((h) => h.vertex !== null).length;
  const totalDocs = Array.from(skillDocs.values()).filter((d) => d !== null).length;

  const result: SearchResult = {
    query,
    hits,
    clusters,
    totals: { concepts: clusters.length, vertices: totalVertices, docs: totalDocs, tokens: 0 },
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
        const purpose = v.purpose ? ` — ${v.purpose}` : "";
        lines.push(`- ${loc} — \`${v.name}\`${purpose}`);

        for (const { edge: e, from: f } of hit.edges_in) {
          const reason = e.reason ? ` — why: "${e.reason}"` : "";
          lines.push(`  - ← triggered by \`${f.name}\` at ${f.filepath}:${f.start_line}${reason}`);
        }
        for (const { edge: e, to: t } of hit.edges_out) {
          const reason = e.reason ? ` — why: "${e.reason}"` : "";
          lines.push(`  - → ${e.type} \`${t.name}\` (${t.concept})${reason}`);
        }
      }
      lines.push("");
    }

    const allCross = vertexHits.flatMap((h) => h.cross_edges.map((ce) => ({ hit: h, ...ce })));
    const uniqueCross = Array.from(new Map(allCross.map((c) => [c.edge._key, c])).values());
    if (uniqueCross.length > 0) {
      lines.push("### Cross-concept side effects");
      lines.push("");
      for (const { hit, edge, other } of uniqueCross) {
        const isOut = edge._from === `vertices/${hit.vertex!._key}`;
        const fromName = isOut ? hit.vertex!.name : other.name;
        const toName = isOut ? other.name : hit.vertex!.name;
        const reason = edge.reason ? ` — ${edge.reason}` : "";
        lines.push(`- → **${other.concept}** — \`${fromName}\` ${edge.type} \`${toName}\`${reason}`);
      }
      lines.push("");
    }
  }

  const body = lines.join("\n");
  const tokens = estimateTokens(body);
  result.totals.tokens = tokens;

  const totalsLine = `> ${totals.concepts} concepts matched, ${totals.vertices} vertices, ${totals.docs} skill docs, ~${tokens} tokens`;
  return body.replace("__TOTALS_PLACEHOLDER__", totalsLine);
}

export function applyTokenBudget(result: SearchResult, maxTokens: number, opts?: { skillMode?: SkillMode }): string {
  let md = formatSearch(result, opts);
  if (estimateTokens(md) <= maxTokens) return stripSentinels(md);

  // Step 1: drop edge reason strings
  md = md.replace(/ — why: "[^"]*"/g, "");
  if (estimateTokens(md) <= maxTokens) return stripSentinels(md);

  // Step 2: drop low-degree leaves (degree ≤ 1, not seeds)
  const filtered: SearchResult = {
    ...result,
    clusters: result.clusters
      .map((c) => ({
        ...c,
        hits: c.hits.filter((h) => h.degree > 1 || h.bm25 > 0),
      }))
      .filter((c) => c.hits.length > 0),
    totals: { ...result.totals },
  };
  filtered.totals.vertices = filtered.clusters.reduce((n, c) => n + c.hits.length, 0);
  filtered.totals.concepts = filtered.clusters.length;

  md = formatSearch(filtered, opts).replace(/ — why: "[^"]*"/g, "");
  if (estimateTokens(md) <= maxTokens) return stripSentinels(md);

  // Step 3: truncate skill body between sentinels to first ~2000 chars
  const skillBlockRe = /<!--SKILL_START-->\n([\s\S]*?)\n<!--SKILL_END-->/g;
  const truncated = md.replace(skillBlockRe, (_, body: string) => {
    if (body.length <= 2000) return `<!--SKILL_START-->\n${body}\n<!--SKILL_END-->`;
    return `<!--SKILL_START-->\n${body.slice(0, 2000)}\n\n_[skill body truncated]_\n<!--SKILL_END-->`;
  });
  if (estimateTokens(truncated) <= maxTokens) return stripSentinels(truncated);
  md = truncated;

  return stripSentinels(md.slice(0, maxTokens * 4) + "\n\n_[truncated]_");
}

function stripSentinels(s: string): string {
  return s.replace(/<!--SKILL_(START|END)-->\n?/g, "");
}
