import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { aql } from "arangojs/aql";
import { loadConfig } from "../config.js";
import { getDb } from "./db.js";
import { bootstrapIfMissing } from "./bootstrap.js";
import {
  AstDocSchema,
  EnrichedDocSchema,
  type AstDoc,
  type EnrichedDoc,
  type Vertex,
  type EnrichedVertex,
  type EnrichedEdge,
} from "../schema.js";

const AST_EDGE_TYPES = [
  "calls",
  "reads",
  "writes",
  "mounts",
  "uses-hook",
  "has-type",
] as const;

function sha1key(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 32);
}

function fmtError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.splice(0, b.length + 1, ...curr);
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

async function promptChoice(question: string): Promise<"y" | "n" | "skip-all"> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "y" || a === "yes") resolve("y");
      else if (a === "skip-all" || a === "s") resolve("skip-all");
      else resolve("n");
    });
  });
}

function nowISO(): string {
  return new Date().toISOString();
}

type AgentEnrichedEdge = {
  _from: string;
  _to: string;
  type: "delegates-to" | "triggers";
  concept: string;
  reason?: string;
  line?: number | null;
  agent: { authored_by: "claude" };
};

type AstEnrichedEdge = {
  _key: string;
  reason?: string;
};

function isAgentEdge(ee: EnrichedEdge): ee is AgentEnrichedEdge {
  return "_from" in ee;
}

function mergeVertexForInsert(
  astV: Vertex,
  ev: EnrichedVertex | undefined,
  inheritedAgent: Partial<Vertex["agent"]> | null,
  inheritedAgentFields: Partial<Pick<Vertex, "purpose" | "inputs" | "outputs" | "cross_concept_refs" | "document_ref" | "tags">> | null,
  now: string
): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...astV };

  // Apply inherited agent fields (from rename source)
  if (inheritedAgentFields) {
    if (inheritedAgentFields.purpose !== undefined) doc.purpose = inheritedAgentFields.purpose;
    if (inheritedAgentFields.inputs !== undefined) doc.inputs = inheritedAgentFields.inputs;
    if (inheritedAgentFields.outputs !== undefined) doc.outputs = inheritedAgentFields.outputs;
    if (inheritedAgentFields.cross_concept_refs !== undefined)
      doc.cross_concept_refs = inheritedAgentFields.cross_concept_refs;
    if (inheritedAgentFields.document_ref !== undefined)
      doc.document_ref = inheritedAgentFields.document_ref;
    if (inheritedAgentFields.tags !== undefined) doc.tags = inheritedAgentFields.tags;
  }
  if (inheritedAgent) {
    doc.agent = { ...(astV.agent as Record<string, unknown>), ...inheritedAgent };
  }

  // Apply enriched fields (override inherited)
  if (ev) {
    if (ev.purpose !== undefined) doc.purpose = ev.purpose;
    if (ev.inputs !== undefined) doc.inputs = ev.inputs;
    if (ev.outputs !== undefined) doc.outputs = ev.outputs;
    if (ev.cross_concept_refs !== undefined) doc.cross_concept_refs = ev.cross_concept_refs;
    if (ev.document_ref !== undefined) doc.document_ref = ev.document_ref;
    if (ev.tags !== undefined) doc.tags = ev.tags;
    if (ev.sig_seen !== undefined) {
      doc.agent = {
        ...(doc.agent as Record<string, unknown>),
        authored_by: "claude",
        authored_at: now,
        stale: false,
        sig_seen: ev.sig_seen,
      };
    }
  }

  return doc;
}

function buildAgentUpdate(
  dbV: Vertex,
  ev: EnrichedVertex | undefined,
  newSignature: string | null,
  now: string
): Record<string, unknown> {
  const update: Record<string, unknown> = {};

  if (ev) {
    if (ev.purpose !== undefined) update.purpose = ev.purpose;
    if (ev.inputs !== undefined) update.inputs = ev.inputs;
    if (ev.outputs !== undefined) update.outputs = ev.outputs;
    if (ev.cross_concept_refs !== undefined) update.cross_concept_refs = ev.cross_concept_refs;
    if (ev.document_ref !== undefined) update.document_ref = ev.document_ref;
    if (ev.tags !== undefined) update.tags = ev.tags;
  }

  // For changed vertices: set stale. If sig_seen matches new sig, clear stale.
  if (newSignature !== null) {
    const agentUpdate: Record<string, unknown> = { ...dbV.agent, stale: true };
    if (ev?.sig_seen && ev.sig_seen === newSignature) {
      agentUpdate.stale = false;
      agentUpdate.sig_seen = ev.sig_seen;
      agentUpdate.authored_by = "claude";
      agentUpdate.authored_at = now;
    } else if (ev?.sig_seen) {
      agentUpdate.sig_seen = ev.sig_seen;
    }
    update.agent = agentUpdate;
  } else if (ev?.sig_seen !== undefined) {
    update.agent = { ...dbV.agent, sig_seen: ev.sig_seen };
  }

  return update;
}

export async function apply(
  concept: string,
  opts: { dryRun: boolean; approveDrift: boolean }
): Promise<void> {
  const config = loadConfig();
  const { configRoot } = config;
  const now = nowISO();

  // Auto-bootstrap DB if missing
  await bootstrapIfMissing();
  const db = getDb();

  // Load ast.json (required)
  const astPath = join(configRoot, "scribe-output", `${concept}.ast.json`);
  if (!existsSync(astPath)) {
    console.error(
      `error: ${astPath} not found — run: code-graph extract ${concept}`
    );
    process.exit(1);
  }

  let astDoc: AstDoc;
  try {
    const raw = JSON.parse(readFileSync(astPath, "utf-8"));
    astDoc = AstDocSchema.parse(raw);
  } catch (err) {
    console.error(`error: ast.json validation failed — ${fmtError(err)}`);
    console.error(`  re-run: code-graph extract ${concept}`);
    process.exit(1);
  }

  if (astDoc.concept !== concept) {
    console.error(
      `error: ast.json concept "${astDoc.concept}" !== arg "${concept}"`
    );
    process.exit(1);
  }

  // Load enriched.json (optional)
  const enrichedPath = join(
    configRoot,
    "scribe-output",
    `${concept}.enriched.json`
  );
  let enrichedDoc: EnrichedDoc | null = null;
  if (existsSync(enrichedPath)) {
    try {
      const raw = JSON.parse(readFileSync(enrichedPath, "utf-8"));
      enrichedDoc = EnrichedDocSchema.parse(raw);
    } catch (err) {
      console.error(
        `error: enriched.json validation failed — ${fmtError(err)}`
      );
      console.error(`  re-run: /scribe-enrich ${concept}`);
      process.exit(1);
    }

    if (enrichedDoc.concept !== concept) {
      console.error(
        `error: enriched.json concept "${enrichedDoc.concept}" !== arg "${concept}"`
      );
      process.exit(1);
    }
  }

  // Build AST maps
  const astKeySet = new Set(astDoc.vertices.map((v) => v._key));
  const astVertexMap = new Map(astDoc.vertices.map((v) => [v._key, v]));

  // Filter enriched vertices — drop unknown _keys
  let enrichedVertices = enrichedDoc?.vertices ?? [];
  if (enrichedDoc) {
    enrichedVertices = enrichedVertices.filter((ev) => {
      if (!astKeySet.has(ev._key)) {
        process.stderr.write(
          `warning: enriched vertex "${ev._key}" not in ast.json — skipping\n`
        );
        return false;
      }
      return true;
    });
  }
  const enrichedVertexMap = new Map(
    enrichedVertices.map((ev) => [ev._key, ev])
  );

  // Split enriched edges into AST enrichments vs agent-authored
  const enrichedEdgeReasons = new Map<string, string>(); // _key → reason
  const agentEdges: AgentEnrichedEdge[] = [];
  if (enrichedDoc) {
    for (const ee of enrichedDoc.edges) {
      if (isAgentEdge(ee)) {
        agentEdges.push(ee);
      } else {
        const astEe = ee as AstEnrichedEdge;
        if (astEe.reason) enrichedEdgeReasons.set(astEe._key, astEe.reason);
      }
    }
  }

  // Fetch live DB vertices for this concept
  const cursor = await db.query<Vertex>(aql`
    FOR v IN vertices
      FILTER v.concept == ${concept} AND v.status == "live"
      RETURN v
  `);
  const dbVertices = await cursor.all();
  const dbMap = new Map(dbVertices.map((v) => [v._key, v]));

  // Compute diff sets
  const newKeys: string[] = [];
  const changedKeys: string[] = [];
  const unchangedKeys: string[] = [];
  for (const k of astKeySet) {
    const dbV = dbMap.get(k);
    if (!dbV) {
      newKeys.push(k);
    } else if (dbV.contentHash !== astVertexMap.get(k)!.contentHash) {
      changedKeys.push(k);
    } else {
      unchangedKeys.push(k);
    }
  }
  const missingKeys = [...dbMap.keys()].filter((k) => !astKeySet.has(k));

  // Rename detection: missing × new pairs sharing (filepath, type)
  type RenameCandidate = { oldKey: string; newKey: string; score: number };
  const renameCandidates: RenameCandidate[] = [];
  for (const oldKey of missingKeys) {
    const oldV = dbMap.get(oldKey)!;
    for (const newKey of newKeys) {
      const newV = astVertexMap.get(newKey)!;
      if (oldV.filepath !== newV.filepath || oldV.type !== newV.type) continue;
      const score = similarity(
        `${oldV.signature} ${oldV.name}`,
        `${newV.signature} ${newV.name}`
      );
      if (score >= 0.8) {
        renameCandidates.push({ oldKey, newKey, score });
      }
    }
  }

  // Keep unique pairs (greedy best-score)
  const usedOld = new Set<string>();
  const usedNew = new Set<string>();
  const uniqueRenames: RenameCandidate[] = [];
  for (const c of renameCandidates.sort((a, b) => b.score - a.score)) {
    if (!usedOld.has(c.oldKey) && !usedNew.has(c.newKey)) {
      uniqueRenames.push(c);
      usedOld.add(c.oldKey);
      usedNew.add(c.newKey);
    }
  }

  const renamedOldKeys = new Set(uniqueRenames.map((r) => r.oldKey));
  const renamedNewKeys = new Set(uniqueRenames.map((r) => r.newKey));
  const toArchiveKeys = missingKeys.filter((k) => !renamedOldKeys.has(k));
  const trueNewKeys = newKeys.filter((k) => !renamedNewKeys.has(k));

  // Check doc hash in DB for drift report
  let docHashDisplay = "n/a";
  if (astDoc.skill) {
    const docKeyCursor = await db.query<{ body_hash?: string } | null>(aql`
      RETURN DOCUMENT("docs", ${`${concept}::skill`})
    `);
    const existingDoc = (await docKeyCursor.all())[0];
    if (!existingDoc?.body_hash) {
      docHashDisplay = "changed";
    } else {
      docHashDisplay =
        existingDoc.body_hash === astDoc.skill.contentHash
          ? "unchanged"
          : "changed";
    }
  }

  // Compute actual stale count: changed vertices where enriched.sig_seen does NOT match new signature
  const willBeStaleCount = changedKeys.filter((k) => {
    const ev = enrichedVertexMap.get(k);
    const newSig = astVertexMap.get(k)!.signature;
    return !ev?.sig_seen || ev.sig_seen !== newSig;
  }).length;

  // Print drift report
  console.log(`Concept: ${concept}`);
  console.log(`  new:        ${trueNewKeys.length}`);
  console.log(
    `  changed:    ${changedKeys.length} (${willBeStaleCount} became stale: true)`
  );
  console.log(`  unchanged:  ${unchangedKeys.length}`);
  console.log(
    `  missing:    ${missingKeys.length} (${uniqueRenames.length} rename candidates, ${toArchiveKeys.length} to archive)`
  );
  if (astDoc.skill) {
    console.log(`  doc:        body_hash ${docHashDisplay}`);
  }

  if (uniqueRenames.length > 0) {
    console.log(`\nRename candidates:`);
    for (const r of uniqueRenames) {
      const oldV = dbMap.get(r.oldKey)!;
      const newV = astVertexMap.get(r.newKey)!;
      console.log(`  ${oldV.name} → ${newV.name} (score: ${r.score.toFixed(2)})`);
    }
  }

  // Dry-run: exit here
  if (opts.dryRun) {
    process.exit(0);
  }

  // Interactive rename prompts
  const approvedRenames: RenameCandidate[] = [];
  if (uniqueRenames.length > 0) {
    if (opts.approveDrift) {
      approvedRenames.push(...uniqueRenames);
    } else {
      let skipAll = false;
      for (const r of uniqueRenames) {
        if (skipAll) break;
        const oldV = dbMap.get(r.oldKey)!;
        const newV = astVertexMap.get(r.newKey)!;
        const answer = await promptChoice(
          `Approve rename: ${oldV.name} → ${newV.name} (score: ${r.score.toFixed(2)})? [y/n/skip-all] `
        );
        if (answer === "y") approvedRenames.push(r);
        else if (answer === "skip-all") skipAll = true;
      }
    }
  }

  const approvedOldKeys = new Set(approvedRenames.map((r) => r.oldKey));
  const approvedNewKeys = new Set(approvedRenames.map((r) => r.newKey));

  // Rejected rename targets: treat new key as true new, old key as archived
  const rejectedOldKeys = uniqueRenames
    .filter((r) => !approvedOldKeys.has(r.oldKey))
    .map((r) => r.oldKey);

  const finalNewKeys = newKeys.filter((k) => !approvedNewKeys.has(k));
  const finalArchiveKeys = [...toArchiveKeys, ...rejectedOldKeys];

  const verticesCol = db.collection("vertices");
  const edgesCol = db.collection("edges");

  let insertedCount = 0;
  let updatedCount = 0;
  let archivedCount = 0;

  // Apply approved renames: copy agent fields to new key, archive old
  for (const r of approvedRenames) {
    const oldV = dbMap.get(r.oldKey)!;
    const newV = astVertexMap.get(r.newKey)!;
    const ev = enrichedVertexMap.get(r.newKey);
    const merged = mergeVertexForInsert(
      newV,
      ev,
      { ...oldV.agent, stale: false },
      {
        purpose: oldV.purpose,
        inputs: oldV.inputs,
        outputs: oldV.outputs,
        cross_concept_refs: oldV.cross_concept_refs,
        document_ref: oldV.document_ref,
        tags: oldV.tags,
      },
      now
    );
    await verticesCol.save(merged, { overwriteMode: "replace" });
    await verticesCol.update(r.oldKey, { status: "archived", archivedAt: now });
    insertedCount++;
    archivedCount++;
  }

  // Insert new vertices
  for (const k of finalNewKeys) {
    const astV = astVertexMap.get(k)!;
    const ev = enrichedVertexMap.get(k);
    await verticesCol.save(
      mergeVertexForInsert(astV, ev, null, null, now),
      { overwriteMode: "replace" }
    );
    insertedCount++;
  }

  // Update changed vertices
  for (const k of changedKeys) {
    const astV = astVertexMap.get(k)!;
    const dbV = dbMap.get(k)!;
    const ev = enrichedVertexMap.get(k);
    const agentUpdate = buildAgentUpdate(dbV, ev, astV.signature, now);
    await verticesCol.update(k, {
      filepath: astV.filepath,
      start_line: astV.start_line,
      end_line: astV.end_line,
      signature: astV.signature,
      contentHash: astV.contentHash,
      type: astV.type,
      name: astV.name,
      displayKey: astV.displayKey,
      ast: astV.ast,
      ...agentUpdate,
    });
    updatedCount++;
  }

  // Update unchanged vertices that have fresh enriched data
  for (const k of unchangedKeys) {
    const ev = enrichedVertexMap.get(k);
    if (!ev) continue;
    const dbV = dbMap.get(k)!;
    const agentUpdate = buildAgentUpdate(dbV, ev, null, now);
    if (Object.keys(agentUpdate).length > 0) {
      await verticesCol.update(k, agentUpdate);
      updatedCount++;
    }
  }

  // Archive missing vertices (not renamed)
  for (const k of finalArchiveKeys) {
    await verticesCol.update(k, { status: "archived", archivedAt: now });
    archivedCount++;
  }

  // Build keyToConcept map for crosses_concept computation
  const keyToConcept = new Map<string, string>();
  for (const v of astDoc.vertices) keyToConcept.set(v._key, v.concept);
  for (const v of dbVertices) keyToConcept.set(v._key, v.concept);

  function crossesConceptForEdge(from: string, to: string): boolean {
    const fromKey = from.split("/")[1];
    const toKey = to.split("/")[1];
    if (!fromKey || !toKey) return false;
    const fc = keyToConcept.get(fromKey);
    const tc = keyToConcept.get(toKey);
    if (!fc || !tc) return false;
    return fc !== tc;
  }

  // Replace-all AST-owned edges for concept, then re-insert from ast.json
  await db.query(aql`
    FOR e IN edges
      FILTER e.concept == ${concept} AND e.type IN ${[...AST_EDGE_TYPES]}
      REMOVE e IN edges
  `);

  for (const edge of astDoc.edges) {
    const reason = enrichedEdgeReasons.get(edge._key);
    await edgesCol.save({
      ...edge,
      crosses_concept: crossesConceptForEdge(edge._from, edge._to),
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  // Upsert agent-owned edges from enriched.json
  for (const ae of agentEdges) {
    const line = ae.line ?? 0;
    const key = sha1key(`${ae._from}|${ae._to}|${ae.type}|${line}`);
    await edgesCol.save(
      {
        _key: key,
        _from: ae._from,
        _to: ae._to,
        type: ae.type,
        concept: ae.concept,
        crosses_concept: crossesConceptForEdge(ae._from, ae._to),
        ...(ae.reason !== undefined ? { reason: ae.reason } : {}),
        ...(ae.line !== undefined ? { line: ae.line } : {}),
        agent: ae.agent,
        ast: { extracted_at: now },
      },
      { overwriteMode: "replace" }
    );
  }

  // Upsert docs/<concept>::skill vertex
  const docUpdated = docHashDisplay === "changed";
  if (astDoc.skill) {
    const docsCol = db.collection("docs");
    await docsCol.save(
      {
        _key: `${concept}::skill`,
        concept,
        kind: "skill",
        path: astDoc.skill.path,
        body_md: astDoc.skill.body,
        body_hash: astDoc.skill.contentHash,
      },
      { overwriteMode: "replace" }
    );

    // Upsert concepts/<concept> vertex
    const conceptsCol = db.collection("concepts");
    await conceptsCol.save(
      {
        _key: concept,
        owner_skill_path: config.concepts?.[concept]?.skill,
        last_scribed_at: now,
      },
      { overwriteMode: "update" }
    );

    // Upsert describes edge (idempotent)
    const descFrom = `docs/${concept}::skill`;
    const descTo = `concepts/${concept}`;
    await edgesCol.save(
      {
        _key: sha1key(`${descFrom}|${descTo}|describes|0`),
        _from: descFrom,
        _to: descTo,
        type: "describes",
        concept,
        crosses_concept: false,
        ast: { extracted_at: now },
        agent: { authored_by: null },
      },
      { overwriteMode: "replace" }
    );

    // Replace-all documented-by edges for concept, then re-insert one per live vertex
    await db.query(aql`
      FOR e IN edges
        FILTER e.concept == ${concept} AND e.type == "documented-by"
        REMOVE e IN edges
    `);

    const skillTo = `docs/${concept}::skill`;
    for (const v of astDoc.vertices) {
      const from = `vertices/${v._key}`;
      await edgesCol.save({
        _key: sha1key(`${from}|${skillTo}|documented-by|0`),
        _from: from,
        _to: skillTo,
        type: "documented-by",
        concept,
        crosses_concept: false,
        ast: { extracted_at: now },
        agent: { authored_by: null },
      });
    }
  }

  // Print summary
  console.log(
    `\nApplied: ${insertedCount} inserted, ${updatedCount} updated, ${archivedCount} archived`
  );
  console.log(
    `  edges: ${astDoc.edges.length} AST edges replaced, ${agentEdges.length} agent edges upserted`
  );
  if (astDoc.skill) {
    console.log(`  doc: ${docUpdated ? "updated" : "unchanged"}`);
    console.log(`  documented-by: ${astDoc.vertices.length} edges`);
  }
}
