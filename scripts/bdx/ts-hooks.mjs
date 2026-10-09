/**
 * Node runs the doctor straight against the app's TypeScript sources so the
 * checks exercise the same code the server does. Node's ESM resolver wants a
 * file extension that TypeScript files do not carry, so this hook supplies it.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  const candidates = [];
  if (specifier.startsWith(".")) {
    candidates.push(specifier, `${specifier}.ts`, `${specifier}/index.ts`);
  } else if (specifier.startsWith("@/")) {
    const path = new URL(`../../src/${specifier.slice(2)}`, import.meta.url).href;
    candidates.push(path, `${path}.ts`, `${path}/index.ts`);
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(candidate, context);
    } catch {
      /* fall through to the next candidate */
    }
  }
  return next(specifier, context);
}
