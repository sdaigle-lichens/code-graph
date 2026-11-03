// Copied to <workspace>/.bench/ts-resolve.mjs for the 044 test tasks. maestro's TypeScript sources
// import siblings as `./x.js`; Node's type stripping (22.18+) runs the .ts files but does not rewrite
// those specifiers. This hook resolves a relative `./x.js` to `./x.ts` when only the .ts exists, so
// `node --import ./.bench/ts-resolve.mjs --test <file>.ts` runs maestro tests with no node_modules.
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const js = new URL(specifier, context.parentURL);
    const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
    if (!existsSync(fileURLToPath(js)) && existsSync(fileURLToPath(ts))) return next(ts.href, context);
  }
  return next(specifier, context);
}

if (!globalThis.__benchTsResolve) {
  globalThis.__benchTsResolve = true;
  register(import.meta.url);
}
