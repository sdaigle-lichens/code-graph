// The metrics primer of the refactor scout: pure builders, no filesystem and no store. Ported from the
// bench (bench/refactor.mjs, bench/refactor-prep.mjs), which keeps its own copy because its stored primers
// are fixed by the measured commits; scout.test.ts pins the two to the same bytes, so this text is the
// measured one. A change here is a change to what the bench measured.

export type ScopeEntry = { file: string; concept: string };
export type PrimerFile = ScopeEntry & { fanIn: number; fanOut: number; exports: number };
export type UnusedExport = { file: string; name: string };
export type CrossImportEdge = { from: string; fromConcept: string; to: string; toConcept: string };
export type CrossSection = { a: string; b: string; text: string };
export type PrimerData = {
  files: PrimerFile[];
  hubs: string[];
  cycles: string[][];
  unused: UnusedExport[];
  crossEdges: CrossImportEdge[];
  cross: CrossSection[];
};

type Edge = { from: string; to: string };

/** Lines of `query cross` kept per concept pair, as the bench clipped them. */
const CROSS_MAX_LINES = 15;

function clip(text: string, maxLines: number): string {
  const lines = text.trimEnd().split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return `${lines.slice(0, maxLines).join("\n")}\n... (${lines.length - maxLines} more lines)`;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The file list the agent is given, sorted. */
export function buildScopeBlock(entries: ScopeEntry[]): string {
  const lines = [`${entries.length} files:`];
  for (const e of [...entries].sort((a, b) => compare(a.file, b.file))) {
    lines.push(`- ${e.file} (concept ${e.concept || "none: outside every concept"})`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Strongly connected components with more than one file (or a self import) of the import graph, each
 * sorted, the list sorted by first file. Tarjan, iterative: an import chain can be deeper than the stack.
 */
export function findCycles(edges: Edge[]): string[][] {
  const adj = new Map<string, Set<string>>();
  const add = (f: string) => {
    if (!adj.has(f)) adj.set(f, new Set());
    return adj.get(f)!;
  };
  for (const e of edges) {
    add(e.from).add(e.to);
    add(e.to);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  const open = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    return { v, nexts: [...adj.get(v)!].sort(compare), at: 0 };
  };

  for (const root of [...adj.keys()].sort(compare)) {
    if (index.has(root)) continue;
    const work = [open(root)];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { v, nexts } = frame;
      if (frame.at < nexts.length) {
        const w = nexts[frame.at++];
        if (!index.has(w)) work.push(open(w));
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) !== index.get(v)) continue;
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || adj.get(v)!.has(v)) out.push(comp.sort(compare));
    }
  }
  return out.sort((a, b) => compare(a[0], b[0]));
}

/**
 * Exports of `entries` that no other source file mentions as a whole word. A text scan: the catalog gives
 * fan-in per file, not per export, and a barrel re-export or a dynamic use only shows as a mention, so
 * this is a lead. One pass over the sources per call, however many exports are asked about.
 */
export function unusedExports(
  entries: Array<{ file: string; exports: string[] }>,
  sources: Array<{ file: string; text: string }>
): UnusedExport[] {
  const wanted = new Set(entries.flatMap((e) => e.exports));
  const mentionedIn = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const [word] of source.text.matchAll(/[A-Za-z0-9_$]+/g)) {
      if (!wanted.has(word)) continue;
      if (!mentionedIn.has(word)) mentionedIn.set(word, new Set());
      mentionedIn.get(word)!.add(source.file);
    }
  }
  const out: UnusedExport[] = [];
  for (const e of entries) {
    for (const name of e.exports) {
      const files = mentionedIn.get(name);
      const elsewhere = files !== undefined && [...files].some((f) => f !== e.file);
      if (!elsewhere) out.push({ file: e.file, name });
    }
  }
  return out;
}

/** Import edges between two scope files of different concepts, each pair once, sorted. */
export function crossImportEdges(
  imports: Edge[],
  scope: Set<string>,
  conceptOf: (file: string) => string
): CrossImportEdge[] {
  const seen = new Set<string>();
  const out: CrossImportEdge[] = [];
  for (const e of imports) {
    const key = `${e.from}>${e.to}`;
    if (!scope.has(e.from) || !scope.has(e.to) || seen.has(key)) continue;
    seen.add(key);
    const fromConcept = conceptOf(e.from);
    const toConcept = conceptOf(e.to);
    if (fromConcept && toConcept && fromConcept !== toConcept) {
      out.push({ from: e.from, fromConcept, to: e.to, toConcept });
    }
  }
  return out.sort((x, y) => compare(`${x.from}>${x.to}`, `${y.from}>${y.to}`));
}

export function buildMetricsPrimer(data: PrimerData): string {
  const orNone = (lines: string[]) => (lines.length > 0 ? lines : ["none"]);
  const lines = ["## Scope files (fan-in: files importing it; fan-out: files it imports; both from the code index)"];
  for (const f of data.files) {
    lines.push(
      `- ${f.file} (concept ${f.concept || "none"}): fan-in ${f.fanIn}, fan-out ${f.fanOut}, ${f.exports} exports`
    );
  }
  lines.push("", "## Hubs among the scope files (the index lists them as high fan-in)");
  lines.push(...orNone(data.hubs.map((h) => `- ${h}`)));
  lines.push("", "## Import cycles that include a scope file");
  lines.push(...orNone(data.cycles.map((c) => `- ${c.join(" <-> ")}`)));
  lines.push(
    "",
    "## Exports of the scope files that no other source file mentions (leads: check re-exports and dynamic use)"
  );
  lines.push(...orNone(data.unused.map((u) => `- \`${u.name}\` in ${u.file}`)));
  lines.push("", "## Cross-concept import edges between scope files");
  lines.push(...orNone(data.crossEdges.map((e) => `- ${e.from} (${e.fromConcept}) imports ${e.to} (${e.toConcept})`)));
  lines.push("", "## Cross-concept relations of the scope files (query cross)");
  if (data.cross.length === 0) lines.push("", "none");
  for (const x of data.cross) {
    lines.push("", `### ${x.a} <-> ${x.b}`, "", clip(x.text.replace(/^# .*\n+/, ""), CROSS_MAX_LINES));
  }
  return lines.join("\n") + "\n";
}
