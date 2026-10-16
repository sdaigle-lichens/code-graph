import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import { resolveDbPath } from "./db.js";
import { bootstrapStore } from "./bootstrap.js";
import { toDocs, vertexId } from "./rows.js";
import {
  AstDocSchema,
  EnrichedDocSchema,
  type AstDoc,
  type EnrichedDoc,
  type EnrichedEdge,
  type EnrichedVertex,
  type Vertex,
} from "../schema.js";

/**
 * Whether an enrichment entry was written against the vertex as it is now.
 * `hash_seen` (the contentHash the enricher read) is exact. Entries from before `hash_seen`
 * existed only recorded the signature, so they keep the signature rule: a body-only edit cannot
 * be seen through them, but existing enrichment is not mass-staled by the upgrade.
 */
export function enrichmentIsCurrent(
  ev: Pick<EnrichedVertex, "sig_seen" | "hash_seen"> | undefined,
  now: { signature: string; contentHash: string }
): boolean {
  if (!ev) return false;
  if (ev.hash_seen !== undefined) return ev.hash_seen === now.contentHash;
  return ev.sig_seen !== undefined && ev.sig_seen === now.signature;
}

function fail(msg: string, code = 1): never {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function sha1key(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 32);
}

type AgentEdge = Extract<EnrichedEdge, { _from: string }>;

function isAgentEdge(e: EnrichedEdge): e is AgentEdge {
  return "_from" in e;
}

function agentEdgeKey(e: AgentEdge): string {
  return sha1key(`${e._from}|${e._to}|${e.type}|${e.line ?? 0}`);
}

function loadAst(configRoot: string, concept: string): AstDoc {
  const astPath = join(configRoot, "scribe-output", `${concept}.ast.json`);
  if (!existsSync(astPath)) fail(`${astPath} not found — run: code-graph extract ${concept}`);
  try {
    const doc = AstDocSchema.parse(JSON.parse(readFileSync(astPath, "utf-8")));
    if (doc.concept !== concept) fail(`ast.json concept "${doc.concept}" !== arg "${concept}"`);
    return doc;
  } catch (err) {
    return fail(
      `ast.json validation failed — ${err instanceof Error ? err.message : String(err)}\n  re-run: code-graph extract ${concept}`
    );
  }
}

function loadEnriched(path: string, concept: string): EnrichedDoc {
  if (!existsSync(path)) return { concept, vertices: [], edges: [] };
  try {
    const doc = EnrichedDocSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
    if (doc.concept !== concept) fail(`${path} concept "${doc.concept}" !== arg "${concept}"`);
    return doc;
  } catch (err) {
    return fail(`${path} validation failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── targets ──────────────────────────────────────────────────────────────────

export type EnrichTarget = {
  key: string;
  name: string;
  type: string;
  filepath: string;
  start_line: number;
  end_line: number;
  signature: string;
  purpose: string | null;
  reasons: Array<"new" | "changed" | "stale" | "named">;
  edgesWithoutReason: Array<{ key: string; type: string; to: string; toName: string | null; line: number | null }>;
};

export function enrichTargets(concept: string, opts: { vertices: string[]; json: boolean }): void {
  const config = loadConfig();
  const ast = loadAst(config.configRoot, concept);
  const enriched = loadEnriched(join(config.configRoot, "scribe-output", `${concept}.enriched.json`), concept);
  const store = bootstrapStore(resolveDbPath(config));
  const dbMap = new Map(
    toDocs<Vertex>(
      store.prepare("SELECT doc FROM vertices WHERE concept = ? AND status = 'live'").all(concept) as { doc: string }[]
    ).map((v) => [v._key, v])
  );
  const evMap = new Map(enriched.vertices.map((e) => [e._key, e]));
  const reasoned = new Set<string>();
  for (const e of enriched.edges) if (!isAgentEdge(e) && e.reason) reasoned.add(e._key);
  const byKey = new Map(ast.vertices.map((v) => [v._key, v]));

  const named = new Set<string>();
  for (const n of opts.vertices) {
    const hits = ast.vertices.filter((v) => v._key === n || v.name === n || v.displayKey === n);
    if (hits.length === 0) fail(`no vertex "${n}" in ${concept}.ast.json`);
    if (hits.length > 1) {
      fail(
        `"${n}" is ambiguous in ${concept} (${hits.map((h) => `${h.name}:${h.filepath}`).join(", ")}) — pass the _key`
      );
    }
    named.add(hits[0]._key);
  }

  const targets: EnrichTarget[] = [];
  for (const v of ast.vertices) {
    const db = dbMap.get(v._key);
    const ev = evMap.get(v._key);
    const reasons: EnrichTarget["reasons"] = [];
    // Enrichment already written for exactly this body, waiting for `apply`: nothing to do.
    const pending = ev?.hash_seen !== undefined && ev.hash_seen === v.contentHash;
    if (!pending) {
      if (!db || (!db.purpose && !ev?.purpose)) reasons.push("new");
      else if (db.contentHash !== v.contentHash) reasons.push("changed");
      else if (db.agent?.stale === true) reasons.push("stale");
    }
    if (named.has(v._key)) reasons.push("named");
    if (reasons.length === 0) continue;

    const from = vertexId(v._key);
    const edgesWithoutReason = ast.edges
      .filter((e) => e._from === from && !reasoned.has(e._key))
      .map((e) => {
        const toKey = e._to.split("/")[1] ?? e._to;
        return {
          key: e._key,
          type: e.type,
          to: e._to,
          toName: byKey.get(toKey)?.name ?? null,
          line: e.line ?? null,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    targets.push({
      key: v._key,
      name: v.name,
      type: v.type,
      filepath: v.filepath,
      start_line: v.start_line,
      end_line: v.end_line,
      signature: v.signature,
      purpose: db?.purpose ?? ev?.purpose ?? null,
      reasons,
      edgesWithoutReason,
    });
  }
  targets.sort(
    (a, b) => a.filepath.localeCompare(b.filepath) || a.start_line - b.start_line || a.key.localeCompare(b.key)
  );

  if (opts.json) {
    console.log(JSON.stringify({ concept, targets }, null, 2));
    return;
  }
  console.log(`Concept: ${concept} — ${targets.length} vertices to enrich`);
  for (const t of targets) {
    console.log(`  ${t.name} (${t.type}) ${t.filepath}:${t.start_line}-${t.end_line} [${t.reasons.join(",")}]`);
  }
}

// ─── merge ────────────────────────────────────────────────────────────────────

const VERTEX_FIELD_ORDER = [
  "_key",
  "purpose",
  "inputs",
  "outputs",
  "cross_concept_refs",
  "document_ref",
  "tags",
  "sig_seen",
  "hash_seen",
] as const;

function orderVertex(v: EnrichedVertex): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of VERTEX_FIELD_ORDER) if (v[f] !== undefined) out[f] = v[f];
  return out;
}

function orderEdge(e: EnrichedEdge): Record<string, unknown> {
  if (isAgentEdge(e)) {
    const out: Record<string, unknown> = { _from: e._from, _to: e._to, type: e.type, concept: e.concept };
    if (e.reason !== undefined) out.reason = e.reason;
    if (e.line !== undefined) out.line = e.line;
    out.agent = e.agent;
    return out;
  }
  const out: Record<string, unknown> = { _key: e._key };
  if (e.reason !== undefined) out.reason = e.reason;
  return out;
}

/** Merge a partial enrichment into `<concept>.enriched.json`: upsert by key, leave the rest alone. */
export function enrichMerge(concept: string, partialPath: string): void {
  const config = loadConfig();
  const ast = loadAst(config.configRoot, concept);
  const enrichedPath = join(config.configRoot, "scribe-output", `${concept}.enriched.json`);
  const current = loadEnriched(enrichedPath, concept);

  if (!existsSync(partialPath)) fail(`${partialPath} not found`);
  let partial: EnrichedDoc;
  try {
    partial = EnrichedDocSchema.parse(JSON.parse(readFileSync(partialPath, "utf-8")));
  } catch (err) {
    return fail(`${partialPath} validation failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  if (partial.concept !== concept) fail(`${partialPath} concept "${partial.concept}" !== arg "${concept}"`);

  const astVertices = new Map(ast.vertices.map((v) => [v._key, v]));
  const astEdgeKeys = new Set(ast.edges.map((e) => e._key));
  const unknown: string[] = [];
  for (const v of partial.vertices) if (!astVertices.has(v._key)) unknown.push(`vertex ${v._key}`);
  for (const e of partial.edges) if (!isAgentEdge(e) && !astEdgeKeys.has(e._key)) unknown.push(`edge ${e._key}`);
  if (unknown.length > 0) {
    fail(
      `partial enrichment has keys not in ${concept}.ast.json (nothing written):\n  ${unknown.join("\n  ")}\n  re-run: code-graph extract ${concept}`
    );
  }

  const vertices = new Map(current.vertices.map((v) => [v._key, v]));
  for (const pv of partial.vertices) {
    const astV = astVertices.get(pv._key)!;
    vertices.set(pv._key, {
      ...vertices.get(pv._key),
      ...pv,
      // The enricher read the vertex as it is in ast.json now.
      sig_seen: astV.signature,
      hash_seen: astV.contentHash,
    });
  }

  const astEdges = new Map<string, EnrichedEdge>();
  const agentEdges = new Map<string, AgentEdge>();
  for (const e of [...current.edges, ...partial.edges]) {
    if (isAgentEdge(e)) {
      const k = agentEdgeKey(e);
      agentEdges.set(k, { ...agentEdges.get(k), ...e });
    } else {
      astEdges.set(e._key, { ...astEdges.get(e._key), ...e });
    }
  }

  const out = {
    concept,
    vertices: [...vertices.values()].sort((a, b) => a._key.localeCompare(b._key)).map(orderVertex),
    edges: [
      ...[...astEdges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => orderEdge(e)),
      ...[...agentEdges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => orderEdge(e)),
    ],
  };
  const text = JSON.stringify(out, null, 2) + "\n";
  const previous = existsSync(enrichedPath) ? readFileSync(enrichedPath, "utf-8") : null;
  if (previous === text) {
    console.log(
      `enrich merge: ${concept} unchanged (${partial.vertices.length} vertices, ${partial.edges.length} edges merged)`
    );
    return;
  }
  mkdirSync(dirname(enrichedPath), { recursive: true });
  writeFileSync(enrichedPath, text, "utf-8");
  console.log(
    `enrich merge: ${concept} — merged ${partial.vertices.length} vertices, ${partial.edges.length} edges into ${enrichedPath}`
  );
  console.log(`  next: code-graph apply ${concept}`);
}
