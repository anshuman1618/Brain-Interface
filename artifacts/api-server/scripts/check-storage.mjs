/**
 * Prove the configured file store actually works, before a chamber finds out.
 *
 *   R2_ACCOUNT_ID=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *     node artifacts/api-server/scripts/check-storage.mjs
 *
 * Writes a small object, reads it back, compares the bytes, and deletes it.
 * Nothing else in this repository can tell you whether a pasted secret is
 * right: the server only discovers it when somebody uploads a filing, and by
 * then the failure is in front of a customer.
 *
 * Run it against production's exact variables. It touches one key under
 * `_healthcheck/` and removes it again, so it is safe against a live bucket.
 *
 * Works for the filesystem backend too, where it answers a different but
 * equally useful question: whether the directory is writable at all.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/*
 * Bundle the real module and import that, rather than reimplementing the
 * backend selection here.
 *
 * The server's sources import each other without file extensions, which the
 * bundler resolves and Node's type-stripping loader does not — importing the
 * source directly fails on ERR_MODULE_NOT_FOUND. Duplicating the logic would
 * be worse than the resolution problem: this script exists to test what the
 * server actually does, and a second copy could agree with itself while
 * disagreeing with production.
 */
const here = dirname(fileURLToPath(import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), "lex-storage-check-"));
const outFile = join(outDir, "backends.mjs");
await build({
  entryPoints: [join(here, "../src/lib/blob-backends.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const { blobBackend } = await import(outFile);
process.on("exit", () => {
  void rm(outDir, { recursive: true, force: true });
});

const ok = (m) => console.log(`  [32mok[0m    ${m}`);
const bad = (m) => console.log(`  [31mFAIL[0m  ${m}`);

let backend;
try {
  backend = blobBackend();
} catch (err) {
  // The partial-configuration refusal lands here, and its message is the
  // whole answer — print it and stop rather than dumping a stack.
  bad(err.message);
  process.exit(1);
}

console.log(`\nStore: ${backend.describe}\n`);

const key = `_healthcheck/${randomUUID()}`;
const payload = Buffer.from(`lex-practice storage check ${new Date().toISOString()}`);

try {
  await backend.put(key, payload);
  ok(`wrote ${payload.length} bytes to ${key}`);
} catch (err) {
  bad(`write failed: ${err.message}`);
  console.log(
    "\n403 usually means the access key, the secret or the bucket name.\n" +
      "404 on a bucket that exists usually means the account id in the endpoint.\n",
  );
  process.exit(1);
}

let readBack;
try {
  readBack = await backend.get(key);
  ok("read it back");
} catch (err) {
  bad(`read failed: ${err.message}`);
  process.exit(1);
}

if (Buffer.compare(readBack, payload) !== 0) {
  bad("the bytes read back do NOT match the bytes written");
  process.exit(1);
}
ok("the bytes match exactly");

try {
  const present = await backend.exists(key);
  if (!present) {
    bad("exists() says it is not there");
    process.exit(1);
  }
  ok("exists() finds it");
} catch (err) {
  bad(`exists failed: ${err.message}`);
  process.exit(1);
}

try {
  await backend.remove(key);
  ok("deleted it");
} catch (err) {
  bad(`delete failed: ${err.message} — the test object is still at ${key}`);
  process.exit(1);
}

// A store that reports success on a delete it did not perform leaves rubbish
// behind on every run, so the removal is confirmed rather than assumed.
if (await backend.exists(key)) {
  bad(`delete reported success but ${key} is still there`);
  process.exit(1);
}
ok("and it is really gone");

console.log(`\n[32mStorage is working.[0m\n`);
