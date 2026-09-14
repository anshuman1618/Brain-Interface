/**
 * Tests for the canonical encoding.
 *
 * These run under Node's built-in test runner (`node:test`), loaded through
 * `tsx`, so the package pulls in no test framework of its own — see
 * `DECISIONS.md`. Run them with `pnpm --filter @workspace/crypto-core run test`.
 *
 * A third of what follows is adversarial: malformed input, non-canonical
 * encodings, and the specific mistakes that would make two honest parties
 * compute two different hashes. Those are the tests that matter. A round-trip
 * test proves the encoder agrees with the decoder; it does not prove the
 * encoding is canonical, and canonical is the property every proof depends on.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ByteReader,
  ByteWriter,
  type Codec,
  EncodingError,
  HASH_LENGTH,
  array,
  bool,
  enumU16,
  fixedBytes,
  fromHex,
  hash,
  struct,
  toHex,
  u16,
  u32,
  u64,
  u8,
  varBytes,
  varText,
  versionRegistry,
  versioned,
  zeroHash,
} from "./encoding.js";
import {
  AuditAction,
  type AuditActionCode,
  type AuditEventV1,
  AuditSubject,
  type AuditSubjectCode,
  auditEventCodecs,
  auditEventV1,
} from "./structures.js";

/** Encodes one value on its own, for testing a codec in isolation. */
function encodeOne<T>(codec: Codec<T>, value: T): Buffer {
  const writer = new ByteWriter();
  codec.encodeInto(writer, value);
  return writer.finish();
}

/** Decodes one value on its own, rejecting trailing bytes. */
function decodeOne<T>(codec: Codec<T>, bytes: Buffer): T {
  const reader = new ByteReader(bytes);
  const value = codec.decodeFrom(reader);
  reader.finish();
  return value;
}

const sampleEvent: AuditEventV1 = {
  tenantRef: Buffer.alloc(HASH_LENGTH, 0x11),
  sequence: 42n,
  recordedAtMs: 1_767_225_600_000n, // 2026-01-01T00:00:00.000Z
  actorRef: Buffer.alloc(HASH_LENGTH, 0x22),
  action: AuditAction.RECORD_UPDATED,
  subjectType: AuditSubject.MATTER,
  subjectRef: Buffer.alloc(HASH_LENGTH, 0x33),
  contentHash: Buffer.alloc(HASH_LENGTH, 0x44),
  contextHash: zeroHash(),
};

/**
 * The frozen byte-for-byte encoding of `sampleEvent` under v1, written out
 * field by field so it can be checked by hand against `structures.ts` rather
 * than taken on trust from the implementation that produced it.
 *
 * If a change to this package makes this vector fail, that change has
 * invalidated every proof ever issued over a v1 audit event. It is not a test
 * to update — it is a signal that the change needs a v2 instead.
 */
const golden = fromHex(
  "01" + // version = 1
    "11".repeat(32) + // tenantRef
    "2a00000000000000" + // sequence = 42, little-endian u64
    "00a8da769b010000" + // recordedAtMs = 1767225600000, little-endian u64
    "22".repeat(32) + // actorRef
    "0300" + // action = RECORD_UPDATED (3), little-endian u16
    "0100" + // subjectType = MATTER (1), little-endian u16
    "33".repeat(32) + // subjectRef
    "44".repeat(32) + // contentHash
    "00".repeat(32), // contextHash
);

/* -------------------------------------------------------------------------- */

describe("integer codecs", () => {
  it("writes little-endian at the declared width", () => {
    assert.equal(toHex(encodeOne(u8, 0x12)), "12");
    assert.equal(toHex(encodeOne(u16, 0x1234)), "3412");
    assert.equal(toHex(encodeOne(u32, 0x12345678)), "78563412");
    assert.equal(toHex(encodeOne(u64, 0x0123456789abcdefn)), "efcdab8967452301");
  });

  it("round-trips the boundary values", () => {
    for (const value of [0, 255]) assert.equal(decodeOne(u8, encodeOne(u8, value)), value);
    for (const value of [0, 65535]) assert.equal(decodeOne(u16, encodeOne(u16, value)), value);
    for (const value of [0, 4294967295]) assert.equal(decodeOne(u32, encodeOne(u32, value)), value);
    for (const value of [0n, 0xffffffffffffffffn]) {
      assert.equal(decodeOne(u64, encodeOne(u64, value)), value);
    }
  });

  it("refuses values that do not fit, rather than truncating them", () => {
    assert.throws(() => encodeOne(u8, 256), EncodingError);
    assert.throws(() => encodeOne(u16, 65536), EncodingError);
    assert.throws(() => encodeOne(u32, 4294967296), EncodingError);
    assert.throws(() => encodeOne(u32, -1), EncodingError);
    assert.throws(() => encodeOne(u64, -1n), EncodingError);
    assert.throws(() => encodeOne(u64, 1n << 64n), EncodingError);
    assert.throws(() => encodeOne(u8, 1.5), EncodingError);
  });

  it("carries a 64-bit sequence past 2^53 without losing precision", () => {
    // The reason `u64` is a bigint and not a number. As a double this value is
    // indistinguishable from its neighbour, and two distinct records would
    // encode — and therefore hash — identically.
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    assert.equal(decodeOne(u64, encodeOne(u64, big)), big);
    assert.equal(Number(big), 9_007_199_254_740_992);
  });
});

describe("bool", () => {
  it("round-trips", () => {
    assert.equal(decodeOne(bool, encodeOne(bool, true)), true);
    assert.equal(decodeOne(bool, encodeOne(bool, false)), false);
  });

  it("rejects a non-canonical byte", () => {
    // Without this, 0x02..0xff are 254 further encodings of `true` and the
    // encoding is no longer injective.
    assert.throws(() => decodeOne(bool, Buffer.from([0x02])), EncodingError);
  });
});

describe("fixed-width bytes", () => {
  it("round-trips and reports its size", () => {
    const codec = fixedBytes(4);
    const value = Buffer.from([1, 2, 3, 4]);
    assert.equal(codec.fixedSize, 4);
    assert.deepEqual(decodeOne(codec, encodeOne(codec, value)), value);
  });

  it("rejects the wrong length on encode", () => {
    assert.throws(() => encodeOne(hash, Buffer.alloc(31)), EncodingError);
    assert.throws(() => encodeOne(hash, Buffer.alloc(33)), EncodingError);
  });

  it("does not alias the source buffer on decode", () => {
    // A decoded value that is a view onto the input changes retroactively when
    // the input buffer is reused — after the value has already been hashed.
    const source = Buffer.alloc(HASH_LENGTH, 0xaa);
    const decoded = decodeOne(hash, source);
    source.fill(0xbb);
    assert.deepEqual(decoded, Buffer.alloc(HASH_LENGTH, 0xaa));
  });
});

describe("length-prefixed fields", () => {
  it("round-trips bytes and prefixes the length little-endian", () => {
    const codec = varBytes();
    const encoded = encodeOne(codec, Buffer.from([0xde, 0xad]));
    assert.equal(toHex(encoded), "02000000dead");
    assert.deepEqual(decodeOne(codec, encoded), Buffer.from([0xde, 0xad]));
  });

  it("makes concatenation unambiguous", () => {
    // The whole reason for a length prefix. Without one, ("ab", "c") and
    // ("a", "bc") produce the same bytes and therefore the same hash.
    const pair = struct<{ left: Buffer; right: Buffer }>("pair", [
      ["left", varBytes()],
      ["right", varBytes()],
    ]);
    const a = encodeOne(pair, { left: Buffer.from("ab"), right: Buffer.from("c") });
    const b = encodeOne(pair, { left: Buffer.from("a"), right: Buffer.from("bc") });
    assert.notDeepEqual(a, b);
  });

  it("refuses a declared length beyond the cap without allocating it", () => {
    const codec = varBytes(8);
    const hostile = Buffer.concat([fromHex("ffffffff"), Buffer.alloc(4)]);
    assert.throws(() => decodeOne(codec, hostile), EncodingError);
    assert.throws(() => encodeOne(codec, Buffer.alloc(9)), EncodingError);
  });

  it("refuses a truncated body", () => {
    assert.throws(() => decodeOne(varBytes(), fromHex("04000000dead")), EncodingError);
  });
});

describe("varText", () => {
  // U+00E9, against "e" followed by combining acute U+0301. Identical on
  // screen, identical to a reader, different bytes until they are normalised.
  const nfc = "caf\u00e9";
  const nfd = "cafe\u0301";

  it("normalises to NFC, so the same text hashes the same either way", () => {
    assert.notEqual(nfc, nfd);
    assert.deepEqual(encodeOne(varText(), nfc), encodeOne(varText(), nfd));
  });

  it("round-trips to the NFC form, which is the canonical value", () => {
    const codec = varText();
    assert.equal(decodeOne(codec, encodeOne(codec, nfd)), nfc);
    assert.equal(decodeOne(codec, encodeOne(codec, "Sharma & Associates")), "Sharma & Associates");
    const devanagari = "उच्च न्यायालय";
    assert.equal(decodeOne(codec, encodeOne(codec, devanagari)), devanagari.normalize("NFC"));
  });

  it("rejects an unpaired surrogate instead of substituting U+FFFD", () => {
    // Buffer.from(s, "utf8") maps every lone surrogate onto the same
    // replacement character, collapsing distinct strings onto one encoding.
    assert.throws(() => encodeOne(varText(), "\ud800"), EncodingError);
    assert.throws(() => encodeOne(varText(), "a\udc00b"), EncodingError);
    assert.doesNotThrow(() => encodeOne(varText(), "👍"));
  });

  it("rejects malformed UTF-8 on decode", () => {
    const badUtf8 = Buffer.concat([fromHex("02000000"), Buffer.from([0xc3, 0x28])]);
    assert.throws(() => decodeOne(varText(), badUtf8), EncodingError);
  });

  it("rejects non-NFC bytes on decode", () => {
    // Otherwise a decoded value would re-encode to different bytes, and a
    // verifier recomputing the hash from a decoded record would disagree with
    // the party who wrote it.
    const body = Buffer.from(nfd, "utf8");
    const framed = Buffer.concat([Buffer.alloc(4), body]);
    framed.writeUInt32LE(body.length, 0);
    assert.throws(() => decodeOne(varText(), framed), EncodingError);
  });
});

describe("array", () => {
  it("round-trips and counts little-endian", () => {
    const codec = array(u16);
    const encoded = encodeOne(codec, [1, 2, 3]);
    assert.equal(toHex(encoded), "03000000010002000300");
    assert.deepEqual(decodeOne(codec, encoded), [1, 2, 3]);
  });

  it("distinguishes the empty array from an absent field", () => {
    assert.equal(toHex(encodeOne(array(u16), [])), "00000000");
  });

  it("refuses a declared count beyond the cap", () => {
    assert.throws(() => decodeOne(array(u16, 2), fromHex("ffffffff")), EncodingError);
  });
});

describe("enumU16", () => {
  it("rejects an unknown code on both sides", () => {
    const codec = enumU16<1 | 2>("colour", [1, 2]);
    assert.equal(decodeOne(codec, encodeOne(codec, 2)), 2);
    assert.throws(() => decodeOne(codec, fromHex("3713")), EncodingError);
    assert.throws(() => encodeOne(codec, 3 as unknown as 1 | 2), EncodingError);
  });
});

/* -------------------------------------------------------------------------- */

describe("struct", () => {
  const ab = struct<{ a: number; b: number }>("ab", [
    ["a", u8],
    ["b", u8],
  ]);

  it("encodes in declared field order, not object key order", () => {
    // The central property: two records with the same values, built by
    // different code paths, must produce the same bytes.
    assert.equal(toHex(encodeOne(ab, { a: 1, b: 2 })), "0102");
    assert.equal(toHex(encodeOne(ab, { b: 2, a: 1 })), "0102");
  });

  it("refuses a field the encoding does not know about", () => {
    // Otherwise a field added to the record type and forgotten here would
    // simply not be hashed: the record would look protected and would not be.
    const codec = struct<{ a: number }>("a", [["a", u8]]);
    assert.throws(
      () => encodeOne(codec, { a: 1, surprise: 2 } as unknown as { a: number }),
      EncodingError,
    );
  });

  it("refuses a missing field rather than encoding a default", () => {
    assert.throws(
      () => encodeOne(ab, { a: 1 } as unknown as { a: number; b: number }),
      EncodingError,
    );
  });

  it("reports a fixed size only when every field is fixed", () => {
    const fixed = struct<{ a: number; b: Buffer }>("fixed", [
      ["a", u32],
      ["b", hash],
    ]);
    const variable = struct<{ a: number; b: Buffer }>("variable", [
      ["a", u32],
      ["b", varBytes()],
    ]);
    assert.equal(fixed.fixedSize, 36);
    assert.equal(variable.fixedSize, null);
  });
});

describe("JSON.stringify would not do", () => {
  it("produces different strings for records that must hash the same", () => {
    // Kept as executable documentation for the rule at the top of encoding.ts.
    // This is precisely the failure the canonical encoder exists to prevent.
    const fromRow = { a: 1, b: 2 };
    const fromRequest: { a: number; b: number } = { b: 2, a: 1 };

    // The one sanctioned JSON.stringify in this package: it is the thing being
    // demonstrated, not a thing being used. The lint rule is correct everywhere else.
    // eslint-disable-next-line no-restricted-properties
    assert.notEqual(JSON.stringify(fromRow), JSON.stringify(fromRequest));

    const codec = struct<{ a: number; b: number }>("ab", [
      ["a", u8],
      ["b", u8],
    ]);
    assert.deepEqual(encodeOne(codec, fromRow), encodeOne(codec, fromRequest));
  });
});

/* -------------------------------------------------------------------------- */

describe("versioning", () => {
  const body = struct<{ a: number }>("x", [["a", u8]]);

  it("puts the version byte inside the encoded bytes", () => {
    const codec = versioned(1, body);
    assert.equal(toHex(codec.encode({ a: 7 })), "0107");
    assert.equal(codec.fixedSize, 2);
  });

  it("refuses to decode a different version", () => {
    assert.throws(() => versioned(1, body).decode(fromHex("0207")), EncodingError);
  });

  it("refuses trailing bytes", () => {
    // Two byte strings decoding to one value would mean two hashes for one
    // record, and a verifier with no way to say which is correct.
    const padded = Buffer.concat([golden, Buffer.from([0x00])]);
    assert.throws(() => auditEventV1.decode(padded), EncodingError);
  });

  it("refuses a truncated buffer", () => {
    assert.throws(() => auditEventV1.decode(golden.subarray(0, golden.length - 1)), EncodingError);
  });

  it("rejects a version outside 1..255", () => {
    assert.throws(() => versioned(0, body), EncodingError);
    assert.throws(() => versioned(256, body), EncodingError);
  });
});

/**
 * The forward-compatibility requirement: introducing a v2 must not disturb a
 * single byte of v1, because every proof issued over a v1 record depends on
 * those exact bytes, and a legal record outlives the schema by decades.
 *
 * `auditEventV2` here stands in for a future version. It is defined in the test
 * rather than in `src` on purpose, so nothing in production can start writing
 * it by accident.
 */
describe("a v1 record after v2 exists", () => {
  interface AuditEventV2 extends AuditEventV1 {
    readonly retentionClass: number;
  }

  const auditEventV2 = versioned(
    2,
    struct<AuditEventV2>("auditEvent", [
      ["tenantRef", hash],
      ["sequence", u64],
      ["recordedAtMs", u64],
      ["actorRef", hash],
      ["action", enumU16<AuditActionCode>("action", Object.values(AuditAction))],
      ["subjectType", enumU16<AuditSubjectCode>("subject", Object.values(AuditSubject))],
      ["subjectRef", hash],
      ["contentHash", hash],
      ["contextHash", hash],
      ["retentionClass", u8],
    ]),
  );

  const registry = versionRegistry<AuditEventV1>("auditEvent", [auditEventV1, auditEventV2]);

  it("still encodes to the same bytes it always did", () => {
    assert.equal(toHex(auditEventV1.encode(sampleEvent)), toHex(golden));
  });

  it("still decodes, through a registry that also knows v2", () => {
    const decoded = registry.decode(golden);
    assert.equal(decoded.version, 1);
    assert.deepEqual(decoded.value, sampleEvent);
  });

  it("routes v2 bytes to v2", () => {
    const v2Bytes = auditEventV2.encode({ ...sampleEvent, retentionClass: 3 });
    assert.equal(registry.peekVersion(v2Bytes), 2);
    assert.equal(registry.decode(v2Bytes).version, 2);
    assert.equal(v2Bytes.length, golden.length + 1);
  });

  it("does not silently reinterpret v1 bytes as v2", () => {
    assert.throws(() => auditEventV2.decode(golden), EncodingError);
  });

  it("rejects a version nobody has registered", () => {
    const unknown = Buffer.from(golden);
    unknown.writeUInt8(9, 0);
    assert.throws(() => registry.decode(unknown), EncodingError);
  });
});

/* -------------------------------------------------------------------------- */

describe("auditEventV1", () => {
  it("is exactly 181 bytes: 1 version + 180 body", () => {
    // The fixed size is a privacy property here, not a performance one: with no
    // variable-length field, no caller can append free text to a structure that
    // is about to be anchored and can never be deleted.
    assert.equal(auditEventV1.fixedSize, 181);
    assert.equal(auditEventV1.encode(sampleEvent).length, 181);
  });

  it("round-trips", () => {
    assert.deepEqual(auditEventV1.decode(auditEventV1.encode(sampleEvent)), sampleEvent);
  });

  it("matches the frozen golden encoding", () => {
    assert.equal(toHex(auditEventV1.encode(sampleEvent)), toHex(golden));
  });

  it("encodes identically from two different construction paths", () => {
    // Path A: a field literal in schema order. Path B: a spread that reorders
    // every key, as an update helper or a row mapper would.
    const pathA: AuditEventV1 = {
      tenantRef: Buffer.alloc(HASH_LENGTH, 0x11),
      sequence: 42n,
      recordedAtMs: 1_767_225_600_000n,
      actorRef: Buffer.alloc(HASH_LENGTH, 0x22),
      action: AuditAction.RECORD_UPDATED,
      subjectType: AuditSubject.MATTER,
      subjectRef: Buffer.alloc(HASH_LENGTH, 0x33),
      contentHash: Buffer.alloc(HASH_LENGTH, 0x44),
      contextHash: zeroHash(),
    };
    const pathB: AuditEventV1 = {
      contextHash: zeroHash(),
      contentHash: fromHex("44".repeat(32)),
      subjectRef: fromHex("33".repeat(32)),
      ...{ subjectType: AuditSubject.MATTER, action: AuditAction.RECORD_UPDATED },
      actorRef: fromHex("22".repeat(32)),
      recordedAtMs: BigInt(1_767_225_600_000),
      sequence: BigInt(42),
      tenantRef: fromHex("11".repeat(32)),
    };

    assert.notEqual(Object.keys(pathA).join(), Object.keys(pathB).join());
    assert.deepEqual(auditEventV1.encode(pathA), auditEventV1.encode(pathB));
  });

  it("changes its bytes when any single field changes", () => {
    // Injectivity, spot-checked field by field. If two distinct events shared
    // an encoding, one could be swapped for the other under a valid proof.
    const variants: AuditEventV1[] = [
      { ...sampleEvent, sequence: 43n },
      { ...sampleEvent, recordedAtMs: sampleEvent.recordedAtMs + 1n },
      { ...sampleEvent, action: AuditAction.RECORD_DELETED },
      { ...sampleEvent, subjectType: AuditSubject.DOCUMENT },
      { ...sampleEvent, tenantRef: Buffer.alloc(HASH_LENGTH, 0x12) },
      { ...sampleEvent, actorRef: zeroHash() },
      { ...sampleEvent, subjectRef: zeroHash() },
      { ...sampleEvent, contentHash: zeroHash() },
      { ...sampleEvent, contextHash: Buffer.alloc(HASH_LENGTH, 0x01) },
    ];
    const seen = new Set([toHex(auditEventV1.encode(sampleEvent))]);
    for (const variant of variants) {
      const encoded = toHex(auditEventV1.encode(variant));
      assert.equal(seen.has(encoded), false, "two distinct events share an encoding");
      seen.add(encoded);
    }
  });

  it("refuses an action code that is not in the enumeration", () => {
    const bogus = { ...sampleEvent, action: 999 } as unknown as AuditEventV1;
    assert.throws(() => auditEventV1.encode(bogus), EncodingError);
  });

  it("decodes through the production registry", () => {
    const decoded = auditEventCodecs.decode(golden);
    assert.equal(decoded.version, 1);
    assert.deepEqual(decoded.value, sampleEvent);
  });
});

/* -------------------------------------------------------------------------- */

describe("hex boundary", () => {
  it("round-trips", () => {
    const value = Buffer.from([0x00, 0x0f, 0xff]);
    assert.equal(toHex(value), "000fff");
    assert.deepEqual(fromHex("000fff"), value);
  });

  it("is strict, so a pasted digest fails loudly rather than quietly", () => {
    assert.throws(() => fromHex("0x00ff"), EncodingError);
    assert.throws(() => fromHex("00FF"), EncodingError);
    assert.throws(() => fromHex("abc"), EncodingError);
    assert.throws(() => fromHex("zz"), EncodingError);
    assert.throws(() => fromHex("00ff", HASH_LENGTH), EncodingError);
  });
});

describe("zeroHash", () => {
  it("is 32 zero bytes, and a fresh buffer each time", () => {
    assert.equal(zeroHash().length, HASH_LENGTH);
    assert.equal(toHex(zeroHash()), "00".repeat(HASH_LENGTH));
    zeroHash().fill(0xff);
    assert.equal(toHex(zeroHash()), "00".repeat(HASH_LENGTH));
  });
});

describe("ByteReader", () => {
  it("rejects trailing bytes at finish()", () => {
    const reader = new ByteReader(Buffer.from([1, 2]));
    reader.read(1);
    assert.throws(() => reader.finish(), EncodingError);
  });

  it("rejects a read past the end", () => {
    const reader = new ByteReader(Buffer.from([1]));
    assert.throws(() => reader.read(2), EncodingError);
    assert.throws(() => reader.read(-1), EncodingError);
  });
});
