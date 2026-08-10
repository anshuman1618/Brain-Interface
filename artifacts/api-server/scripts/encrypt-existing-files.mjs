/**
 * Encrypt case files that were written before encryption at rest existed.
 *
 * Reads every document row, checks whether the blob on disk still starts with
 * the plaintext marker, and rewrites the ones that do. Safe to run repeatedly —
 * an already-encrypted file is skipped, so a half-finished run just resumes.
 *
 *   FILE_ENCRYPTION_KEY=... FILE_STORAGE_DIR=... DATABASE_URL=... \
 *     node artifacts/api-server/scripts/encrypt-existing-files.mjs
 *
 * Take a backup of the storage directory first. This rewrites files in place,
 * and a key you then lose is a key that loses the files.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, randomBytes } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { readdir, stat } from "node:fs/promises";

const MAGIC = Buffer.from("LEXP1", "utf8");

function key() {
  const raw = process.env.FILE_ENCRYPTION_KEY?.trim();
  if (!raw) {
    console.error("FILE_ENCRYPTION_KEY is not set. Nothing to encrypt with.");
    process.exit(1);
  }
  const k = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (k.length !== 32) {
    console.error("FILE_ENCRYPTION_KEY must be 32 bytes (64 hex chars, or base64).");
    process.exit(1);
  }
  return k;
}

function encrypt(plain, k) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

/** Every regular file under the storage root, recursively. */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const root = resolve(process.env.FILE_STORAGE_DIR?.trim() || ".file-storage");
const k = key();

let seen = 0,
  encrypted = 0,
  skipped = 0,
  failed = 0;

try {
  await stat(root);
} catch {
  console.error(`Storage directory not found: ${root}`);
  process.exit(1);
}

for await (const path of walk(root)) {
  // Belt and braces: never write outside the root, even though walk() started there.
  if (!path.startsWith(root + sep)) continue;
  seen++;
  try {
    const buf = await readFile(path);
    if (buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC)) {
      skipped++;
      continue;
    }
    await writeFile(path, encrypt(buf, k), { mode: 0o600 });
    encrypted++;
  } catch (err) {
    failed++;
    console.error(`FAILED ${path}: ${err.message}`);
  }
}

console.log(
  `\n${seen} files: ${encrypted} encrypted, ${skipped} already encrypted, ${failed} failed.`,
);
process.exit(failed === 0 ? 0 : 1);
