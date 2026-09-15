/**
 * Hash and keyed-hash primitives.
 *
 * Thin wrappers over `node:crypto`, which is OpenSSL. Nothing here implements a
 * cryptographic algorithm — the wrappers exist to give the rest of the codebase
 * exactly one way to hash a thing, with the argument order and the key-length
 * rules fixed in one place, and to make the choice between `hash256` and
 * `hmac256` a decision somebody had to make rather than a default they fell
 * into. That choice is the entire privacy design; see below.
 *
 * ## `hash256` or `hmac256`
 *
 * **`hash256` is for high-entropy content only** — document bytes, and nothing
 * else. A file's contents cannot be recovered from its digest because the input
 * space is astronomically large.
 *
 * **`hmac256` under a secret key is mandatory for everything else**: a client
 * name, a matter number, a case type, a date, an email address, a workspace id.
 * These have small, guessable domains. `sha256("Sharma & Associates / Matter
 * 2026-041")` is not anonymised — an attacker who can guess the format
 * enumerates a few million candidates, hashes each, and reads the answer off a
 * lookup table. `hash.test.ts` carries that attack as a passing test, working
 * against `hash256` and failing against `hmac256`, because the argument gets
 * made in review roughly once a year and a demonstration ends it faster than a
 * paragraph does.
 *
 * Hashing is not anonymisation when the input space is small enough to search.
 * That sentence is the rule; everything else in this file is machinery.
 *
 * ## Why SHA-256 twice
 *
 * `hash256` is SHA-256 applied to its own output. It costs one extra
 * compression of a 32-byte block — nothing, next to the I/O around it — and it
 * removes length-extension as a failure mode. SHA-256 is a Merkle–Damgård
 * construction, so from `sha256(secret ‖ m)` and `len(secret)` an attacker can
 * compute `sha256(secret ‖ m ‖ padding ‖ suffix)` without knowing the secret.
 * Nothing here is currently written as `sha256(secret ‖ m)` — but somebody will
 * eventually make a hashed input variable-length, and this removes the class of
 * bug rather than relying on that person to know about it. It is also what
 * Bitcoin does, which means the construction has the most adversarial review
 * per line of any hash usage in existence, and the published test vectors below
 * are checkable against a source that has nothing to do with us.
 *
 * ## No SHA-3, no BLAKE
 *
 * Both are fine hashes. Neither is more available: SHA-256 is in every
 * language's standard library, in hardware on every server, and in every
 * court-appointed expert's toolkit. A verifier who has to install something to
 * check our proof is a verifier who does not check our proof.
 */

import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import { HASH_LENGTH, type Hash } from "./encoding.js";

/** Thrown when a primitive is called with arguments that are a bug, not data. */
export class CryptoUsageError extends Error {
  public override readonly name = "CryptoUsageError";
}

/**
 * Keys this codebase generates are always 32 bytes from a CSPRNG or a KMS.
 *
 * Enforced at the key-provider boundary rather than here: HMAC itself is
 * defined for any key length, and a primitive that cannot reproduce the RFC
 * 4231 vectors — which use 4- and 20-byte keys — is a primitive nobody can
 * check against the specification. Verifiability is the whole point of this
 * package, so the conformance path stays open and the policy lives where keys
 * are issued.
 */
export const SECRET_KEY_BYTES = 32;

/* -------------------------------------------------------------------------- */
/* Hashing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One round of SHA-256.
 *
 * Exported because interoperability sometimes demands plain SHA-256 — an RFC
 * 3161 timestamp request, an S3 SigV4 signature, a published digest somebody
 * else computed. Do not reach for it to hash a record: `hash256` is the
 * construction the rest of this system is defined over.
 */
export function sha256(data: Buffer): Hash {
  return createHash("sha256").update(data).digest();
}

/**
 * SHA-256 applied twice. The hash every structure in this system is committed
 * under. High-entropy input only — see the header comment.
 */
export function hash256(data: Buffer): Hash {
  return sha256(sha256(data));
}

/* -------------------------------------------------------------------------- */
/* Keyed hashing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * HMAC-SHA-256.
 *
 * The right tool for any input with a guessable domain. The key must be secret:
 * the security of every identifier reference in an anchored structure rests on
 * an attacker not holding it, and the erasure story in
 * `docs/DPDP-ARCHITECTURE.md` rests on that key being destroyable.
 *
 * Not doubled, unlike `hash256`. HMAC is already a two-pass construction and is
 * not vulnerable to length extension; wrapping it again would add a step that
 * buys nothing and that a re-implementer would have to be told about.
 */
export function hmac256(key: Buffer, data: Buffer): Hash {
  if (!Buffer.isBuffer(key)) throw new CryptoUsageError("hmac256: key must be a Buffer");
  // An empty key is never a deliberate choice. HMAC accepts one — it pads to
  // the block size — and the result looks exactly like a real MAC, so this
  // would otherwise ship as "working".
  if (key.length === 0) throw new CryptoUsageError("hmac256: key is empty");
  return createHmac("sha256", key).update(data).digest();
}

/**
 * HKDF-SHA-256 (RFC 5869) — one high-entropy secret in, many independent keys
 * out.
 *
 * `info` is a domain separator and is not optional in practice: two purposes
 * derived from the same secret with the same `info` produce the same key, and a
 * key reused across purposes means a MAC from one context verifies in another.
 * Pass something that names the purpose, e.g. `"lex:audit-ref:v1"`.
 *
 * `salt` may be empty when the input keying material is already a uniformly
 * random secret, which is the usual case here (KMS-issued key material). It is
 * still a parameter rather than a constant, because a caller deriving from
 * something weaker needs it.
 */
export function hkdf256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  if (ikm.length === 0) throw new CryptoUsageError("hkdf256: input keying material is empty");
  if (info.length === 0) throw new CryptoUsageError("hkdf256: info is empty (see the doc comment)");
  if (!Number.isInteger(length) || length < 1 || length > 255 * HASH_LENGTH) {
    throw new CryptoUsageError(`hkdf256: length ${length} is outside 1..${255 * HASH_LENGTH}`);
  }
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/* -------------------------------------------------------------------------- */
/* Comparison, randomness, erasure                                            */
/* -------------------------------------------------------------------------- */

/**
 * Compares two byte strings without leaking, through timing, how far they
 * matched.
 *
 * `Buffer.equals` and `===` return as soon as they find a difference, so the
 * time they take measures the length of the common prefix. Against a value an
 * attacker can submit repeatedly — a MAC on a token, a proof — that is enough
 * to recover the expected value one byte at a time.
 *
 * Length is compared first and in variable time, deliberately: `timingSafeEqual`
 * throws on a length mismatch, and every value compared here is a fixed-width
 * digest whose length is public anyway.
 */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Cryptographically secure random bytes, from the platform CSPRNG.
 *
 * Exported so that no caller anywhere in this codebase has a reason to reach
 * for `Math.random()`, which is a fast non-cryptographic PRNG whose output is
 * predictable from a handful of prior values. A salt, a token or a key drawn
 * from it is not secret.
 */
export function randomBytes(length: number): Buffer {
  if (!Number.isInteger(length) || length < 1) {
    throw new CryptoUsageError(`randomBytes: length ${length} must be a positive integer`);
  }
  return nodeRandomBytes(length);
}

/** A fresh 32-byte secret, for a per-tenant key or a per-document salt. */
export function randomSecretKey(): Buffer {
  return randomBytes(SECRET_KEY_BYTES);
}

/**
 * Overwrites a buffer holding key material.
 *
 * **Read this before relying on it.** On a managed runtime, zeroization is
 * best-effort and nothing more, and claiming otherwise in a compliance document
 * would be false:
 *
 *  - A `string` cannot be wiped at all. JavaScript strings are immutable, and
 *    the engine may have interned or copied one anywhere. **Key material must
 *    never be held in a string** — which is the actual mitigation, and the
 *    reason every key in this codebase is a `Buffer` from the moment it exists.
 *  - V8's garbage collector relocates objects. A `Buffer`'s bytes live outside
 *    the JS heap, which is why this works at all for `Buffer`, but any
 *    intermediate copy made by a library is beyond reach.
 *  - Neither this nor anything else in a Node process prevents the operating
 *    system from having paged that memory to disk, or a container host from
 *    snapshotting it.
 *
 * So: call it when a key goes out of scope, because it shortens the window in
 * which a heap dump is useful. Do not treat it as a guarantee, and do not let
 * its presence justify holding a key in memory longer than necessary.
 */
export function zeroize(secret: Buffer): void {
  secret.fill(0);
}
