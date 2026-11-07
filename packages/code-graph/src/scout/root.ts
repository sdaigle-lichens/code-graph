import { isAbsolute } from "node:path";

/** True when a path, taken relative to a root, climbs out of it (`..`, `../x`) or is absolute. */
export const leavesRoot = (rel: string): boolean => rel === ".." || rel.startsWith("../") || isAbsolute(rel);
