import type { Result } from "../../../shared/ipc";

/** The renderer's only door to the main process. */
export const api = window.codeGraph;

/** Unwrap a discriminated IPC result; a failure becomes a thrown Error carrying the main-process message. */
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
