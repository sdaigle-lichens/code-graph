// Minimal YAML frontmatter readers for SKILL.md files.
//
// Ported from maestro's `@repo/claude-fs` (`utils/frontmatter.ts`) and kept behaviourally
// identical, so a skill maestro's concept-skills plugin stamped reads the same here. Inlined rather
// than depended on: code-graph ships without maestro anywhere in sight.

/**
 * The top-level scalar keys of the leading `---` block.
 *
 * It has no notion of depth — it splits every line on its first `:` — so a nested block does not
 * fail, it FLATTENS: `metadata:` with indented children yields an empty `metadata` plus each child
 * as a top-level key. Anything that wants a nested value must use `parseFrontmatterMetadata`,
 * which can tell `metadata.version` from a top-level `version`.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    result[key] = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return result;
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

/**
 * The scalar entries of the frontmatter's `metadata:` map — the Agent Skills spec's home for
 * third-party key-value data, and one of the six fields that survive a claude.ai upload or
 * `package_skill.py` packaging (an invented top-level key is a hard error there).
 *
 * Handles the block form (a bare `metadata:` followed by indented `key: value` lines) and the
 * inline flow form (`metadata: { key: value, ... }`). Reads a flat map only.
 */
export function parseFrontmatterMetadata(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);

  const start = lines.findIndex((l) => /^metadata\s*:/.test(l));
  if (start === -1) return {};

  const inline = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  if (inline.startsWith("{")) {
    const body = inline.replace(/^\{/, "").replace(/\}$/, "");
    const out: Record<string, string> = {};
    for (const pair of body.split(",")) {
      const i = pair.indexOf(":");
      if (i === -1) continue;
      const key = unquote(pair.slice(0, i));
      if (key) out[key] = unquote(pair.slice(i + 1));
    }
    return out;
  }
  // A non-empty, non-`{` value is a scalar — the field is then not a map, which Claude Code drops.
  if (inline) return {};

  const out: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break; // dedented: the map ended
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    if (key) out[key] = unquote(line.slice(i + 1));
  }
  return out;
}
