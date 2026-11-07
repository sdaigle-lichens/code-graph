import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import { resolveDbPath } from "./db.js";
import { openStoreOrExit } from "./bootstrap.js";
import type { DatabaseSync } from "node:sqlite";
import { docKey, getRecord, toDocs, vertexId } from "./rows.js";
import { coreVertices, isThinCore, thinCoreMessage } from "./core.js";
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

/**
 * Whether `apply` has ever ingested the concept: a live code vertex, or the SKILL.md doc row a
 * docs-only concept leaves behind. The one definition of "applied": `enrich targets` (the `applied`
 * flag, the roll-up's `neverApplied[]`, and lazy target selection, where nothing counts as touched
 * before the first apply), `apply` (no `agent.touched_at` stamps on the first apply), `drift` /
 * `apply --dry-run` (the one-line never-applied report) and `refresh-skills` (`changedSkillConcepts`
 * only refreshes an applied concept).
 */
export function isConceptApplied(store: DatabaseSync, concept: string): boolean {
  const live = store.prepare("SELECT 1 FROM vertices WHERE concept = ? AND status = 'live' LIMIT 1").get(concept);
  return live !== undefined || getRecord(store, "docs", docKey(concept)) !== null;
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
  reasons: TargetReason[];
  /** Whether the vertex is in the concept's core (named in SKILL.md, or an in-concept hub). */
  core: boolean;
  edgesWithoutReason: Array<{ key: string; type: string; to: string; toName: string | null; line: number | null }>;
};

export type TargetReason = "new" | "changed" | "stale" | "named";
const REASONS: TargetReason[] = ["new", "changed", "stale", "named"];

/** One short line per target in the `--summary` form: no signature, purpose or edge arrays. */
export type EnrichTargetSummary = {
  key: string;
  name: string;
  type: string;
  loc: string;
  reasons: TargetReason[];
  core: boolean;
  edgesWithoutReason: number;
};

export type EnrichTargetsOptions = {
  /** `--vertex`: list just these (name, displayKey or _key), each with full details. */
  vertices: string[];
  json: boolean;
  /** `--all`: every never-enriched vertex is a target (the pre-0.3.12 listing). */
  all?: boolean;
  /** `--summary`: counts, the core block and one short line per target. */
  summary?: boolean;
  /** `--core`: accepted for 0.3.10/0.3.11 skills; core-first is the default now, so it is a no-op. */
  core?: boolean;
};

/**
 * Whether a never-enriched vertex was touched by a task since the concept's previous apply: new in
 * code (not in the store yet, extract without apply), a body that differs from the store's, or a
 * vertex `apply` stamped `agent.touched_at` (new or changed while un-enriched, after the concept's
 * first apply) or flagged stale (a body change seen by an apply that predates `touched_at`).
 * Nothing counts as touched before the concept's first apply: that ingest is not a task.
 */
function touchedSinceApply(v: Vertex, db: Vertex | undefined, conceptApplied: boolean): boolean {
  if (!conceptApplied) return false;
  if (!db) return true;
  return db.contentHash !== v.contentHash || db.agent?.touched_at !== undefined || db.agent?.stale === true;
}

type Store = ReturnType<typeof openStoreOrExit>;
type Config = ReturnType<typeof loadConfig>;

/** What `collectTargets` works out for one concept; both the per-concept and the roll-up output read it. */
type ConceptTargets = {
  targets: EnrichTarget[];
  coreSize: number;
  leftOut: number;
  thin: boolean;
  thinMessage: string | null;
};

export function enrichTargets(concept: string, opts: EnrichTargetsOptions): void {
  const config = loadConfig();
  const ast = loadAst(config.configRoot, concept);
  const store = openStoreOrExit(resolveDbPath(config));
  const { targets, coreSize, leftOut, thin, thinMessage } = collectTargets(config, store, concept, ast, opts);
  const coreInfo = { size: coreSize, leftOut, thin, ...(thinMessage ? { message: thinMessage } : {}) };
  const leftOutLine =
    `core: ${coreSize} vertices; ${leftOut} non-core new vertices left out` +
    (leftOut > 0 ? " (never enriched, untouched since the last apply; --all lists them)" : "");
  // Entries in <concept>.enriched.json that ast.json no longer knows; `apply` remaps or reports them.
  const orphans = orphanKeys(
    ast,
    loadEnriched(join(config.configRoot, "scribe-output", `${concept}.enriched.json`), concept)
  ).length;
  const orphanLine =
    orphans > 0
      ? `${orphans} orphaned enriched entr${orphans === 1 ? "y" : "ies"} not in ast.json — run: code-graph apply ${concept}, then enrich prune ${concept}`
      : null;
  const flagsOf = (t: { reasons: TargetReason[]; core: boolean }) => [...t.reasons, t.core ? "core" : "non-core"];
  const loc = (t: EnrichTarget) => `${t.filepath}:${t.start_line}-${t.end_line}`;
  const edgeCount = (n: number) => `${n} edge${n === 1 ? "" : "s"} without a reason`;

  if (opts.summary) {
    const counts = countReasons(targets);
    const edgesWithoutReason = targets.reduce((n, t) => n + t.edgesWithoutReason.length, 0);
    const lines: EnrichTargetSummary[] = targets.map((t) => ({
      key: t.key,
      name: t.name,
      type: t.type,
      loc: loc(t),
      reasons: t.reasons,
      core: t.core,
      edgesWithoutReason: t.edgesWithoutReason.length,
    }));
    const applied = isConceptApplied(store, concept);
    if (opts.json) {
      // Compact on purpose: the summary exists to be read inline, so it carries no indentation.
      console.log(
        JSON.stringify({
          concept,
          applied,
          total: targets.length,
          counts,
          core: coreInfo,
          ...(orphans > 0 ? { orphans } : {}),
          edgesWithoutReason,
          targets: lines,
        })
      );
      return;
    }
    const countText = REASONS.map((r) => `${r} ${counts[r]}`).join(", ");
    console.log(`Concept: ${concept} — ${targets.length} vertices to enrich (${countText})`);
    if (!applied) console.log(`  never applied: a first-time build, not an incremental update`);
    console.log(`  ${leftOutLine}`);
    if (thinMessage) console.log(`  ${thinMessage}`);
    if (orphanLine) console.log(`  ${orphanLine}`);
    console.log(`  edges without a reason: ${edgesWithoutReason}`);
    for (const l of lines) {
      console.log(
        `  ${l.key} ${l.name} (${l.type}) ${l.loc} [${flagsOf(l).join(",")}] — ${edgeCount(l.edgesWithoutReason)}`
      );
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ concept, targets, core: coreInfo, ...(orphans > 0 ? { orphans } : {}) }, null, 2));
    return;
  }
  console.log(`Concept: ${concept} — ${targets.length} vertices to enrich`);
  for (const t of targets) {
    console.log(
      `  ${t.name} (${t.type}) ${loc(t)} [${flagsOf(t).join(",")}] — ${edgeCount(t.edgesWithoutReason.length)}`
    );
  }
  console.log(`  ${leftOutLine}`);
  if (thinMessage) console.log(`  ${thinMessage}`);
  if (orphanLine) console.log(`  ${orphanLine}`);
}

function countReasons(targets: Array<{ reasons: TargetReason[] }>): Record<TargetReason, number> {
  return Object.fromEntries(REASONS.map((r) => [r, targets.filter((t) => t.reasons.includes(r)).length])) as Record<
    TargetReason,
    number
  >;
}

/** One concept's line in the cross-concept roll-up (`enrich targets --summary` with no concept). */
export type EnrichRollupConcept = {
  concept: string;
  /** `.ast.json` exists; when false nothing could be counted (`total` is 0). */
  extracted: boolean;
  /** `apply` has ingested the concept at least once; false = enriching it is a first-time build. */
  applied: boolean;
  total: number;
  counts: Record<TargetReason, number>;
  core: { size: number; leftOut: number; thin: boolean };
};

/**
 * `enrich targets --summary` with no concept: the target count of every configured concept in one
 * call, so a caller can size a fan-out (and spot first-time builds) before launching it. Same
 * selection rules as the per-concept listing; no per-target lines.
 */
export function enrichTargetsRollup(opts: Pick<EnrichTargetsOptions, "json" | "all">): void {
  const config = loadConfig();
  const store = openStoreOrExit(resolveDbPath(config));
  const concepts: EnrichRollupConcept[] = [];
  for (const concept of Object.keys(config.concepts)) {
    const applied = isConceptApplied(store, concept);
    const astPath = join(config.configRoot, "scribe-output", `${concept}.ast.json`);
    if (!existsSync(astPath)) {
      concepts.push({
        concept,
        extracted: false,
        applied,
        total: 0,
        counts: countReasons([]),
        core: { size: 0, leftOut: 0, thin: false },
      });
      continue;
    }
    const ast = loadAst(config.configRoot, concept);
    const r = collectTargets(config, store, concept, ast, { vertices: [], json: false, all: opts.all });
    concepts.push({
      concept,
      extracted: true,
      applied,
      total: r.targets.length,
      counts: countReasons(r.targets),
      core: { size: r.coreSize, leftOut: r.leftOut, thin: r.thin },
    });
  }
  const total = concepts.reduce((n, c) => n + c.total, 0);
  const neverApplied = concepts.filter((c) => !c.applied).map((c) => c.concept);
  const notExtracted = concepts.filter((c) => !c.extracted).map((c) => c.concept);

  if (opts.json) {
    console.log(JSON.stringify({ total, neverApplied, notExtracted, concepts }));
    return;
  }
  console.log(`All concepts — ${total} vertices to enrich across ${concepts.length} concepts`);
  for (const c of concepts) {
    const flags = [c.applied ? null : "never applied", c.extracted ? null : "not extracted"].filter(Boolean);
    console.log(`  ${c.concept}: ${c.total}${flags.length ? ` (${flags.join(", ")})` : ""}`);
  }
  if (neverApplied.length > 0) {
    console.log(`  never applied (first-time build, not incremental): ${neverApplied.join(", ")}`);
  }
}

function collectTargets(
  config: Config,
  store: Store,
  concept: string,
  ast: AstDoc,
  opts: EnrichTargetsOptions
): ConceptTargets {
  const enriched = loadEnriched(join(config.configRoot, "scribe-output", `${concept}.enriched.json`), concept);
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

  const core = coreVertices(ast.vertices, ast.edges, ast.skill?.body ?? null);
  const conceptApplied = isConceptApplied(store, concept);
  let leftOut = 0;
  const targets: EnrichTarget[] = [];
  for (const v of ast.vertices) {
    const db = dbMap.get(v._key);
    const ev = evMap.get(v._key);
    const isCore = core.keys.has(v._key);
    const reasons: TargetReason[] = [];
    // Enrichment already written for exactly this body, waiting for `apply`: nothing to do.
    const pending = ev?.hash_seen !== undefined && ev.hash_seen === v.contentHash;
    if (!pending) {
      if (!db || (!db.purpose && !ev?.purpose)) {
        // Never enriched: lazy unless it is core, a task touched it, or `--all`.
        if (opts.all || isCore || touchedSinceApply(v, db, conceptApplied)) reasons.push("new");
        else if (!named.has(v._key)) leftOut++;
      } else if (db.contentHash !== v.contentHash) reasons.push("changed");
      else if (db.agent?.stale === true) reasons.push("stale");
    }
    if (named.has(v._key)) reasons.push("named");
    if (reasons.length === 0) continue;
    // `--vertex` narrows the listing to the named vertices (a batch's full details).
    if (named.size > 0 && !named.has(v._key)) continue;

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
      core: isCore,
      edgesWithoutReason,
    });
  }
  targets.sort(
    (a, b) => a.filepath.localeCompare(b.filepath) || a.start_line - b.start_line || a.key.localeCompare(b.key)
  );

  const thin = isThinCore(ast.vertices.length, core.keys.size);
  const thinMessage = thin ? thinCoreMessage(core.keys.size, ast.vertices.length) : null;
  return { targets, coreSize: core.keys.size, leftOut, thin, thinMessage };
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
  // Merge ends in an apply; refuse a newer store before the enriched file is written.
  openStoreOrExit(resolveDbPath(config));
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

// ─── orphaned entries ─────────────────────────────────────────────────────────
//
// An enriched entry whose `_key` is not in ast.json is an orphan: vertex keys include the filepath, so
// a moved file (or a removed vertex) strands its entries. `apply` remaps the unambiguous ones onto the
// moved vertex, reports the rest in one line and never deletes; `enrich prune` is the only way to drop.

/** What the store remembers about an orphaned key (live or archived): the identity used to find its new key. */
export type OrphanIdentity = Pick<Vertex, "name" | "type" | "contentHash">;

export type OrphanPlan = {
  /** Entries re-keyed onto the one live vertex of the same name and type (or same contentHash) that has none. */
  remapped: Array<{ from: string; to: string }>;
  /** Several candidates (or two orphans want the same one): left in place. */
  ambiguous: string[];
  /** No candidate, or the store never saw the key: left in place. */
  unmatched: string[];
};

/** Keys of the entries in `doc` that ast.json does not know. */
export function orphanKeys(ast: AstDoc, doc: EnrichedDoc): string[] {
  const live = new Set(ast.vertices.map((v) => v._key));
  return doc.vertices.filter((e) => !live.has(e._key)).map((e) => e._key);
}

/**
 * Decide, for each orphan, whether it maps onto a vertex of the concept that has no entry yet. The match
 * is unambiguous only when exactly one candidate fits: same type and name (narrowed by contentHash when
 * several share the name), else same type and contentHash. A candidate wanted by two orphans is ambiguous
 * for both. Pure: `identityOf` is the store lookup.
 */
export function planOrphans(
  ast: AstDoc,
  doc: EnrichedDoc,
  identityOf: (key: string) => OrphanIdentity | null
): OrphanPlan {
  const plan: OrphanPlan = { remapped: [], ambiguous: [], unmatched: [] };
  const orphans = orphanKeys(ast, doc);
  if (orphans.length === 0) return plan;
  const astKeys = new Set(ast.vertices.map((v) => v._key));
  const claimed = new Set(doc.vertices.filter((e) => astKeys.has(e._key)).map((e) => e._key));
  const picks = new Map<string, string>();
  for (const from of orphans) {
    const id = identityOf(from);
    if (!id) {
      plan.unmatched.push(from);
      continue;
    }
    const pool = ast.vertices.filter((v) => !claimed.has(v._key) && v.type === id.type);
    const named = pool.filter((v) => v.name === id.name);
    let found = named;
    if (named.length > 1) found = named.filter((v) => v.contentHash === id.contentHash);
    else if (named.length === 0) found = pool.filter((v) => v.contentHash === id.contentHash);
    if (found.length === 1) picks.set(from, found[0]._key);
    else if (found.length > 1 || named.length > 1) plan.ambiguous.push(from);
    else plan.unmatched.push(from);
  }
  const wanted = new Map<string, number>();
  for (const to of picks.values()) wanted.set(to, (wanted.get(to) ?? 0) + 1);
  for (const [from, to] of picks) {
    if (wanted.get(to) === 1) plan.remapped.push({ from, to });
    else plan.ambiguous.push(from);
  }
  return plan;
}

/** `planOrphans` against the store: the identity of an orphaned key is its vertex record, live or archived. */
export function planOrphansInStore(store: DatabaseSync, concept: string, ast: AstDoc, doc: EnrichedDoc): OrphanPlan {
  return planOrphans(ast, doc, (key) => {
    const rec = getRecord<Vertex>(store, "vertices", key);
    return rec && rec.concept === concept ? rec : null;
  });
}

/** `doc` with each remapped entry (and agent-edge endpoint) re-keyed; every field, purpose included, is kept. */
export function applyRemap(doc: EnrichedDoc, remapped: OrphanPlan["remapped"]): EnrichedDoc {
  if (remapped.length === 0) return doc;
  const to = new Map(remapped.map((r) => [r.from, r.to]));
  const endpoint = (end: string) => {
    const k = to.get(end.replace(/^vertices\//, ""));
    return k ? vertexId(k) : end;
  };
  return {
    concept: doc.concept,
    vertices: doc.vertices.map((e) => (to.has(e._key) ? { ...e, _key: to.get(e._key)! } : e)),
    edges: doc.edges.map((e) => (isAgentEdge(e) ? { ...e, _from: endpoint(e._from), _to: endpoint(e._to) } : e)),
  };
}

/** Write `doc` in the same stable layout `enrich merge` produces (vertices sorted by key). */
export function writeEnrichedDoc(path: string, doc: EnrichedDoc): void {
  const out = {
    concept: doc.concept,
    vertices: [...doc.vertices].sort((a, b) => a._key.localeCompare(b._key)).map(orderVertex),
    edges: doc.edges.map(orderEdge),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf-8");
}

/** The single line `apply` prints for a concept's orphans; null when it has none. */
export function orphanSummary(concept: string, plan: OrphanPlan, dryRun: boolean): string | null {
  const left = plan.ambiguous.length + plan.unmatched.length;
  const n = plan.remapped.length;
  if (n + left === 0) return null;
  const parts: string[] = [];
  if (n > 0) parts.push(`${n} ${dryRun ? "would be remapped" : "remapped"} onto moved vertices`);
  if (plan.ambiguous.length > 0) parts.push(`${plan.ambiguous.length} ambiguous`);
  if (plan.unmatched.length > 0) parts.push(`${plan.unmatched.length} unmatched`);
  const next = left > 0 ? `; ${left} kept in the file, review with: code-graph enrich prune ${concept}` : "";
  return `note: ${concept}.enriched.json has ${n + left} entr${n + left === 1 ? "y" : "ies"} not in ast.json (${parts.join(", ")})${next}`;
}

/**
 * `enrich prune <concept>`: list the orphaned entries `apply` cannot remap (ambiguous or unmatched) and,
 * only with `yes`, drop them from `<concept>.enriched.json`. Dry run by default; the entries `apply`
 * would remap are never dropped. Everything else in the file is left as it is.
 */
export function enrichPrune(concept: string, opts: { yes: boolean; json: boolean }): void {
  const config = loadConfig();
  const ast = loadAst(config.configRoot, concept);
  const store = openStoreOrExit(resolveDbPath(config));
  const enrichedPath = join(config.configRoot, "scribe-output", `${concept}.enriched.json`);
  const doc = loadEnriched(enrichedPath, concept);
  const plan = planOrphansInStore(store, concept, ast, doc);
  const byKey = new Map(doc.vertices.map((e) => [e._key, e]));
  const entry = (key: string, reason: "ambiguous" | "unmatched") => {
    const rec = getRecord<Vertex>(store, "vertices", key);
    return { key, reason, name: rec?.name ?? null, purpose: byKey.get(key)?.purpose ?? null };
  };
  const drop = [
    ...plan.ambiguous.map((k) => entry(k, "ambiguous")),
    ...plan.unmatched.map((k) => entry(k, "unmatched")),
  ].sort((a, b) => a.key.localeCompare(b.key));
  const dropKeys = new Set(drop.map((d) => d.key));
  const dropped = opts.yes && dropKeys.size > 0;
  if (dropped) {
    writeEnrichedDoc(enrichedPath, { ...doc, vertices: doc.vertices.filter((e) => !dropKeys.has(e._key)) });
  }
  if (opts.json) {
    console.log(
      JSON.stringify({ concept, dryRun: !opts.yes, dropped, remappable: plan.remapped.length, orphans: drop })
    );
    return;
  }
  if (drop.length === 0) {
    console.log(`enrich prune: ${concept} has no orphaned entries to drop`);
  } else {
    const verb = dropped ? "dropped" : "would be dropped";
    console.log(`enrich prune: ${concept} — ${drop.length} orphaned entr${drop.length === 1 ? "y" : "ies"} ${verb}`);
    for (const d of drop) {
      console.log(
        `  ${d.key} ${d.name ?? "(unknown to the store)"} [${d.reason}] ${(d.purpose ?? "(no purpose)").slice(0, 80)}`
      );
    }
    if (!opts.yes) console.log(`  dry run: nothing written. Re-run with --yes to drop them from ${enrichedPath}`);
  }
  if (plan.remapped.length > 0) {
    console.log(
      `  ${plan.remapped.length} more map onto a moved vertex and are not dropped: run code-graph apply ${concept}`
    );
  }
}
