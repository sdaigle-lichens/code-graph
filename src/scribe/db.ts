import { Database } from "arangojs";
import { loadConfig } from "../config.js";

const ARANGO_URL = process.env.ARANGO_URL ?? "http://localhost:8529";
const ARANGO_USER = process.env.ARANGO_USER;
const ARANGO_PASSWORD = process.env.ARANGO_PASSWORD;

function makeAuth() {
  if (ARANGO_USER) {
    return { username: ARANGO_USER, password: ARANGO_PASSWORD ?? "" };
  }
  return undefined;
}

let _systemDb: Database | undefined;
export function getSystemDb(): Database {
  if (!_systemDb) {
    _systemDb = new Database({
      url: ARANGO_URL,
      databaseName: "_system",
      auth: makeAuth(),
    });
  }
  return _systemDb;
}

let _db: Database | undefined;
export function getDb(): Database {
  if (!_db) {
    const dbName = process.env.ARANGO_DB ?? loadConfig().project;
    _db = new Database({
      url: ARANGO_URL,
      databaseName: dbName,
      auth: makeAuth(),
    });
  }
  return _db;
}
