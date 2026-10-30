// Where the maestro checkout lives (read-only: only `git archive` touches it). Defined once for
// run.mjs, edit-check.mjs and capture-oracle.mjs. An explicit MAESTRO_DIR wins; else the first
// candidate that is a git checkout.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const maestroCandidates = (home = homedir()) => [
  join(home, 'Documents', 'gits', 'maestro'),
  join(home, 'gits', 'maestro'),
];

// Throws one line naming MAESTRO_DIR when no candidate is a git checkout.
export function resolveMaestroDir({ env = process.env, home = homedir(), exists = existsSync } = {}) {
  if (env.MAESTRO_DIR) return env.MAESTRO_DIR;
  const found = maestroCandidates(home).find((d) => exists(join(d, '.git')));
  if (!found) throw new Error(`no maestro checkout found (tried ${maestroCandidates(home).join(', ')}); set MAESTRO_DIR`);
  return found;
}

// For the scripts: the value for `{MAESTRO}` in a case's setup. Lazy: resolved only when the setup
// uses the placeholder, so a --dry run needs no maestro checkout.
export const maestroFor = (setup) => (String(setup).includes('{MAESTRO}') ? maestroDirOrExit() : '');

// The resolved dir, or one stderr line and exit 1.
export function maestroDirOrExit() {
  try {
    return resolveMaestroDir();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
