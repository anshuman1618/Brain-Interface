// orval APPENDS its barrel exports to each package's src/index.ts on every run
// rather than rewriting the file, and it never checks whether the line is
// already there. Five codegen runs left lib/api-zod/src/index.ts holding the
// same two `export *` lines five times over.
//
// The barrels cannot simply be regenerated: api-client-react's also carries
// hand-written exports (custom-fetch) that orval knows nothing about. So this
// keeps the first occurrence of each `export * from "<module>"`, drops the
// repeats, and leaves every other line — comments and hand-written exports —
// exactly where it was. Quotes are normalised to double because orval emits
// single and Prettier formats this file (only src/generated is ignored);
// without that the diff would flip on every run.
//
// Run after orval. Idempotent, which is the whole point: CI regenerates and
// diffs, so a generator that is not idempotent can never pass.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const BARRELS = [
  path.join(root, "lib", "api-zod", "src", "index.ts"),
  path.join(root, "lib", "api-client-react", "src", "index.ts"),
];

// `export * from "./generated/api";` — capturing the module specifier.
const STAR_EXPORT = /^export \* from ["'](?<module>[^"']+)["'];?\s*$/;

let changed = 0;

for (const file of BARRELS) {
  const original = await readFile(file, "utf8");
  const seen = new Set();
  const kept = [];

  for (const line of original.split("\n")) {
    const match = STAR_EXPORT.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }
    const { module } = match.groups;
    if (seen.has(module)) continue;
    seen.add(module);
    kept.push(`export * from "${module}";`);
  }

  const next = kept.join("\n");
  if (next === original) continue;

  await writeFile(file, next, "utf8");
  changed++;
  console.log(`normalised ${path.relative(root, file)}`);
}

if (changed === 0) console.log("barrels already normalised");
