import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import { minimatch } from "minimatch";
import { loadConfig } from "../config.js";
import type { Edge, Vertex } from "../schema.js";

// ─── Key helpers ─────────────────────────────────────────────────────────────

function vKey(concept: string, filepath: string, name: string, type: string): string {
  return createHash("sha1")
    .update(`${concept}::${filepath}::${name}::${type}`)
    .digest("hex")
    .slice(0, 32);
}

function eKey(from: string, to: string, type: string, line: number): string {
  return createHash("sha1")
    .update(`${from}|${to}|${type}|${line}`)
    .digest("hex")
    .slice(0, 32);
}

function sha256hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ─── Zustand helpers ─────────────────────────────────────────────────────────

function isZustandCreate(node: CallExpression): boolean {
  let expr = node.getExpression();
  while (Node.isCallExpression(expr)) {
    expr = expr.getExpression();
  }
  return Node.isIdentifier(expr) && expr.getText() === "create";
}

// Returns the outermost create(...) in the call chain (the actual store call).
function getOutermostCreateCall(node: CallExpression): CallExpression {
  let current: Node = node;
  while (true) {
    const parent = current.getParent();
    if (!parent || !Node.isCallExpression(parent)) break;
    if (parent.getExpression() === current) {
      current = parent;
    } else {
      break;
    }
  }
  return current as CallExpression;
}

// Drills into arrow functions and middleware wrappers to find the store object literal.
function findZustandObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(node)) return node;
  if (Node.isParenthesizedExpression(node)) return findZustandObjectLiteral(node.getExpression());
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    return findZustandObjectLiteral(body);
  }
  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    return findZustandObjectLiteral(body);
  }
  if (Node.isCallExpression(node)) {
    for (const arg of node.getArguments()) {
      const found = findZustandObjectLiteral(arg);
      if (found) return found;
    }
  }
  if (Node.isBlock(node)) {
    for (const ret of node.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const expr = ret.getExpression();
      if (expr) {
        const found = findZustandObjectLiteral(expr);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function isPropertyFunction(prop: Node): boolean {
  if (Node.isMethodDeclaration(prop)) return true;
  if (Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    return !!init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));
  }
  return false;
}

// ─── Function classification ─────────────────────────────────────────────────

function nodeReturnsJsx(node: Node): boolean {
  return node.getDescendants().some(
    (d) => Node.isJsxElement(d) || Node.isJsxSelfClosingElement(d) || Node.isJsxFragment(d)
  );
}

function classifyFunction(name: string, node: Node): "hook" | "component" | "function" {
  if (/^use[A-Z]/.test(name)) return "hook";
  if (/^[A-Z]/.test(name) && nodeReturnsJsx(node)) return "component";
  return "function";
}

// ─── Walk a single source file ────────────────────────────────────────────────

type MakeVertex = (
  type: Vertex["type"],
  name: string,
  filepath: string,
  node: Node,
) => Vertex;

function walkSourceFile(
  sf: SourceFile,
  fp: string,
  conceptName: string,
  vertices: Vertex[],
  nodeToKey: Map<Node, string>,
  vertexToStore: Map<string, string>,
  makeVertex: MakeVertex,
): void {
  const emittedCreateNodes = new Set<Node>();

  // --- Zustand stores ---
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    if (!isZustandCreate(node)) return;
    const outer = getOutermostCreateCall(node);
    if (outer !== node) return; // skip inner chain links
    if (emittedCreateNodes.has(outer)) return;
    emittedCreateNodes.add(outer);

    // Resolve store name + declaration from the enclosing `const X = create(...)`.
    let storeName = "anonymous-store";
    let varDecl: Node | undefined;
    let cur: Node | undefined = outer.getParent();
    while (cur) {
      if (Node.isVariableDeclaration(cur)) {
        storeName = cur.getName();
        varDecl = cur;
        break;
      }
      cur = cur.getParent();
    }

    const storeVertex = makeVertex("store", storeName, fp, outer);
    vertices.push(storeVertex);
    // Alias the VariableDeclaration so `import { useFooStore }` resolves to this store.
    if (varDecl) nodeToKey.set(varDecl, storeVertex._key);

    // Store-state and store-action from the object literal
    const objLit = findZustandObjectLiteral(outer);
    if (!objLit) return;

    for (const prop of objLit.getProperties()) {
      if (!Node.isPropertyAssignment(prop) && !Node.isMethodDeclaration(prop)) continue;
      const propName = prop.getName();
      const vtype: Vertex["type"] = isPropertyFunction(prop) ? "store-action" : "store-state";
      const childVertex = makeVertex(vtype, propName, fp, prop);
      vertices.push(childVertex);
      vertexToStore.set(childVertex._key, storeVertex._key);
    }
  });

  // --- Top-level statements ---
  for (const stmt of sf.getStatements()) {
    if (Node.isTypeAliasDeclaration(stmt)) {
      vertices.push(makeVertex("type-def", stmt.getName(), fp, stmt));
      continue;
    }
    if (Node.isInterfaceDeclaration(stmt)) {
      vertices.push(makeVertex("type-def", stmt.getName(), fp, stmt));
      continue;
    }
    if (Node.isFunctionDeclaration(stmt)) {
      const name = stmt.getName();
      if (!name) continue;
      vertices.push(makeVertex(classifyFunction(name, stmt), name, fp, stmt));
      continue;
    }
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarations()) {
        const name = decl.getName();
        const init = decl.getInitializer();
        if (!init) continue;
        // Skip Zustand stores (already emitted above)
        const hasCreate = decl
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          .some((ce) => isZustandCreate(ce));
        if (hasCreate) continue;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          vertices.push(makeVertex(classifyFunction(name, init), name, fp, decl));
        }
      }
    }
  }

  // --- useEffect calls ---
  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== "useEffect") return;
    const line = node.getStartLineNumber();
    vertices.push(makeVertex("effect", `effect-${line}`, fp, node));
  });
}

// ─── Build edges ──────────────────────────────────────────────────────────────

function buildEdges(
  vertices: Vertex[],
  keyToNode: Map<string, Node>,
  nodeToKey: Map<Node, string>,
  vertexToStore: Map<string, string>,
  conceptName: string,
  extractedAt: string,
): Edge[] {
  const edges: Edge[] = [];
  const emitted = new Set<string>();
  const keyToVertex = new Map(vertices.map((v) => [v._key, v] as const));

  function tryEmit(
    fromKey: string,
    toKey: string,
    type: Edge["type"],
    line: number,
  ): void {
    if (fromKey === toKey) return;
    const key = eKey(`vertices/${fromKey}`, `vertices/${toKey}`, type, line);
    if (emitted.has(key)) return;
    emitted.add(key);
    edges.push({
      _key: key,
      _from: `vertices/${fromKey}`,
      _to: `vertices/${toKey}`,
      type,
      concept: conceptName,
      crosses_concept: false,
      line,
      ast: { extracted_at: extractedAt },
      agent: { authored_by: null },
    });
  }

  // Resolve a node's symbol declarations → vertex key (if any).
  // Follows import aliases so that cross-file calls resolve correctly.
  function resolveToVertexKey(node: Node): string | undefined {
    let sym = node.getSymbol();
    if (!sym) return undefined;
    // Follow import aliases (e.g. `import { foo } from "./foo"` → FunctionDeclaration)
    try {
      const aliased = sym.getAliasedSymbol();
      if (aliased) sym = aliased;
    } catch {
      // getAliasedSymbol throws when the symbol is not an alias
    }
    for (const decl of sym.getDeclarations()) {
      const k = nodeToKey.get(decl);
      if (k) return k;
    }
    return undefined;
  }

  for (const vertex of vertices) {
    const node = keyToNode.get(vertex._key);
    if (!node) continue;

    // calls / uses-hook
    if (
      vertex.type === "function" ||
      vertex.type === "hook" ||
      vertex.type === "component" ||
      vertex.type === "store-action"
    ) {
      for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        // For member expressions like `foo.bar()`, resolve the final identifier
        const ident = Node.isPropertyAccessExpression(callee)
          ? callee.getNameNode()
          : callee;
        const toKey = resolveToVertexKey(ident);
        if (!toKey) continue;
        const toVertex = keyToVertex.get(toKey);
        if (!toVertex) continue;
        const line = call.getStartLineNumber();
        if (toVertex.type === "hook") {
          tryEmit(vertex._key, toKey, "uses-hook", line);
        } else {
          tryEmit(vertex._key, toKey, "calls", line);
        }
      }
    }

    // mounts — components rendering other components
    if (vertex.type === "component") {
      const jsxTags = [
        ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ];
      for (const tag of jsxTags) {
        const toKey = resolveToVertexKey(tag.getTagNameNode());
        if (!toKey) continue;
        tryEmit(vertex._key, toKey, "mounts", tag.getStartLineNumber());
      }
    }

    // reads / writes — inside store-action bodies
    if (vertex.type === "store-action") {
      // Only consider store-state vertices belonging to the same parent store —
      // avoids name collisions when a concept extracts multiple stores.
      const parentStore = vertexToStore.get(vertex._key);
      const stateVertices = vertices.filter(
        (v) => v.type === "store-state" && vertexToStore.get(v._key) === parentStore,
      );
      const stateByName = new Map(stateVertices.map((v) => [v.name, v] as const));

      // writes: set({ X: ... }) or set(s => ({ X: ... }))
      for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (!Node.isIdentifier(callee) || callee.getText() !== "set") continue;
        const arg = call.getArguments()[0];
        if (!arg) continue;
        const objLit = Node.isObjectLiteralExpression(arg)
          ? arg
          : Node.isArrowFunction(arg)
            ? findZustandObjectLiteral(arg)
            : undefined;
        if (!objLit) continue;
        for (const prop of objLit.getProperties()) {
          if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) continue;
          const sv = stateByName.get(prop.getName());
          if (sv) tryEmit(vertex._key, sv._key, "writes", call.getStartLineNumber());
        }
      }

      // reads: get().X
      for (const access of node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const obj = access.getExpression();
        if (!Node.isCallExpression(obj)) continue;
        const inner = obj.getExpression();
        if (!Node.isIdentifier(inner) || inner.getText() !== "get") continue;
        const sv = stateByName.get(access.getName());
        if (sv) tryEmit(vertex._key, sv._key, "reads", access.getStartLineNumber());
      }

      // reads: useStore(s => s.X) — call to a store vertex with selector arrow
      for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const calleeKey = resolveToVertexKey(call.getExpression());
        if (!calleeKey) continue;
        const calleeVertex = keyToVertex.get(calleeKey);
        if (calleeVertex?.type !== "store") continue;
        if (vertexToStore.get(vertex._key) !== calleeKey) continue;
        const arg = call.getArguments()[0];
        if (!arg || !Node.isArrowFunction(arg)) continue;
        const body = arg.getBody();
        const accesses = Node.isPropertyAccessExpression(body)
          ? [body]
          : body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
        for (const access of accesses) {
          const sv = stateByName.get(access.getName());
          if (sv) tryEmit(vertex._key, sv._key, "reads", access.getStartLineNumber());
        }
      }
    }

    // has-type — function signature type references
    if (
      vertex.type === "function" ||
      vertex.type === "hook" ||
      vertex.type === "component" ||
      vertex.type === "store-action"
    ) {
      const typeDefKeys = new Set(
        vertices.filter((v) => v.type === "type-def").map((v) => v._key),
      );
      for (const typeRef of node.getDescendantsOfKind(SyntaxKind.TypeReference)) {
        const typeName = typeRef.getTypeName();
        const toKey = resolveToVertexKey(typeName);
        if (!toKey || !typeDefKeys.has(toKey)) continue;
        tryEmit(vertex._key, toKey, "has-type", typeRef.getStartLineNumber());
      }
    }
  }

  return edges;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function extract(conceptName: string): Promise<void> {
  const config = loadConfig(process.cwd());
  const { configRoot } = config;

  const concept = config.concepts[conceptName];
  if (!concept) {
    console.error(`error: concept "${conceptName}" not found in scribe.config.json`);
    process.exit(1);
  }

  const tsconfigPath = join(configRoot, config.tsconfig);
  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: false,
  });

  // Filter source files to those matching the concept's globs
  const allSourceFiles = project.getSourceFiles();
  const conceptFiles = allSourceFiles.filter((sf) => {
    const absPath = sf.getFilePath();
    const relPath = relative(configRoot, absPath).replace(/\\/g, "/");
    return concept.globs.some(
      (glob) => minimatch(relPath, glob, { dot: true }) || minimatch(absPath, glob, { dot: true }),
    );
  });

  if (conceptFiles.length === 0) {
    console.error(`error: no source files matched concept "${conceptName}" globs`);
    process.exit(1);
  }

  const pkgRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8")) as {
    version: string;
  };
  const extractedAt = new Date().toISOString();
  const extractorVersion = `code-graph@${pkg.version}`;

  const vertices: Vertex[] = [];
  const nodeToKey = new Map<Node, string>();
  const keyToNode = new Map<string, Node>();
  const vertexToStore = new Map<string, string>();

  function relPathOf(absPath: string): string {
    return relative(configRoot, absPath).replace(/\\/g, "/");
  }

  const makeVertex: MakeVertex = (type, name, filepath, node) => {
    const key = vKey(conceptName, filepath, name, type);
    const text = node.getText();
    const v: Vertex = {
      _key: key,
      displayKey: `${conceptName}::${type}::${name}`,
      concept: conceptName,
      type,
      name,
      filepath,
      start_line: node.getStartLineNumber(),
      end_line: node.getEndLineNumber(),
      signature: text.split("\n")[0].slice(0, 200),
      contentHash: sha256hex(text),
      status: "live",
      ast: { extracted_at: extractedAt, extractor_version: extractorVersion },
      agent: { authored_by: null, stale: false },
    };
    nodeToKey.set(node, key);
    keyToNode.set(key, node);
    return v;
  };

  for (const sf of conceptFiles) {
    const fp = relPathOf(sf.getFilePath());
    walkSourceFile(sf, fp, conceptName, vertices, nodeToKey, vertexToStore, makeVertex);
  }

  const edges = buildEdges(vertices, keyToNode, nodeToKey, vertexToStore, conceptName, extractedAt);

  // Skill
  let skillField: { path: string; body: string; contentHash: string } | undefined;
  if (concept.skill) {
    const skillPath = join(configRoot, concept.skill);
    const body = readFileSync(skillPath, "utf-8");
    skillField = { path: concept.skill, body, contentHash: "sha256:" + sha256hex(body) };
  }

  // Sort for determinism
  vertices.sort((a, b) => a._key.localeCompare(b._key));
  edges.sort((a, b) => a._key.localeCompare(b._key));

  // Write output
  const outputDir = join(configRoot, "scribe-output");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${conceptName}.ast.json`);

  const output = {
    concept: conceptName,
    vertices,
    edges,
    ...(skillField && { skill: skillField }),
    meta: { extractor_version: extractorVersion, extracted_at: extractedAt },
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  const skillChars = skillField?.body.length ?? 0;
  process.stderr.write(
    `${vertices.length} vertices, ${edges.length} edges, skill body ${skillChars} chars\n`,
  );
}
