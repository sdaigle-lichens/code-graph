// Which project root a handler acts on. Pure, so the rule is stated once and testable without electron.

/**
 * `projectRoot` is a renderer-side VIEWING parameter, never a switch. It is honored only when it
 * exactly matches the open project or a recent one; anything else — an arbitrary path, a relative
 * path, a non-string — degrades to the open project rather than reading a directory the user never
 * chose. Returns "" when there is no open project and nothing usable was supplied.
 */
export function resolveProjectRoot(requested: unknown, current: string, allowed: readonly string[]): string {
  if (typeof requested !== "string" || requested === "") return current;
  if (allowed.includes(requested)) return requested;
  console.warn(`[ipc] ignoring unrecognised projectRoot "${requested}"; falling back to the open project`);
  return current;
}
