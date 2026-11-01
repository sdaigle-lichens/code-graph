// Batch forms of the per-concept graph commands (`extract`, `apply`, `drift` with several concepts or
// `--all`). Loaded statically by cli.ts, so it imports nothing that touches the store or ts-morph.

/**
 * A per-concept failure whose message was already printed to stderr: the caller exits 1 (single
 * concept) or moves on to the next concept (batch) without printing it again.
 */
export class ReportedError extends Error {}

/**
 * Prints `lines` to stderr, then throws `ReportedError` carrying the first line: the one
 * print-then-throw used by extract, ast-output and apply. Never `process.exit` (a batch must reach the
 * next concept); the CLI exits 1 for a single concept and skips re-printing a `ReportedError`.
 */
export function reportAndThrow(...lines: string[]): never {
  for (const l of lines) console.error(l);
  throw new ReportedError(lines[0]);
}

/**
 * The concepts a graph command acts on: the named ones, or every configured concept (config order)
 * with `--all`. Throws when neither or both are given.
 */
export function resolveConceptArgs(configured: string[], named: string[], all: boolean): string[] {
  if (all && named.length > 0) throw new Error("pass concept names or --all, not both");
  if (all) return configured;
  if (named.length === 0) throw new Error("name at least one concept, or pass --all");
  return [...new Set(named)];
}

export interface BatchFailure {
  concept: string;
  error: string;
}

/**
 * Runs `fn` for each concept in turn; one concept failing does not stop the rest. A failure that
 * was not already reported is printed as `<command> <concept> failed: <message>`. Returns the failures.
 */
export async function runConceptBatch(
  command: string,
  concepts: string[],
  fn: (concept: string) => Promise<void>
): Promise<BatchFailure[]> {
  const failed: BatchFailure[] = [];
  for (const concept of concepts) {
    try {
      await fn(concept);
    } catch (err) {
      const message = (err as Error).message;
      if (!(err instanceof ReportedError)) console.error(`${command} ${concept} failed: ${message}`);
      failed.push({ concept, error: message });
    }
  }
  return failed;
}

/** The closing line of a batch with failures (stderr); exit code 1 is the caller's. */
export function batchFailureSummary(command: string, failed: BatchFailure[], total: number): string {
  return `${command}: ${failed.length} of ${total} concept(s) failed: ${failed.map((f) => f.concept).join(", ")}`;
}
