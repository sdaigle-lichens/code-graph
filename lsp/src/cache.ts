import { spawn } from "node:child_process";
import { relative, isAbsolute } from "node:path";
import type { FileResult } from "./types.js";

type CacheEntry = {
  result: FileResult | null;
  fetchedAt: number;
};

export type RunOpts = {
  cwd: string;
  binary: string; // path or name resolvable on PATH
};

const TTL_MS = 30_000;

const cache = new Map<string, CacheEntry>();
let serverDownUntil = 0;

export function clearCache(absPath?: string) {
  if (absPath) cache.delete(absPath);
  else cache.clear();
}

function toRelative(absPath: string, cwd: string): string {
  if (!isAbsolute(absPath)) return absPath;
  const rel = relative(cwd, absPath);
  return rel.startsWith("..") ? absPath : rel;
}

export async function getFileResult(
  absPath: string,
  opts: RunOpts
): Promise<FileResult | null> {
  const now = Date.now();
  if (now < serverDownUntil) return null;

  const cached = cache.get(absPath);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.result;

  const rel = toRelative(absPath, opts.cwd);
  const result = await runCli(rel, opts);
  cache.set(absPath, { result, fetchedAt: now });
  return result;
}

function runCli(filepath: string, opts: RunOpts): Promise<FileResult | null> {
  return new Promise((resolve) => {
    const child = spawn(
      opts.binary,
      ["query", "file", filepath, "--json"],
      { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code === 2) {
        // ArangoDB unreachable — back off for 60s
        serverDownUntil = Date.now() + 60_000;
        resolve(null);
        return;
      }
      if (code === 6) {
        // No vertices for this file — valid empty result
        resolve({ filepath, entries: [], doc_by_concept: {} });
        return;
      }
      if (code !== 0) {
        process.stderr.write(
          `code-graph-lsp: query file failed (exit ${code}): ${stderr}\n`
        );
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FileResult);
      } catch (err) {
        process.stderr.write(
          `code-graph-lsp: failed to parse JSON output: ${(err as Error).message}\n`
        );
        resolve(null);
      }
    });
  });
}
