import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { search } from "../query/search.js";
import { queryConcept, queryCross } from "../query/queries.js";
import { preflight } from "../query/preflight.js";

export type VertexCheck = {
  name: string;
  k: number;
};

export type TaskExpected = {
  concepts_in_top_clusters?: string[];
  vertices_in_top_k?: VertexCheck[];
  skill_present?: boolean;
  min_cross_concept_edges?: number;
};

export type EvalTask = {
  id: string;
  prompt: string;
  mode: "search" | "cross" | "impact";
  skip_until_concept?: string;
  conceptA?: string;
  conceptB?: string;
  expected: TaskExpected;
};

export type EvalTaskResult = {
  id: string;
  pass: boolean;
  skipped: boolean;
  missing: string[];
  top_k_names: string[];
  duration_ms: number;
  error?: string;
};

export type EvalRun = {
  passed: number;
  total: number;
  skipped: number;
  regressions: string[];
  tasks: EvalTaskResult[];
  ran_at: string;
};

async function runSearchTask(task: EvalTask): Promise<EvalTaskResult> {
  const start = Date.now();
  const missing: string[] = [];

  const result = await search(task.prompt, { maxTokens: 6000, json: false });

  const topKNames = result.hits
    .filter((h) => h.vertex !== null)
    .map((h) => h.vertex!.name);

  const exp = task.expected;

  if (exp.concepts_in_top_clusters) {
    const topConcepts = result.clusters.slice(0, 3).map((c) => c.concept);
    for (const c of exp.concepts_in_top_clusters) {
      if (!topConcepts.includes(c)) missing.push(`concept "${c}" not in top 3 clusters`);
    }
  }

  if (exp.vertices_in_top_k) {
    for (const { name, k } of exp.vertices_in_top_k) {
      const idx = topKNames.indexOf(name);
      if (idx === -1 || idx >= k) {
        missing.push(`vertex "${name}" not in top ${k} (found at ${idx === -1 ? "∞" : idx + 1})`);
      }
    }
  }

  if (exp.skill_present) {
    const hasSkill = result.clusters.some((c) => c.skill?.body_md && c.skill.body_md.length > 100);
    if (!hasSkill) missing.push("no skill doc with body_md found");
  }

  if (exp.min_cross_concept_edges !== undefined && exp.min_cross_concept_edges > 0) {
    const crossCount = result.hits.reduce((n, h) => n + h.cross_edges.length, 0);
    if (crossCount < exp.min_cross_concept_edges) {
      missing.push(`cross_edges ${crossCount} < min ${exp.min_cross_concept_edges}`);
    }
  }

  return {
    id: task.id,
    pass: missing.length === 0,
    skipped: false,
    missing,
    top_k_names: topKNames.slice(0, 20),
    duration_ms: Date.now() - start,
  };
}

async function runCrossTask(task: EvalTask): Promise<EvalTaskResult> {
  const start = Date.now();
  const missing: string[] = [];
  const { db } = await preflight();

  const conceptA = task.conceptA ?? "";
  const conceptB = task.conceptB ?? "";
  const { entries } = await queryConcept(db, conceptA).then(async () => {
    const { queryCross } = await import("../query/queries.js");
    return queryCross(db, conceptA, conceptB);
  });

  const exp = task.expected;
  if (exp.min_cross_concept_edges !== undefined) {
    if (entries.length < exp.min_cross_concept_edges) {
      missing.push(`cross entries ${entries.length} < min ${exp.min_cross_concept_edges}`);
    }
  }

  return {
    id: task.id,
    pass: missing.length === 0,
    skipped: false,
    missing,
    top_k_names: entries.map((e) => e.from.name).slice(0, 20),
    duration_ms: Date.now() - start,
  };
}

export async function runEval(tasksPath: string, outputDir: string): Promise<EvalRun> {
  const raw = readFileSync(tasksPath, "utf-8");
  const tasks: EvalTask[] = JSON.parse(raw);

  const results: EvalTaskResult[] = [];
  let passed = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (task.skip_until_concept) {
      console.log(`  [skip] ${task.id} (needs concept: ${task.skip_until_concept})`);
      results.push({
        id: task.id,
        pass: true,
        skipped: true,
        missing: [],
        top_k_names: [],
        duration_ms: 0,
      });
      skipped++;
      continue;
    }

    process.stdout.write(`  ${task.id} ... `);
    let result: EvalTaskResult;
    try {
      if (task.mode === "search") {
        result = await runSearchTask(task);
      } else if (task.mode === "cross") {
        result = await runCrossTask(task);
      } else {
        result = {
          id: task.id,
          pass: false,
          skipped: false,
          missing: [`mode "${task.mode}" not implemented in harness`],
          top_k_names: [],
          duration_ms: 0,
        };
      }
    } catch (err) {
      result = {
        id: task.id,
        pass: false,
        skipped: false,
        missing: [`error: ${(err as Error).message}`],
        top_k_names: [],
        duration_ms: 0,
        error: (err as Error).stack,
      };
    }

    const status = result.pass ? "pass" : `FAIL (${result.missing.join("; ")})`;
    console.log(status);
    if (result.pass) passed++;
    results.push(result);
  }

  const regressions = results
    .filter((r) => !r.pass && !r.skipped)
    .map((r) => r.id);

  const run: EvalRun = {
    passed,
    total: tasks.length - skipped,
    skipped,
    regressions,
    tasks: results,
    ran_at: new Date().toISOString(),
  };

  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outputDir, `results-${iso}.json`);
  writeFileSync(outPath, JSON.stringify(run, null, 2));
  console.log(`\nresults written to ${outPath}`);

  return run;
}
