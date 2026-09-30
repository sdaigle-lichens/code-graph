// The active project and the recent-projects list, persisted in the app's userData dir.
//
// A project is just an absolute path the user picked; there is no rebasing to do.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ProjectRef, ProjectState } from "../shared/ipc.js";

const MAX_RECENT = 10;

function stateFile(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

function read(): ProjectState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const s = parsed as Partial<ProjectState>;
    const recent = Array.isArray(s.recent) ? s.recent.filter(isProjectRef) : [];
    const current = isProjectRef(s.current) ? s.current : null;
    return { current, recent };
  } catch {
    return { current: null, recent: [] };
  }
}

function isProjectRef(v: unknown): v is ProjectRef {
  return !!v && typeof v === "object" && typeof (v as ProjectRef).root === "string";
}

function write(state: ProjectState): void {
  const dir = path.dirname(stateFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

/**
 * Drop remembered projects whose directory no longer resolves, so the UI never offers a dead
 * path. Applied once when the file is first loaded, NOT on every read: `getState()` is called by
 * `currentRoot()` from every IPC handler, so filtering there meant an `existsSync` per remembered
 * project per handler call — and, worse, rewriting projects.json as a side effect of a read, so
 * merely opening the app mutated it. Anything that changes the list writes it explicitly below.
 */
function prune(state: ProjectState): ProjectState {
  return {
    current: state.current && fs.existsSync(state.current.root) ? state.current : null,
    recent: state.recent.filter((r) => fs.existsSync(r.root)),
  };
}

let cached: ProjectState | null = null;

export function getState(): ProjectState {
  if (!cached) cached = prune(read());
  return cached;
}

export function currentRoot(): string {
  return getState().current?.root ?? "";
}

/** Open a project: make it current and move it to the head of the recent list. */
export function openProject(root: string): ProjectState {
  const resolved = path.resolve(root);
  const ref: ProjectRef = {
    root: resolved,
    name: path.basename(resolved),
    lastOpened: new Date().toISOString(),
  };
  const prev = getState();
  cached = {
    current: ref,
    recent: [ref, ...prev.recent.filter((r) => r.root !== resolved)].slice(0, MAX_RECENT),
  };
  write(cached);
  return cached;
}

export function forgetProject(root: string): ProjectState {
  const resolved = path.resolve(root);
  const prev = getState();
  cached = {
    current: prev.current?.root === resolved ? null : prev.current,
    recent: prev.recent.filter((r) => r.root !== resolved),
  };
  write(cached);
  return cached;
}

/** The roots a renderer-supplied `projectRoot` may name: the open project and the recent list. */
export function allowedProjectRoots(): string[] {
  const s = getState();
  return [...(s.current ? [s.current.root] : []), ...s.recent.map((r) => r.root)];
}
