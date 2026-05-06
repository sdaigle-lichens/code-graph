import { preflight } from "./preflight.js";
import {
  queryConcept,
  queryImpact,
  queryCross,
  queryVertex,
  queryVertexByName,
  queryFile,
} from "./queries.js";
import {
  formatConcept,
  formatImpact,
  formatCross,
  formatVertex,
  formatFile,
  type FormatOpts,
} from "./format.js";

type SharedOpts = {
  maxTokens: number;
  json: boolean;
};

export async function runConcept(
  name: string,
  opts: SharedOpts & { skill: boolean }
): Promise<void> {
  const { db } = await preflight();
  const result = await queryConcept(db, name);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const fmtOpts: FormatOpts = {
    maxTokens: opts.maxTokens,
    includeSkill: opts.skill,
    json: false,
  };
  console.log(formatConcept(result, name, fmtOpts));
}

export async function runImpact(
  symbol: string,
  opts: SharedOpts & { direction: "in" | "out" | "both"; max: number }
): Promise<void> {
  const { db } = await preflight();
  const result = await queryImpact(db, symbol, opts.direction, opts.max);

  if (result.ambiguous) {
    for (const c of result.candidates) {
      process.stderr.write(
        `  ${c.concept} — ${c.filepath} — ${c.type}\n`
      );
    }
    process.stderr.write(
      `Ambiguous: "${symbol}" matches ${result.candidates.length} vertices above. ` +
        `Disambiguate with concept qualifier or filepath.\n`
    );
    process.exit(4);
  }

  if (result.notFound) {
    console.error(`no vertex found with name \`${symbol}\``);
    process.exit(6);
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    formatImpact(result, symbol, opts.direction, {
      maxTokens: opts.maxTokens,
      includeSkill: false,
      json: false,
    })
  );
}

export async function runCross(
  conceptA: string,
  conceptB: string,
  opts: SharedOpts
): Promise<void> {
  const { db } = await preflight();
  const { entries } = await queryCross(db, conceptA, conceptB);

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(
    formatCross(entries, conceptA, conceptB, {
      maxTokens: opts.maxTokens,
      includeSkill: false,
      json: false,
    })
  );
}

export async function runFile(
  filepath: string,
  opts: SharedOpts
): Promise<void> {
  const { db } = await preflight();
  const result = await queryFile(db, filepath);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.entries.length === 0) {
    console.error(`no vertices found for filepath \`${filepath}\``);
    process.exit(6);
  }

  console.log(
    formatFile(result, {
      maxTokens: opts.maxTokens,
      includeSkill: false,
      json: false,
    })
  );
}

export async function runVertex(
  location: string,
  opts: SharedOpts
): Promise<void> {
  const { db } = await preflight();

  // Detect form: filepath:line vs name lookup.
  // filepath:line → last segment after `:` is numeric.
  const lastColon = location.lastIndexOf(":");
  const trailing = lastColon !== -1 ? location.slice(lastColon + 1) : "";
  const isFileLine = lastColon !== -1 && /^\d+$/.test(trailing);

  const fmtOpts: FormatOpts = {
    maxTokens: opts.maxTokens,
    includeSkill: false,
    json: false,
  };

  if (isFileLine) {
    const filepath = location.slice(0, lastColon);
    const line = parseInt(trailing, 10);
    const result = await queryVertex(db, filepath, line);
    if (!result) {
      console.error(`no vertex found at ${filepath}:${line}`);
      process.exit(6);
    }
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatVertex(result, fmtOpts));
    return;
  }

  // Name lookup (supports `concept::name` and `filepath:name` qualifiers)
  const result = await queryVertexByName(db, location);

  if (result.kind === "not-found") {
    console.error(`no vertex found with name \`${location}\``);
    process.exit(6);
  }

  if (result.kind === "ambiguous") {
    for (const c of result.candidates) {
      process.stderr.write(
        `  ${c.concept} — ${c.filepath}:${c.start_line} — ${c.type}\n`
      );
    }
    process.stderr.write(
      `Ambiguous: "${location}" matches ${result.candidates.length} vertices above. ` +
        `Disambiguate with concept qualifier (concept::name) or filepath (filepath:name).\n`
    );
    process.exit(4);
  }

  const found = { vertex: result.vertex, neighbors: result.neighbors };
  if (opts.json) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }
  console.log(formatVertex(found, fmtOpts));
}
