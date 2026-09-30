// Guards on the process boundary.
//
// The renderer has no node access and reaches the filesystem only through the enumerated IPC
// channels. That is a property of configuration, not of code that would fail loudly if it
// regressed — flipping `nodeIntegration` to true, adding a generic `invoke(channel, ...)` to the
// preload, or importing the code-graph library from a second module would all work fine and
// silently undo it. Hence these assertions.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, IPC_EVENTS } from "../src/shared/ipc.js";
import { resolveProjectRoot } from "../src/main/roots.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), "utf8");

/** Drop comments before scanning: prose names the very modules a check forbids. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every .ts/.tsx under a src subtree, excluding generated files. */
function sourcesUnder(rel: string): string[] {
  const root = path.join(appRoot, rel);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && e.name !== "routeTree.gen.ts") out.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

function specifiersIn(file: string): string[] {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  return [
    ...[...src.matchAll(/(?:from|import)\s*\(?\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!),
    ...[...src.matchAll(/require\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!),
  ];
}

const isLibrary = (spec: string) => spec === "code-graph" || spec.startsWith("code-graph/");
const rel = (f: string) => path.relative(appRoot, f);

describe("the channel contract", () => {
  it("is exactly the pinned table", () => {
    expect(IPC).toEqual({
      projectGet: "project:get",
      projectPick: "project:pick",
      projectOpen: "project:open",
      projectForget: "project:forget",
      graphStatus: "graph:status",
      graphInit: "graph:init",
      conceptList: "concept:list",
      conceptAdd: "concept:add",
      conceptDelete: "concept:delete",
      conceptGraph: "graph:concept",
    });
    expect(IPC_EVENTS).toEqual({ projectChanged: "project:changed" });
  });
});

describe("BrowserWindow security flags", () => {
  const main = read("src/main/index.ts");

  it("disables node integration in the renderer", () => {
    expect(main).toMatch(/nodeIntegration:\s*false/);
  });

  it("keeps context isolation on", () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
  });

  it("routes external links to the OS browser instead of opening app frames", () => {
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toMatch(/action:\s*"deny"/);
  });
});

describe("preload bridge", () => {
  const preload = read("src/preload/index.ts");

  it("exposes exactly one namespace", () => {
    const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(exposed).toEqual(["codeGraph"]);
  });

  it("offers no generic invoke escape hatch", () => {
    expect(preload).not.toMatch(/invoke:\s*\(\s*channel/);
    expect(preload).not.toMatch(/ipcRenderer\.invoke\(\s*channel/);
  });

  it("only uses channels declared in the shared contract, and uses every one of them", () => {
    const used = [...preload.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\(\s*IPC(_EVENTS)?\.(\w+)/g)].map(
      (m) => `${m[1] ? "IPC_EVENTS" : "IPC"}.${m[2]}`
    );
    const declared = new Set([
      ...Object.keys(IPC).map((k) => `IPC.${k}`),
      ...Object.keys(IPC_EVENTS).map((k) => `IPC_EVENTS.${k}`),
    ]);
    for (const u of used) expect(declared).toContain(u);
    for (const d of declared) expect(used).toContain(d);
    expect(preload).not.toMatch(/ipcRenderer\.(invoke|on)\(\s*["'`]/);
  });

  it("does not re-export node or electron internals to the window", () => {
    expect(preload).not.toContain('exposeInMainWorld("require"');
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*\bprocess\b/);
  });

  it("imports nothing but electron and the shared contract", () => {
    const specs = specifiersIn(path.join(appRoot, "src/preload/index.ts"));
    expect(specs.filter((s) => s !== "electron" && !s.startsWith("../shared/"))).toEqual([]);
  });
});

describe("renderer-side code", () => {
  const outsideMain = [...sourcesUnder("src/shared"), ...sourcesUnder("src/preload"), ...sourcesUnder("src/renderer")];

  it("has files to check", () => {
    expect(outsideMain.length).toBeGreaterThan(0);
  });

  it("imports no node builtins", () => {
    const offenders = outsideMain.filter((f) => specifiersIn(f).some((s) => s.startsWith("node:")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never reaches into src/main", () => {
    const offenders = outsideMain.filter((f) => specifiersIn(f).some((s) => /(^|\/)main\/(?!.*renderer)/.test(s)));
    expect(offenders.filter((f) => !rel(f).startsWith("src/renderer/src/main.tsx")).map(rel)).toEqual([]);
  });

  it("does not import the code-graph library", () => {
    const offenders = outsideMain.filter((f) => specifiersIn(f).some(isLibrary));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("the code-graph library", () => {
  it("is imported in exactly one main-process module", () => {
    const importers = sourcesUnder("src")
      .filter((f) => specifiersIn(f).some(isLibrary))
      .map(rel);
    expect(importers).toEqual(["src/main/graph.ts"]);
  });

  it("is reached only through its pure surface, never a CLI runner", () => {
    const specs = [...new Set(specifiersIn(path.join(appRoot, "src/main/graph.ts")).filter(isLibrary))];
    expect(specs).toEqual(["code-graph"]);
    const src = stripComments(read("src/main/graph.ts"));
    // Both call process.exit and write to stdout.
    expect(src).not.toMatch(/\b(loadConfig|deleteConcept)\b\s*\(/);
  });

  it("never creates a store, even from the user-accepted init path", () => {
    const src = stripComments(read("src/main/graph.ts"));
    expect([...src.matchAll(/\bgetStore\(/g)]).toHaveLength(1);
    expect(src).not.toMatch(/\bbootstrapStore\b/);
    // getStore is only called after the existence check, inside openStore.
    const openStore = src.slice(src.indexOf("function openStore("), src.indexOf("function counts("));
    expect(openStore.indexOf("existsSync(")).toBeGreaterThan(-1);
    expect(openStore.indexOf("existsSync(")).toBeLessThan(openStore.indexOf("getStore("));
  });

  it("applies the library's keyOf to edge endpoints in main, and the renderer never splits a handle", () => {
    const src = stripComments(read("src/main/graph.ts"));
    expect(src).toMatch(/fromKey:\s*keyOf\(e\._from\)/);
    expect(src).toMatch(/toKey:\s*keyOf\(e\._to\)/);
    const offenders = sourcesUnder("src/renderer").filter((f) =>
      /\b_(from|to)\b[^\n]*\.(split|slice|substring|replace)\(/.test(stripComments(fs.readFileSync(f, "utf8")))
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("closes cached store handles on project switch and on quit", () => {
    const ipc = stripComments(read("src/main/ipc.ts"));
    const announce = ipc.slice(ipc.indexOf("function announce("), ipc.indexOf("export function registerIpc"));
    expect(announce).toContain("closeAllStores()");
    // Every project-changing handler routes through announce.
    expect([...ipc.matchAll(/announce\(/g)].length).toBeGreaterThanOrEqual(4);
    expect(ipc.slice(ipc.indexOf("export function disposeIpc"))).toContain("closeAllStores()");
    expect(stripComments(read("src/main/index.ts"))).toMatch(/app\.on\("will-quit",\s*disposeIpc\)/);
  });
});

describe("handlers", () => {
  it("wrap every channel so a throw becomes a discriminated result", () => {
    const ipc = stripComments(read("src/main/ipc.ts"));
    // The only ipcMain.handle call is inside the wrapper.
    expect([...ipc.matchAll(/ipcMain\.handle\(/g)]).toHaveLength(1);
    expect(ipc).toContain("ok: false");
    for (const k of Object.keys(IPC)) expect(ipc, `IPC.${k} has no handler`).toContain(`IPC.${k}`);
  });
});

describe("project-root validation", () => {
  const allowed = ["/work/a", "/work/b"];

  it("honors the open project and recent projects", () => {
    expect(resolveProjectRoot("/work/b", "/work/a", allowed)).toBe("/work/b");
    expect(resolveProjectRoot("/work/a", "/work/a", allowed)).toBe("/work/a");
  });

  it("degrades anything else to the open project", () => {
    expect(resolveProjectRoot("/etc", "/work/a", allowed)).toBe("/work/a");
    expect(resolveProjectRoot("/work/a/../../etc", "/work/a", allowed)).toBe("/work/a");
    expect(resolveProjectRoot({ root: "/etc" }, "/work/a", allowed)).toBe("/work/a");
    expect(resolveProjectRoot(undefined, "/work/a", allowed)).toBe("/work/a");
    expect(resolveProjectRoot("/etc", "", [])).toBe("");
  });
});

describe("built bundles", () => {
  const built = path.join(appRoot, "out/main/index.js");

  it.skipIf(!fs.existsSync(built))("import electron and the library rather than inlining them", () => {
    const bundle = fs.readFileSync(built, "utf8");
    expect(bundle).toMatch(/from\s*["']electron["']/);
    expect(bundle).toMatch(/from\s*["']code-graph["']/);
    // The npm shim's tell-tale.
    expect(bundle).not.toContain("Electron failed to install correctly");
  });
});
