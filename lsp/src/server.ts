#!/usr/bin/env node
// Force stdio transport regardless of how the host launches us.
if (!process.argv.includes("--stdio")) {
  process.argv.push("--stdio");
}

import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  CodeLens,
  DocumentLink,
  Hover,
  Location,
  MarkupKind,
  Range,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { getFileResult, clearCache, type RunOpts } from "./cache.js";
import { renderHover, renderLensTitle } from "./render.js";
import type { FileResult, FileVertexEntry } from "./types.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot = process.cwd();
let cliBinary = process.env.CODE_GRAPH_BIN || "code-graph";

function runOpts(): RunOpts {
  return { cwd: workspaceRoot, binary: cliBinary };
}

function findWorkspaceRoot(uri: string): string {
  // Walk up from the file path, looking for scribe.config.json
  const fsPath = URI.parse(uri).fsPath;
  let dir = dirname(fsPath);
  while (true) {
    if (existsSync(resolvePath(dir, "scribe.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return workspaceRoot;
}

connection.onInitialize((params) => {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspaceRoot = URI.parse(params.workspaceFolders[0].uri).fsPath;
  } else if (params.rootUri) {
    workspaceRoot = URI.parse(params.rootUri).fsPath;
  }
  connection.console.info(`code-graph-lsp: workspaceRoot=${workspaceRoot}`);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      codeLensProvider: { resolveProvider: false },
      documentLinkProvider: { resolveProvider: false },
      definitionProvider: true,
    },
  };
});

documents.onDidSave((change) => {
  clearCache(URI.parse(change.document.uri).fsPath);
  // Force code lens refresh
  connection.sendRequest("workspace/codeLens/refresh").catch(() => {});
});

async function getResultForDoc(uri: string): Promise<FileResult | null> {
  const fsPath = URI.parse(uri).fsPath;
  if (!isAbsolute(fsPath)) return null;
  const root = findWorkspaceRoot(uri);
  return getFileResult(fsPath, { cwd: root, binary: cliBinary });
}

function findEntryAtLine(
  result: FileResult,
  line: number // 0-indexed (LSP)
): FileVertexEntry | null {
  // Vertex lines are 1-indexed in code-graph
  const targetLine = line + 1;
  let best: FileVertexEntry | null = null;
  for (const e of result.entries) {
    if (e.vertex.start_line <= targetLine && e.vertex.end_line >= targetLine) {
      if (
        !best ||
        best.vertex.start_line < e.vertex.start_line ||
        best.vertex.end_line > e.vertex.end_line
      ) {
        best = e;
      }
    }
  }
  return best;
}

connection.onHover(async (params): Promise<Hover | null> => {
  const result = await getResultForDoc(params.textDocument.uri);
  if (!result) return null;
  const entry = findEntryAtLine(result, params.position.line);
  if (!entry) return null;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: renderHover(entry, result, workspaceRoot),
    },
  };
});

connection.onCodeLens(async (params): Promise<CodeLens[]> => {
  const result = await getResultForDoc(params.textDocument.uri);
  if (!result) return [];
  const lenses: CodeLens[] = [];
  for (const entry of result.entries) {
    // 1-indexed → 0-indexed
    const startLine = Math.max(0, entry.vertex.start_line - 1);
    lenses.push({
      range: Range.create(startLine, 0, startLine, 0),
      command: {
        title: renderLensTitle(entry),
        command: "code-graph.noop",
      },
    });
  }
  return lenses;
});

connection.onDocumentLinks(async (params): Promise<DocumentLink[]> => {
  const result = await getResultForDoc(params.textDocument.uri);
  if (!result) return [];

  const links: DocumentLink[] = [];
  for (const entry of result.entries) {
    const titleLine = Math.max(0, entry.vertex.start_line - 1);
    // One link per outbound edge target in the same workspace
    for (const n of entry.edges_out) {
      if (!n.vertex.name || !n.vertex.filepath || !n.vertex.start_line) continue;
      const targetAbs = isAbsolute(n.vertex.filepath)
        ? n.vertex.filepath
        : resolvePath(workspaceRoot, n.vertex.filepath);
      const target = URI.file(targetAbs).toString() + `#L${n.vertex.start_line}`;
      links.push({
        range: Range.create(titleLine, 0, titleLine, Math.max(1, entry.vertex.signature.length || 1)),
        target,
        tooltip: `→ ${n.vertex.name} (${n.edge.type})`,
      });
    }
  }
  return links;
});

connection.onDefinition(async (params): Promise<Location | null> => {
  const result = await getResultForDoc(params.textDocument.uri);
  if (!result) return null;
  const entry = findEntryAtLine(result, params.position.line);
  if (!entry) return null;
  // First outbound edge with a known target wins
  const target = entry.edges_out.find(
    (n) => n.vertex.name && n.vertex.filepath && n.vertex.start_line
  );
  if (!target) return null;
  const targetAbs = isAbsolute(target.vertex.filepath!)
    ? target.vertex.filepath!
    : resolvePath(workspaceRoot, target.vertex.filepath!);
  const startLine = Math.max(0, target.vertex.start_line! - 1);
  return Location.create(URI.file(targetAbs).toString(), Range.create(startLine, 0, startLine, 0));
});

documents.listen(connection);
connection.listen();
