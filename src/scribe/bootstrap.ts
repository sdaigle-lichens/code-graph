import { CollectionType } from "arangojs/collections";
import type { CreateArangoSearchViewOptions } from "arangojs/views";
import { getSystemDb, getProjectDb } from "./db.js";
import { loadConfig } from "../config.js";

async function createDb(dbName: string): Promise<boolean> {
  const sys = getSystemDb();
  const databases = await sys.listDatabases();
  if (databases.includes(dbName)) return false;
  await sys.createDatabase(dbName);
  return true;
}

async function createCollections(dbName: string): Promise<Record<string, boolean>> {
  const db = getProjectDb(dbName);
  const created: Record<string, boolean> = {};

  const specs = [
    { name: "vertices", edge: false },
    { name: "edges", edge: true },
    { name: "docs", edge: false },
    { name: "concepts", edge: false },
  ];

  for (const spec of specs) {
    const col = db.collection(spec.name);
    const exists = await col.exists();
    if (!exists) {
      if (spec.edge) {
        await db.createCollection(spec.name, { type: CollectionType.EDGE_COLLECTION });
      } else {
        await db.createCollection(spec.name);
      }
      created[spec.name] = true;
    } else {
      created[spec.name] = false;
    }
  }

  return created;
}

async function createGraph(dbName: string): Promise<boolean> {
  const db = getProjectDb(dbName);
  const graph = db.graph("code_graph");
  const exists = await graph.exists();
  if (exists) return false;
  await db.createGraph("code_graph", [
    {
      collection: "edges",
      from: ["vertices", "docs", "concepts"],
      to: ["vertices", "docs", "concepts"],
    },
  ]);
  return true;
}

async function createIndexes(dbName: string): Promise<boolean> {
  const db = getProjectDb(dbName);
  const vertices = db.collection("vertices");
  const edges = db.collection("edges");

  await vertices.ensureIndex({ type: "persistent", fields: ["concept", "type"], name: "idx_vertices_concept_type" });
  await vertices.ensureIndex({ type: "persistent", fields: ["name"], name: "idx_vertices_name" });
  await edges.ensureIndex({ type: "persistent", fields: ["type"], name: "idx_edges_type" });

  return true;
}

async function createSearchView(dbName: string): Promise<boolean> {
  const db = getProjectDb(dbName);
  const views = await db.listViews();
  if (views.some((v) => v.name === "code_search_view")) return false;

  const viewOptions: CreateArangoSearchViewOptions = {
    type: "arangosearch",
    links: {
      vertices: {
        includeAllFields: false,
        fields: {
          purpose: { analyzers: ["text_en"] },
          name: { analyzers: ["text_en"] },
          tags: { analyzers: ["text_en"] },
        },
      },
      docs: {
        includeAllFields: false,
        fields: {
          body_md: { analyzers: ["text_en"] },
        },
      },
    },
  };
  await db.createView("code_search_view", viewOptions);

  return true;
}

export async function bootstrap(onStep?: (msg: string) => void): Promise<void> {
  const config = loadConfig();
  const dbName = process.env.ARANGO_DB ?? config.project;
  const log = onStep ?? (() => {});

  log(`DB: ${dbName}`);
  const dbCreated = await createDb(dbName);
  log(`  DB ${dbCreated ? "created" : "already exists"}`);

  const colCreated = await createCollections(dbName);
  for (const [name, created] of Object.entries(colCreated)) {
    log(`  collection ${name}: ${created ? "created" : "already exists"}`);
  }

  const graphCreated = await createGraph(dbName);
  log(`  graph code_graph: ${graphCreated ? "created" : "already exists"}`);

  await createIndexes(dbName);
  log(`  indexes: ensured`);

  const viewCreated = await createSearchView(dbName);
  log(`  view code_search_view: ${viewCreated ? "created" : "already exists"}`);
}

export async function bootstrapIfMissing(): Promise<void> {
  const config = loadConfig();
  const dbName = process.env.ARANGO_DB ?? config.project;
  const sys = getSystemDb();
  const databases = await sys.listDatabases();
  if (!databases.includes(dbName)) {
    await bootstrap();
  }
}
