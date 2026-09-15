/**
 * Tests for the hash and keyed-hash primitives.
 *
 * The known-answer vectors below are **published** values — FIPS 180-4 for
 * SHA-256, RFC 4231 for HMAC-SHA-256, RFC 5869 for HKDF — not values this
 * implementation produced and was then asserted against. That distinction is
 * the whole worth of a KAT: a vector taken from the code it tests only proves
 * the code is consistent with itself. These can be checked against the
 * specifications by someone who does not trust this repository, which is the
 * standard the rest of the system is held to as well.
 *
 * The double-SHA-256 vectors are the widely published Bitcoin ones, chosen for
 * the same reason: they are checkable against a source with no connection to
 * this project.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CryptoUsageError,
  SECRET_KEY_BYTES,
  constantTimeEqual,
  hash256,
  hkdf256,
  hmac256,
  randomBytes,
  randomSecretKey,
  sha256,
  zeroize,
} from "./hash.js";
import { HASH_LENGTH, fromHex, toHex } from "./encoding.js";

const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");

/* -------------------------------------------------------------------------- */

describe("sha256 — FIPS 180-4 known answers", () => {
  it("matches the published vectors", () => {
    assert.equal(
      toHex(sha256(utf8("abc"))),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(
      toHex(sha256(Buffer.alloc(0))),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    assert.equal(
      toHex(sha256(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("returns 32 bytes", () => {
    assert.equal(sha256(utf8("anything")).length, HASH_LENGTH);
  });
});

describe("hash256 — double SHA-256 known answers", () => {
  it("matches the published vectors", () => {
    assert.equal(
      toHex(hash256(Buffer.alloc(0))),
      "5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456",
    );
    assert.equal(
      toHex(hash256(utf8("hello"))),
      "9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50",
    );
    assert.equal(
      toHex(hash256(utf8("abc"))),
      "4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358",
    );
  });

  it("is sha256 applied to its own output, and nothing more", () => {
    // Stated as a test so a re-implementer can confirm the construction from
    // behaviour rather than having to trust the comment in hash.ts.
    const data = utf8("a legal record");
    assert.deepEqual(hash256(data), sha256(sha256(data)));
  });

  it("differs from single SHA-256", () => {
    const data = utf8("abc");
    assert.notDeepEqual(hash256(data), sha256(data));
  });
});

describe("hmac256 — RFC 4231 known answers", () => {
  it("matches test case 1", () => {
    assert.equal(
      toHex(hmac256(Buffer.alloc(20, 0x0b), utf8("Hi There"))),
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("matches test case 2", () => {
    assert.equal(
      toHex(hmac256(utf8("Jefe"), utf8("what do ya want for nothing?"))),
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("matches test case 3", () => {
    assert.equal(
      toHex(hmac256(Buffer.alloc(20, 0xaa), Buffer.alloc(50, 0xdd))),
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });

  it("rejects an empty key", () => {
    // HMAC pads a short key to the block size, so an empty key produces a
    // perfectly normal-looking MAC. That is exactly why it has to be refused.
    assert.throws(() => hmac256(Buffer.alloc(0), utf8("x")), CryptoUsageError);
  });

  it("changes completely when the key changes by one bit", () => {
    const a = hmac256(Buffer.alloc(32, 0x00), utf8("Matter 2026-041"));
    const flipped = Buffer.alloc(32, 0x00);
    flipped[0] = 0x01;
    assert.notDeepEqual(a, hmac256(flipped, utf8("Matter 2026-041")));
  });
});

describe("hkdf256 — RFC 5869 known answers", () => {
  it("matches test case 1", () => {
    const okm = hkdf256(
      Buffer.alloc(22, 0x0b),
      fromHex("000102030405060708090a0b0c"),
      fromHex("f0f1f2f3f4f5f6f7f8f9"),
      42,
    );
    assert.equal(
      toHex(okm),
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });

  it("separates purposes: the same secret with different info gives unrelated keys", () => {
    // The property the whole derivation scheme rests on. Without distinct
    // `info`, a MAC produced for one purpose verifies under another.
    const root = randomSecretKey();
    const salt = Buffer.alloc(0);
    const auditKey = hkdf256(root, salt, utf8("lex:audit-ref:v1"), SECRET_KEY_BYTES);
    const documentKey = hkdf256(root, salt, utf8("lex:document-ref:v1"), SECRET_KEY_BYTES);
    assert.notDeepEqual(auditKey, documentKey);
    assert.equal(auditKey.length, SECRET_KEY_BYTES);
  });

  it("is deterministic for the same inputs", () => {
    const root = fromHex("11".repeat(32));
    const once = hkdf256(root, Buffer.alloc(0), utf8("lex:audit-ref:v1"), 32);
    const twice = hkdf256(root, Buffer.alloc(0), utf8("lex:audit-ref:v1"), 32);
    assert.deepEqual(once, twice);
  });

  it("refuses empty keying material, empty info, and an impossible length", () => {
    const root = randomSecretKey();
    assert.throws(() => hkdf256(Buffer.alloc(0), Buffer.alloc(0), utf8("i"), 32), CryptoUsageError);
    assert.throws(() => hkdf256(root, Buffer.alloc(0), Buffer.alloc(0), 32), CryptoUsageError);
    assert.throws(() => hkdf256(root, Buffer.alloc(0), utf8("i"), 0), CryptoUsageError);
    assert.throws(() => hkdf256(root, Buffer.alloc(0), utf8("i"), 255 * 32 + 1), CryptoUsageError);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The enumeration attack, kept in the suite as documentation.
 *
 * This is the argument for why `hmac256` is mandatory for low-entropy
 * identifiers, made as a thing that runs rather than a paragraph that gets
 * skimmed. The attacker below does not break SHA-256 — SHA-256 is fine. They
 * guess the input, which for a matter reference is cheap, and read the answer
 * off a table.
 *
 * If somebody proposes storing `hash256(clientName)` in an anchored structure,
 * point them here.
 */
describe("hashing is not anonymisation for low-entropy input", () => {
  /** Every reference a firm could plausibly have used in 2026. */
  function plausibleReferences(): string[] {
    const firms = ["Sharma & Associates", "Mehta & Co", "Iyer Legal", "Banerjee Chambers"];
    const out: string[] = [];
    for (const firm of firms) {
      for (let n = 1; n <= 250; n += 1) {
        out.push(`${firm} / Matter 2026-${String(n).padStart(3, "0")}`);
      }
    }
    return out;
  }

  const secret = "Sharma & Associates / Matter 2026-041";

  it("SUCCEEDS against hash256: the digest is reversed by guessing", () => {
    const published = hash256(utf8(secret));

    // The attacker holds only `published`. They build the table themselves.
    const table = new Map<string, string>();
    for (const candidate of plausibleReferences()) {
      table.set(toHex(hash256(utf8(candidate))), candidate);
    }

    const recovered = table.get(toHex(published));
    assert.equal(recovered, secret, "a bare hash of a guessable value is reversible");
    assert.equal(table.size, 1000); // a thousand guesses, a fraction of a second
  });

  it("FAILS against hmac256: the same enumeration recovers nothing", () => {
    // The key is held in a KMS. The attacker has the digest and the format, and
    // that is no longer enough — every candidate they hash is a MAC under a key
    // they do not have.
    const tenantKey = randomSecretKey();
    const published = hmac256(tenantKey, utf8(secret));

    const table = new Map<string, string>();
    for (const candidate of plausibleReferences()) {
      table.set(toHex(hash256(utf8(candidate))), candidate);
    }

    assert.equal(table.get(toHex(published)), undefined);

    // Nor does guessing the key help: the search space is 2^256, not 1000.
    const wrongKey = randomSecretKey();
    assert.notDeepEqual(hmac256(wrongKey, utf8(secret)), published);
  });

  it("is why destroying the tenant key is erasure", () => {
    // The same property read from the other side. Once the key is gone, the
    // reference that was anchored can never be linked back to the value that
    // produced it — by us, by a regulator, or by the person who wrote it.
    const tenantKey = randomSecretKey();
    const anchored = hmac256(tenantKey, utf8(secret));

    zeroize(tenantKey);

    assert.notDeepEqual(hmac256(tenantKey, utf8(secret)), anchored);
    assert.equal(toHex(tenantKey), "00".repeat(SECRET_KEY_BYTES));
  });
});

/* -------------------------------------------------------------------------- */

describe("constantTimeEqual", () => {
  it("compares equal and unequal digests correctly", () => {
    const a = hash256(utf8("x"));
    assert.equal(constantTimeEqual(a, hash256(utf8("x"))), true);
    assert.equal(constantTimeEqual(a, hash256(utf8("y"))), false);
  });

  it("returns false on a length mismatch rather than throwing", () => {
    // timingSafeEqual throws here, and a throw inside a verification path is a
    // 500 where a `false` was meant.
    assert.equal(constantTimeEqual(Buffer.alloc(31), Buffer.alloc(32)), false);
    assert.equal(constantTimeEqual(Buffer.alloc(0), Buffer.alloc(0)), true);
  });

  it("returns false for anything that is not a Buffer", () => {
    assert.equal(constantTimeEqual("abc" as unknown as Buffer, Buffer.alloc(3)), false);
  });
});

describe("randomBytes", () => {
  it("returns the requested length and does not repeat", () => {
    const a = randomBytes(32);
    assert.equal(a.length, 32);
    assert.notDeepEqual(a, randomBytes(32));
  });

  it("produces keys of the declared secret length", () => {
    assert.equal(randomSecretKey().length, SECRET_KEY_BYTES);
  });

  it("rejects a non-positive length", () => {
    assert.throws(() => randomBytes(0), CryptoUsageError);
    assert.throws(() => randomBytes(-1), CryptoUsageError);
    assert.throws(() => randomBytes(1.5), CryptoUsageError);
  });

  it("has no obvious bias across a large sample", () => {
    // Not a statistical test of the CSPRNG — that is OpenSSL's job and cannot
    // be done meaningfully in a unit test. This catches the one failure that
    // would matter and would otherwise be silent: a stub that returns zeros,
    // or a constant, wired in during a refactor.
    const sample = randomBytes(4096);
    const seen = new Set<number>();
    for (const byte of sample) seen.add(byte);
    assert.equal(seen.size > 200, true, "byte values are not spread across the range");
  });
});

describe("zeroize", () => {
  it("clears the buffer in place", () => {
    const key = randomSecretKey();
    zeroize(key);
    assert.equal(toHex(key), "00".repeat(SECRET_KEY_BYTES));
  });

  it("does not affect a copy taken beforehand", () => {
    // The limitation, asserted rather than described: anything that copied the
    // key before the wipe still holds it. This is why key material must not be
    // passed around, and why zeroize is a mitigation and not a guarantee.
    const key = randomSecretKey();
    const leaked = Buffer.from(key);
    zeroize(key);
    assert.notDeepEqual(leaked, key);
  });
});
