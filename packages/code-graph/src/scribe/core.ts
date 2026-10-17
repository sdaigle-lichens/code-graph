// A concept's "core": the vertices worth enriching on first touch and worth measuring gaps over.
// Pure over (vertices, edges, SKILL.md body); shared by `enrich targets --core` and `gaps`.

export const CORE_MIN_NAME_LENGTH = 3;
export const CORE_HUB_MIN_INBOUND = 3;
export const THIN_CORE_MIN_LIVE = 50;
export const THIN_CORE_MAX_CORE = 5;

export type CoreVertex = { _key: string; name: string };
export type CoreEdge = { _from: string; _to: string; type: string };

export type CoreResult = {
  /** Keys of every core vertex (named ∪ hubs). */
  keys: Set<string>;
  /** Keys whose name appears in the SKILL.md body. */
  named: Set<string>;
  /** Keys with 3+ inbound calls/mounts from vertices of the same concept. */
  hubs: Set<string>;
};

const keyOf = (id: string): string => id.split("/")[1] ?? id;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `name` occurs in `body` as a whole identifier (not inside a longer one). */
export function nameInBody(name: string, body: string): boolean {
  if (name.length < CORE_MIN_NAME_LENGTH) return false;
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRe(name)}(?![A-Za-z0-9_$])`).test(body);
}

/**
 * `vertices` are the concept's live vertices; only edges whose source is one of them count toward a
 * hub. `skillBody` is the concept's SKILL.md (null/empty: no named vertices).
 */
export function coreVertices(vertices: CoreVertex[], edges: CoreEdge[], skillBody: string | null): CoreResult {
  const inConcept = new Set(vertices.map((v) => v._key));
  const named = new Set<string>();
  if (skillBody) for (const v of vertices) if (nameInBody(v.name, skillBody)) named.add(v._key);

  const inbound = new Map<string, number>();
  for (const e of edges) {
    if (e.type !== "calls" && e.type !== "mounts") continue;
    const from = keyOf(e._from);
    const to = keyOf(e._to);
    if (from === to || !inConcept.has(from) || !inConcept.has(to)) continue;
    inbound.set(to, (inbound.get(to) ?? 0) + 1);
  }
  const hubs = new Set<string>();
  for (const [k, n] of inbound) if (n >= CORE_HUB_MIN_INBOUND) hubs.add(k);

  return { keys: new Set([...named, ...hubs]), named, hubs };
}

/** A big concept whose SKILL.md names almost nothing: the skill needs deepening. */
export function isThinCore(live: number, core: number): boolean {
  return live >= THIN_CORE_MIN_LIVE && core < THIN_CORE_MAX_CORE;
}

export function thinCoreMessage(namedCount: number, live: number): string {
  return `core is thin: SKILL.md names ${namedCount} of ${live} vertices, deepen the skill`;
}
