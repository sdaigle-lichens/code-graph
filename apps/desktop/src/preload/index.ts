// The contextBridge. This is the only thing the renderer can reach node through.
//
// Note what is NOT exposed: no `invoke(channel, …)` escape hatch, no fs, no child_process. The
// renderer can call exactly the operations enumerated in ../shared/ipc.ts and nothing else.

import { contextBridge, ipcRenderer } from "electron";
import { IPC, IPC_EVENTS } from "../shared/ipc.js";
import type { CodeGraphApi, ProjectState } from "../shared/ipc.js";

const api: CodeGraphApi = {
  project: {
    get: () => ipcRenderer.invoke(IPC.projectGet),
    pick: () => ipcRenderer.invoke(IPC.projectPick),
    open: (root) => ipcRenderer.invoke(IPC.projectOpen, root),
    forget: (root) => ipcRenderer.invoke(IPC.projectForget, root),
    onChanged: (cb) => {
      const listener = (_e: unknown, state: ProjectState) => cb(state);
      ipcRenderer.on(IPC_EVENTS.projectChanged, listener);
      return () => ipcRenderer.removeListener(IPC_EVENTS.projectChanged, listener);
    },
  },
  graph: {
    // `projectRoot` is a VIEWING parameter, forwarded as-is; main validates it against the current
    // + recent project list and falls back to the open project on anything else.
    status: (projectRoot) => ipcRenderer.invoke(IPC.graphStatus, projectRoot),
    init: (input) => ipcRenderer.invoke(IPC.graphInit, input),
  },
  concept: {
    list: (projectRoot) => ipcRenderer.invoke(IPC.conceptList, projectRoot),
    add: (input) => ipcRenderer.invoke(IPC.conceptAdd, input),
    delete: (input) => ipcRenderer.invoke(IPC.conceptDelete, input),
    graph: (input) => ipcRenderer.invoke(IPC.conceptGraph, input),
  },
};

contextBridge.exposeInMainWorld("codeGraph", api);
