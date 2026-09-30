// The main-process side of the IPC contract in ../shared/ipc.ts.

import { BrowserWindow, dialog, ipcMain } from "electron";
import { IPC, IPC_EVENTS } from "../shared/ipc.js";
import type { ProjectPickOutcome, ProjectState, Result } from "../shared/ipc.js";
import {
  addConceptToProject,
  closeAllStores,
  conceptGraph,
  deleteConceptFromProject,
  graphStatus,
  initProject,
  isDirectory,
  listConcepts,
} from "./graph.js";
import { allowedProjectRoots, currentRoot, forgetProject, getState, openProject } from "./project-store.js";
import { resolveProjectRoot } from "./roots.js";

/**
 * Every handler goes through here, so a handler may throw freely: the renderer gets
 * `{ ok: false, error }` and always has something to render, never a rejected invoke.
 */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

const rootFor = (requested: unknown) => resolveProjectRoot(requested, currentRoot(), allowedProjectRoots());

/** Tell every window the project changed. Store handles are closed first: the old project's are dead weight. */
function announce(state: ProjectState): ProjectState {
  closeAllStores();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.projectChanged, state);
  }
  return state;
}

export function registerIpc(): void {
  handle(IPC.projectGet, () => getState());

  handle(IPC.projectPick, async (): Promise<ProjectPickOutcome> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { title: "Open project", properties: ["openDirectory" as const] };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const dir = picked.filePaths[0];
    if (picked.canceled || !dir) return { cancelled: true, state: getState() };
    if (!isDirectory(dir)) throw new Error(`Not a directory: ${dir}`);
    return { cancelled: false, state: announce(openProject(dir)) };
  });

  // A renderer cannot open a path the dialog never returned: only the recent list (or the project
  // already open) is accepted, and it must still be a directory.
  handle(IPC.projectOpen, (root: unknown) => {
    if (typeof root !== "string" || !allowedProjectRoots().includes(root)) {
      throw new Error("That project is not in the recent list; choose it with the directory picker.");
    }
    if (!isDirectory(root)) throw new Error(`Project directory not found: ${root}`);
    return announce(openProject(root));
  });

  handle(IPC.projectForget, (root: unknown) => {
    if (typeof root !== "string") throw new Error("A project root is required.");
    return announce(forgetProject(root));
  });

  handle(IPC.graphStatus, (projectRoot?: unknown) => graphStatus(rootFor(projectRoot)));
  handle(IPC.graphInit, (input: { projectRoot?: unknown }) => initProject(rootFor(input?.projectRoot), input as never));
  handle(IPC.conceptList, (projectRoot?: unknown) => listConcepts(rootFor(projectRoot)));
  handle(IPC.conceptAdd, (input: { projectRoot?: unknown }) =>
    addConceptToProject(rootFor(input?.projectRoot), input as never)
  );
  handle(IPC.conceptDelete, (input: { projectRoot?: unknown }) =>
    deleteConceptFromProject(rootFor(input?.projectRoot), input as never)
  );
  handle(IPC.conceptGraph, (input: { projectRoot?: unknown }) =>
    conceptGraph(rootFor(input?.projectRoot), input as never)
  );
}

/** On quit: release the database files. */
export function disposeIpc(): void {
  closeAllStores();
}
