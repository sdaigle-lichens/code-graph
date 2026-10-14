// Shared logic for the Maestro task-status tracker (maestro-task-status.cjs) and
// the install pipeline. Plain Node built-ins only — plugins ship without
// node_modules, and this file is copied verbatim into each project's
// .claude/scripts/lib/ so the orchestrator can run it via $CLAUDE_PROJECT_DIR.
//
// The task queue lives as markdown files under .claude/maestro-tasks/NNN-*.md.
// Each file authors its dependencies in a "## Blocked by" section (the ONLY
// place a human/Claude writes deps). Task STATE is never written to markdown —
// it lives solely in .claude/maestro-tasks/status.json, which this module owns:
//
//   {
//     "001-foo.md": { "status": "done",    "blockedBy": [] },
//     "002-bar.md": { "status": "ready",   "blockedBy": ["001-foo.md"] },
//     "004-qux.md": { "status": "blocked", "blockedBy": ["002-bar.md"] }
//   }
//
// `done` is the only decided state. `ready`/`blocked` are always recomputed from
// the dependency graph + the done-set, so the materialized values can't drift:
// a non-done task is `ready` when every blocker is done (or no longer exists),
// otherwise `blocked`. The cascade is therefore automatic — marking one task
// done re-derives every dependent's state in a single pass.

const fs = require("fs");
const path = require("path");

const TASKS_SUBDIR = path.join(".claude", "maestro-tasks");
const STATUS_FILE = "status.json";

// `074`: the main checkout owning `dir`'s repository — `dir` itself unless it is a LINKED git
// worktree, whose `.git` is a file reading `gitdir: <main>/.git/worktrees/<name>`. Kept in sync with
// mainCheckoutRoot() in apps/maestro/src/core/worktree.ts.
function mainCheckoutRoot(dir) {
  try {
    const gitEntry = path.join(dir, ".git");
    if (!fs.statSync(gitEntry).isFile()) return dir;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(gitEntry, "utf8"));
    if (!m) return dir;
    const gitDir = path.resolve(dir, m[1]);
    if (path.basename(path.dirname(gitDir)) !== "worktrees") return dir;
    const common = path.dirname(path.dirname(gitDir));
    if (path.basename(common) !== ".git") return dir;
    return path.dirname(common);
  } catch {
    return dir;
  }
}

// The queue (status.json, claims/) always lives in the MAIN checkout, even when called from inside a
// session's git worktree, so a close or claim made there is seen by every session (`074`).
function tasksDir(projectDir) {
  return path.join(mainCheckoutRoot(projectDir), TASKS_SUBDIR);
}

function statusPath(projectDir) {
  return path.join(tasksDir(projectDir), STATUS_FILE);
}

// List the task markdown files (NNN-*.md), sorted lexicographically — which is
// also their topological run order because the filenames are zero-padded.
function listTaskFiles(projectDir) {
  let files;
  try {
    files = fs.readdirSync(tasksDir(projectDir));
  } catch {
    return [];
  }
  return files.filter((f) => f.endsWith(".md")).sort((a, b) => a.localeCompare(b));
}

// Pull the sibling filenames referenced in a file's "## Blocked by" section.
// The skill writes them as backtick-wrapped names (e.g. `002-other-slice.md`);
// "None" / empty → []. Kept byte-for-byte in sync with the app's parser in
// apps/ai-tools-manager/src/utils/maestro-tasks.ts.
function parseBlockedBy(content) {
  const start = content.search(/^##\s+Blocked by\s*$/m);
  if (start === -1) return [];
  const rest = content.slice(start);
  const nextHeading = rest.slice(1).search(/^##\s/m);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1);
  const refs = body.match(/`(\d{3}-[\w-]+\.md)`/g) || [];
  return Array.from(new Set(refs.map((r) => r.replace(/`/g, ""))));
}

function readStatus(projectDir) {
  try {
    const data = JSON.parse(fs.readFileSync(statusPath(projectDir), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeStatus(projectDir, statusMap) {
  const dir = tasksDir(projectDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Emit keys in sorted order so the committed file has stable, reviewable diffs.
  const ordered = {};
  for (const k of Object.keys(statusMap).sort((a, b) => a.localeCompare(b))) {
    ordered[k] = statusMap[k];
  }
  const p = statusPath(projectDir);
  const tmp = `${p}.${process.pid}.tmp`; // per process: two writers never share a temp file
  fs.writeFileSync(tmp, JSON.stringify(ordered, null, 2) + "\n");
  fs.renameSync(tmp, p);
  return ordered;
}

// Recompute the full status map from the current task files + an authoritative
// done-set. This is the single source of cascade logic:
//   - markdown "## Blocked by" gives each file's blockedBy (authored input),
//   - a task is `done` iff it's in `doneSet`,
//   - a non-done task is `ready` iff every blocker is done OR no longer exists
//     (a deleted/renamed blocker can't perpetually freeze its dependents),
//     otherwise `blocked`.
// Entries for files that no longer exist are dropped. New files appear as
// ready/blocked. Pure single pass — readiness depends only on the done-set.
function buildStatusMap(projectDir, doneSet, previous = {}) {
  const files = listTaskFiles(projectDir);
  const fileSet = new Set(files);
  const out = {};
  for (const filename of files) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(tasksDir(projectDir), filename), "utf8");
    } catch {
      content = "";
    }
    const blockedBy = parseBlockedBy(content);
    let status;
    if (doneSet.has(filename)) {
      status = "done";
    } else {
      const satisfied = blockedBy.every((b) => doneSet.has(b) || !fileSet.has(b));
      status = satisfied ? "ready" : "blocked";
    }
    out[filename] = { status, blockedBy };
    // `084`: the tracker owns `epic` (the markdown never does), so a rebuild keeps what was linked.
    if (previous[filename] && previous[filename].epic) out[filename].epic = previous[filename].epic;
  }
  return out;
}

// The set of filenames currently marked done, read from the existing status.json.
function doneSetFrom(statusMap) {
  return new Set(
    Object.keys(statusMap).filter((k) => statusMap[k] && statusMap[k].status === "done")
  );
}

// Reconcile status.json with the task files on disk: add new files, drop
// missing ones, refresh every blockedBy from the markdown, preserve `done`, and
// recompute all ready/blocked. Returns the written map.
function sync(projectDir) {
  const previous = readStatus(projectDir);
  return writeStatus(projectDir, buildStatusMap(projectDir, doneSetFrom(previous), previous));
}

// Mark a single task file done (idempotent), then recompute the cascade and
// persist. Re-syncs from markdown first so the JSON is current even if files
// changed since the last write. Returns { map, marked, known }.
function markDone(projectDir, filename) {
  const previous = readStatus(projectDir);
  const doneSet = doneSetFrom(previous);
  const known = listTaskFiles(projectDir).includes(filename);
  if (known) doneSet.add(filename);
  const map = writeStatus(projectDir, buildStatusMap(projectDir, doneSet, previous));
  return { map, marked: known, known };
}

module.exports = {
  TASKS_SUBDIR,
  STATUS_FILE,
  tasksDir,
  mainCheckoutRoot,
  statusPath,
  listTaskFiles,
  parseBlockedBy,
  readStatus,
  writeStatus,
  buildStatusMap,
  doneSetFrom,
  sync,
  markDone,
};
