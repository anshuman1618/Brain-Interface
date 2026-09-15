import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { type Codec, struct, u32, u8, varText, versioned } from "@workspace/crypto-core";

/**
 * The on-disk format for an encrypted case file, and nothing else.
 *
 * Deliberately separate from `blob-store.ts`: there is no filesystem, no
 * network and no environment here, so every rule below is testable directly
 * rather than through a storage backend. The parts of a file that make it safe
 * should be the parts that are easiest to check.
 *
 * ## Two formats
 *
 * ```
 * v1  "LEXP1"  iv(12)  tag(16)  ciphertext              — legacy, read-only
 * v2  "LEXP2"  scheme(1)  workspaceId(4 LE)  iv(12)  tag(16)  ciphertext
 * ```
 *
 * v1 is never written again and never deleted from this file. Every blob stored
 * before this change is v1 ciphertext under the single global key, and the only
 * thing that can read it back is that key. Dropping v1 support would destroy
 * documents.
 *
 * ## What v2 fixes, and why it is not cosmetic
 *
 * v1 encrypts with AES-256-GCM under a fresh random IV, which authenticates the
 * *bytes* of a file. It does not authenticate *which file they are*. Nothing in
 * a v1 blob commits to its storage key, so anyone who can write to the blob
 * store — a leaked R2 token, a host operator, a backup restored to the wrong
 * place — can move file A's ciphertext onto file B's key and it decrypts
 * cleanly, tag valid, no error logged, and is served as file B. For a practice
 * where these files are evidence, silently serving one client's document in
 * place of another's is close to the worst available outcome.
 *
 * v2 binds the identity into the ciphertext as additional authenticated data:
 * the storage key, the owning workspace, and the key scheme. Move the blob,
 * change the workspace, or re-point the row, and the GCM tag fails. AAD is not
 * secret and is not stored — it is reconstructed at read time from the header
 * and from what the *caller* claims the file is, so a mismatch between the two
 * is exactly what fails.
 *
 * The AAD is built with the canonical encoder from `@workspace/crypto-core`
 * rather than by concatenating strings. Ad-hoc concatenation is ambiguous —
 * ("ab","c") and ("a","bc") produce the same bytes — and an ambiguous AAD is an
 * AAD that binds less than it appears to.
 */

const MAGIC_V1 = Buffer.from("LEXP1", "utf8");
const MAGIC_V2 = Buffer.from("LEXP2", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;

const V1_HEADER_BYTES = MAGIC_V1.length + IV_BYTES + TAG_BYTES;
const V2_HEADER_BYTES = MAGIC_V2.length + 1 + 4 + IV_BYTES + TAG_BYTES;

/**
 * How the content key was obtained. Part of the AAD, so a blob cannot be
 * replayed against a different custody arrangement once KMS lands.
 */
export const KeyScheme = {
  /** Per-tenant, HKDF-derived from an environment root. Today. */
  ENV_ROOT_HKDF: 1,
  /** Per-tenant, unwrapped from a KMS-held KEK. Reserved; not yet written. */
  KMS_WRAPPED: 2,
} as const;

export type KeySchemeCode = (typeof KeyScheme)[keyof typeof KeyScheme];

export class BlobFormatError extends Error {
  public override readonly name = "BlobFormatError";
}

/** What the blob claims about itself, before any key is involved. */
export type BlobFormat =
  | { readonly version: 1 }
  | { readonly version: 2; readonly keyScheme: number; readonly workspaceId: number }
  | { readonly version: 0 };

interface BlobAad {
  readonly keyScheme: number;
  readonly workspaceId: number;
  readonly storageKey: string;
}

/**
 * The authenticated-but-not-encrypted binding.
 *
 * Versioned like every other hashed or authenticated structure in this system:
 * the leading byte is inside the AAD, so a v2 blob can never be reinterpreted
 * under a future AAD layout.
 */
const blobAadV1 = versioned(
  1,
  struct<BlobAad>("blobAad", [
    ["keyScheme", u8],
    ["workspaceId", u32],
    ["storageKey", varText(1024, "storageKey")],
  ]) as Codec<BlobAad>,
);

function aadFor(keyScheme: number, workspaceId: number, storageKey: string): Buffer {
  return blobAadV1.encode({ keyScheme, workspaceId, storageKey });
}

function startsWith(buf: Buffer, magic: Buffer): boolean {
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

/**
 * What format a stored blob is in.
 *
 * `version: 0` means no recognised magic prefix — either a blob written before
 * encryption existed, or plaintext somebody substituted for ciphertext. This
 * function cannot tell those apart, and neither can anything else; the decision
 * about what to do belongs to `blob-store.ts`, which knows whether the
 * deployment is still expecting legacy plaintext.
 */
export function inspect(stored: Buffer): BlobFormat {
  if (startsWith(stored, MAGIC_V2)) {
    if (stored.length < V2_HEADER_BYTES) throw new BlobFormatError("v2 blob is truncated");
    return {
      version: 2,
      keyScheme: stored.readUInt8(MAGIC_V2.length),
      workspaceId: stored.readUInt32LE(MAGIC_V2.length + 1),
    };
  }
  if (startsWith(stored, MAGIC_V1)) {
    if (stored.length < V1_HEADER_BYTES) throw new BlobFormatError("v1 blob is truncated");
    return { version: 1 };
  }
  return { version: 0 };
}

/**
 * Encrypt for storage, binding the result to where it is about to be stored.
 *
 * The IV is 12 fresh random bytes from the CSPRNG on every call and is never
 * derived from the content, the key, or the storage key. GCM with a repeated
 * (key, IV) pair leaks the XOR of the two plaintexts and lets an attacker forge
 * tags — it is the one way to destroy this construction while everything still
 * appears to work. Blobs here are written once and never re-encrypted in place,
 * so the only route to reuse would be a deterministic IV. There must never be
 * one.
 */
export function encryptV2(params: {
  plain: Buffer;
  key: Buffer;
  keyScheme: KeySchemeCode;
  workspaceId: number;
  storageKey: string;
}): Buffer {
  const { plain, key, keyScheme, workspaceId, storageKey } = params;
  if (key.length !== 32) throw new BlobFormatError("content key must be 32 bytes");
  if (!Number.isInteger(workspaceId) || workspaceId < 1 || workspaceId > 0xffffffff) {
    throw new BlobFormatError(`workspaceId ${workspaceId} is out of range`);
  }

  // Random, per call, from node:crypto's CSPRNG. See the doc comment.
  const iv = randomIv();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(keyScheme, workspaceId, storageKey));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);

  const header = Buffer.alloc(MAGIC_V2.length + 1 + 4);
  MAGIC_V2.copy(header, 0);
  header.writeUInt8(keyScheme, MAGIC_V2.length);
  header.writeUInt32LE(workspaceId, MAGIC_V2.length + 1);

  return Buffer.concat([header, iv, cipher.getAuthTag(), body]);
}

/**
 * Decrypt a v2 blob, checking that it is the file the caller asked for.
 *
 * `expectedWorkspaceId` and `storageKey` come from the caller's own record of
 * what it is reading, never from the blob. That is the whole mechanism: the
 * header says what the blob claims, the arguments say what the database
 * believes, and the AAD makes the two agree or makes the tag fail.
 */
export function decryptV2(params: {
  stored: Buffer;
  key: Buffer;
  expectedWorkspaceId: number;
  storageKey: string;
}): Buffer {
  const { stored, key, expectedWorkspaceId, storageKey } = params;
  const format = inspect(stored);
  if (format.version !== 2) throw new BlobFormatError("not a v2 blob");

  // Checked explicitly as well as through the AAD. The AAD alone would fail the
  // tag and say only "unable to authenticate data", which is true and useless
  // to whoever has to work out why one chamber's download broke.
  if (format.workspaceId !== expectedWorkspaceId) {
    throw new BlobFormatError(
      `blob belongs to workspace ${format.workspaceId}, not ${expectedWorkspaceId}`,
    );
  }

  const ivAt = MAGIC_V2.length + 1 + 4;
  const iv = stored.subarray(ivAt, ivAt + IV_BYTES);
  const tag = stored.subarray(ivAt + IV_BYTES, V2_HEADER_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  // Derived from the CALLER's claim, not from the header, for workspaceId.
  decipher.setAAD(aadFor(format.keyScheme, expectedWorkspaceId, storageKey));
  decipher.setAuthTag(tag);
  // final() throws when the tag does not verify, which is the entire point.
  return Buffer.concat([decipher.update(stored.subarray(V2_HEADER_BYTES)), decipher.final()]);
}

/**
 * Decrypt a legacy v1 blob under the single global key.
 *
 * No AAD, and none can be added retroactively — the tag over these bytes was
 * computed without one. A v1 blob is therefore still swappable between storage
 * keys, and the only fix is to rewrite it as v2. That is why
 * `blob-store.ts` reports v1 reads and why the re-encryption task exists.
 */
export function decryptV1(stored: Buffer, key: Buffer): Buffer {
  if (inspect(stored).version !== 1) throw new BlobFormatError("not a v1 blob");
  const iv = stored.subarray(MAGIC_V1.length, MAGIC_V1.length + IV_BYTES);
  const tag = stored.subarray(MAGIC_V1.length + IV_BYTES, V1_HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(V1_HEADER_BYTES)), decipher.final()]);
}

/** Encrypt in the legacy v1 format. Used only by the plaintext migration task. */
export function encryptV1(plain: Buffer, key: Buffer): Buffer {
  const iv = randomIv();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC_V1, iv, cipher.getAuthTag(), body]);
}

/** 12 fresh bytes from the platform CSPRNG. Never derived, never reused. */
function randomIv(): Buffer {
  return randomBytes(IV_BYTES);
}
