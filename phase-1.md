# Phase 1 — Scaffolding & infra

## Goal

Working `code-graph` binary with subcommand dispatcher, config loader, ArangoDB client, Docker stack, and functional `up` / `down` / `status` subcommands. All other subcommands stub out with "not implemented" so the CLI shape exists end-to-end before later phases fill it in.

## Context

- Repo: `~/Documents/gits/code-graph` (autonomous). pnpm. `"type": "module"`.
- Already installed: `ts-morph`, `arangojs`, `tsx`.
- Still to add — devDeps: `typescript`, `@types/node`. Runtime: `zod`, `commander`.
- Per-project DB pattern: each ingested project gets its own ArangoDB database, named after the project. DB name is auto-derived from `scribe.config.json` `project` field. No `project` field on vertices.
- Single ArangoDB instance (local Docker Desktop) hosts many project DBs.

### Environment variables (read by CLI)

- `ARANGO_URL` — default `http://localhost:8529`
- `ARANGO_DB` — override; if unset, auto-derived from config `project` name
- `ARANGO_USER` / `ARANGO_PASSWORD` — default none (local dev, no auth)
- `CODE_GRAPH_HOME` — default `~/.code-graph`. Reserved for future state, unused in v1.

### CLI surface (full set — only `up`/`down`/`status` implemented in this phase)

```
code-graph up
code-graph down
code-graph bootstrap
code-graph extract <concept>
code-graph apply <concept> [--dry-run] [--approve-drift]
code-graph drift <concept>
code-graph search "<natural language>"
code-graph query concept <name> [--depth=1] [--max-tokens=3000] [--json] [--no-skill]
code-graph query impact <symbol> [--direction=in|out|both] [--max=20]
code-graph query cross <conceptA> <conceptB>
code-graph query vertex <filepath>:<line>
code-graph status
```

### `scribe.config.json` schema (consumer-side, parsed by config loader)

```json
{
  "project": "lichens-ordonnancement-ui",
  "tsconfig": "tsconfig.app.json",
  "skillsDir": ".claude/skills",
  "concepts": {
    "<concept-name>": {
      "globs": ["src/..."],
      "skill": ".claude/skills/<concept-name>/SKILL.md"
    }
  }
}
```

Config loader walks CWD upward to find the nearest `scribe.config.json`. Validates with zod. Exits 5 if not found.

### Vertex / Edge / AstDoc / EnrichedDoc shapes (for `src/schema.ts`)

**Vertex**:
```ts
{
  _key: string;          // sha1(concept::filepath::name::kind) 32-char hex
  displayKey: string;    // "<concept>::<type>::<name>"
  concept: string;
  type: "store"|"store-state"|"store-action"|"function"|"hook"|"component"|"type-def"|"callsite"|"effect";
  name: string;
  filepath: string;
  start_line: number;
  end_line: number;
  signature: string;
  contentHash: string;   // sha256 of node text
  // agent-owned (preserved across extracts):
  purpose?: string;
  inputs?: string[];
  outputs?: string[];
  cross_concept_refs?: string[];
  document_ref?: string|null;
  tags?: string[];
  status: "live"|"archived";
  archivedAt?: string;
  ast: { extracted_at: string; extractor_version: string };
  agent: { authored_by: "claude"|null; authored_at?: string; stale: boolean; sig_seen?: string };
}
```

**Edge**:
```ts
{
  _key: string;          // sha1(from|to|type|line)
  _from: string;         // "vertices/<key>" | "docs/<key>" | "concepts/<key>"
  _to: string;
  type: "calls"|"reads"|"writes"|"mounts"|"subscribes"|"uses-hook"|"delegates-to"|"has-type"|"triggers"|"describes"|"documented-by";
  concept: string;
  crosses_concept: boolean;
  reason?: string;
  lifecycle?: "useEffect"|"handler"|"mount"|"callback"|null;
  line?: number;
  ast: { extracted_at: string };
  agent: { authored_by: "claude"|null };
}
```

**AstDoc** (output of extract): `{ vertices: Vertex[], edges: Edge[], skill: { path, body, contentHash }, meta: { extractor_version, extracted_at } }`.

**EnrichedDoc** (output of subagent): per-vertex `{ _key, purpose, inputs, outputs, cross_concept_refs, document_ref, tags, sig_seen }` + per-semantic-edge `{ _key, reason }`.

## Tasks

1. Update `package.json`: add `"bin": { "code-graph": "dist/cli.js" }`, `scripts.build` = `tsc`, `scripts.start` = `node dist/cli.js`.
2. Create `tsconfig.json` — strict, ESM (`"module": "ES2022"`, `"moduleResolution": "bundler"`), `outDir: "dist"`, `target: "ES2022"`, include `src/**/*`.
3. `pnpm add -D typescript @types/node` and `pnpm add zod commander`.
4. Create `docker-compose.arangodb.yml` — single `arangodb/arangodb:latest` container, env `ARANGO_NO_AUTH=1`, port mapping `8529:8529`, named volume for `/var/lib/arangodb3`.
5. Create `src/schema.ts` — export TS interfaces above.
6. Create `src/config.ts` — `loadConfig(cwd)` walks up, parses, zod-validates, returns `{ project, tsconfig, skillsDir, concepts, configRoot }`. Throw with exit code 5 if not found.
7. Create `src/scribe/db.ts` — arangojs client singleton. `getDb(): Database` resolves DB name from `ARANGO_DB` env or `loadConfig().project`. `getSystemDb(): Database` returns `_system`. URL from `ARANGO_URL`.
8. Create `src/cli.ts` — commander dispatcher with all subcommands listed above. `up`/`down`/`status` implemented; rest call a stub `console.error("not implemented yet"); process.exit(1);`.
9. Implement `code-graph up` → spawn `docker compose -f <pkgRoot>/docker-compose.arangodb.yml up -d` (resolve pkgRoot via `import.meta.url`).
10. Implement `code-graph down` → same with `down`.
11. Implement `code-graph status` — pings `ARANGO_URL`; reports server reachable Y/N; if config found in CWD ancestry, prints DB name + checks if DB exists + counts `concepts` collection if exists; else prints "no scribe.config.json found in CWD ancestry".
12. `pnpm build && pnpm link --global`. Verify `which code-graph` returns a path and `code-graph --version` works.
13. Create `README.md` skeleton — sections: Overview (1 sentence), Install (`pnpm i -g code-graph` + `/plugin install code-graph`), Dev setup (link --global flow). Minimal — full README written in phase 8.

## Done when

- `code-graph --help` shows all subcommands.
- `code-graph up` starts ArangoDB (visible at `http://localhost:8529`).
- `code-graph status` from a directory containing `scribe.config.json` reports the expected DB name and whether server is reachable.
- `code-graph status` from a dir without config prints the expected error message.
- `code-graph down` stops the container.
