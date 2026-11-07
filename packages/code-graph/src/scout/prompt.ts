// The scout's prompt: the `haiku-metrics-primer` arm of the bench (bench/refactor.mjs `refactorPrompt`), the
// scope, then the primer as leads, then the output format. The only change is that it names no project.
// scout.test.ts pins it to the bench's text.

const SCOPE_OPEN = "<neighbourhood>";
const SCOPE_CLOSE = "</neighbourhood>";
const PRIMER_OPEN = "<metrics-primer>";
const PRIMER_CLOSE = "</metrics-primer>";

const AUDIT = `You are auditing one neighbourhood of the repository in the current directory for code-structure improvements worth a refactor ticket: code duplicated across files or concepts, a helper that should be extracted or reused, a pattern that one file of a family does differently from its siblings, an import cycle, an export that nothing imports. The neighbourhood is the list of files below (a change's files and the files next to them in the import graph). Read them and the code around them; do not edit anything. Propose only improvements that are warranted: if the neighbourhood is fine as it is, say so. Do not report bugs, naming or formatting.`;

const PRIMER_INTRO = `Facts computed from the code index of the repository. They are leads, not verdicts: check them against the source. The index does not measure duplication or pattern drift.`;

const FORMAT = `Finish with a section that starts with the line \`PROPOSALS:\` followed by one line per proposal, in the form \`- <file path>: <kind>: <the problem and the change, in one or two sentences>\`, where kind is one of dedupe, extract-helper, align-pattern, break-cycle, remove-unused. If nothing is warranted, write \`PROPOSALS: none\` and nothing else: no bullet, no sentence after it, no all-clear line.`;

export function scoutPrompt(scope: string, primer: string): string {
  return [
    `${AUDIT}\n\n${SCOPE_OPEN}\n${scope.trim()}\n${SCOPE_CLOSE}`,
    `${PRIMER_OPEN}\n${PRIMER_INTRO}\n\n${primer.trim()}\n${PRIMER_CLOSE}`,
    FORMAT,
  ].join("\n\n");
}
