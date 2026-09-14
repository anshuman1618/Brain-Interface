/**
 * Canonical encoding — how a structure becomes bytes before it is hashed.
 *
 * Everything downstream of this file (the audit chain, Merkle roots, inclusion
 * proofs, signed heads, on-chain anchors) is a hash of bytes produced here. If
 * "the bytes for this record" is ever ambiguous — if two callers holding the
 * same values can produce two different byte strings — then two honest parties
 * compute two different hashes, the proof fails, and nothing in the failure
 * says *why*. A canonicalisation bug is silent, retroactive, and unfixable
 * once proofs have been issued. This file therefore errs heavily towards being
 * strict and boring.
 *
 * The rules, all of which the code below enforces rather than merely
 * documents:
 *
 *   1. Field order is fixed by an ORDERED ARRAY, never by object key order.
 *   2. Every integer has an explicit width and is written LITTLE-ENDIAN.
 *   3. Every variable-length field is LENGTH-PREFIXED, so concatenation is
 *      unambiguous and no two distinct values share an encoding.
 *   4. Every encoded structure begins with a `version: uint8`.
 *   5. Decoding is total and strict: out-of-range values, non-canonical
 *      booleans, short buffers and trailing bytes are all errors.
 *
 * ## Why `JSON.stringify` is forbidden in any hashing path
 *
 * `JSON.stringify` serialises an object in key *insertion* order. Insertion
 * order depends on how the object was constructed, not on what it contains, so
 * two semantically identical records built by different code paths — one from a
 * database row, one from a request body, one from an object spread that
 * reordered a field — serialise to different strings and therefore hash to
 * different digests. Nothing throws; the proof simply stops verifying, months
 * later, for records nobody can identify. JSON also has no canonical form for
 * numbers (`1` vs `1.0` vs `1e0`), silently truncates integers past 2^53, drops
 * `undefined` members, and turns a `Buffer` into an object of digits.
 *
 * So: no `JSON.stringify` here, and no "simplification" that reintroduces it.
 * An eslint rule in the repository root enforces this for the whole package —
 * see `eslint.config.mjs`. If you are reading this because that rule fired,
 * the rule is right and the code is wrong.
 *
 * ## Hashes are `Buffer`
 *
 * A hash is 32 bytes. It is a `Buffer` everywhere inside this package and every
 * package that depends on it. Hex is a *display* encoding: it exists at the
 * edges — a log line, an API response, a URL — and `toHex`/`fromHex` below are
 * the only sanctioned crossings. A hash stored as a hex string in a core type
 * invites case-sensitivity bugs, `0x`-prefix bugs, and length checks that pass
 * on a 64-character string that is not hex at all.
 */

export const HASH_LENGTH = 32;

/**
 * A 32-byte digest. Deliberately an alias of `Buffer` rather than a branded
 * type: the codecs below validate length at every boundary, and a brand would
 * mostly generate casts at call sites without adding a real check.
 */
export type Hash = Buffer;

/** Thrown for every canonicalisation failure, on both the encode and decode side. */
export class EncodingError extends Error {
  public override readonly name = "EncodingError";
}

function fail(message: string): never {
  throw new EncodingError(message);
}

/* -------------------------------------------------------------------------- */
/* Writer and reader                                                          */
/* -------------------------------------------------------------------------- */

/** Accumulates bytes. Chunks are concatenated once, at `finish()`. */
export class ByteWriter {
  private readonly chunks: Buffer[] = [];
  private length = 0;

  public write(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  public writeUint(value: number, width: 1 | 2 | 4): void {
    if (!Number.isInteger(value)) fail(`expected an integer, got ${String(value)}`);
    const max = width === 4 ? 0xffffffff : (1 << (width * 8)) - 1;
    if (value < 0 || value > max) fail(`value ${value} does not fit in a uint${width * 8}`);
    const buf = Buffer.allocUnsafe(width);
    // Little-endian throughout. See the header comment: one endianness, stated
    // once, so no structure can disagree with another about what "u32" means.
    if (width === 1) buf.writeUInt8(value, 0);
    else if (width === 2) buf.writeUInt16LE(value, 0);
    else buf.writeUInt32LE(value, 0);
    this.write(buf);
  }

  public writeUint64(value: bigint): void {
    if (value < 0n || value > 0xffffffffffffffffn) fail(`value ${value} does not fit in a uint64`);
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(value, 0);
    this.write(buf);
  }

  public finish(): Buffer {
    return Buffer.concat(this.chunks, this.length);
  }
}

/** Reads bytes with bounds checks on every access. */
export class ByteReader {
  private offset = 0;

  public constructor(private readonly source: Buffer) {}

  public get remaining(): number {
    return this.source.length - this.offset;
  }

  public read(length: number): Buffer {
    if (length < 0) fail(`cannot read a negative length (${length})`);
    if (length > this.remaining) {
      fail(`truncated: ${length} bytes requested with ${this.remaining} remaining`);
    }
    // Copied, not a subarray view: a decoded value must not alias the input
    // buffer, or a later mutation of that buffer silently changes a value that
    // has already been hashed.
    const out = Buffer.from(this.source.subarray(this.offset, this.offset + length));
    this.offset += length;
    return out;
  }

  public readUint(width: 1 | 2 | 4): number {
    const buf = this.read(width);
    if (width === 1) return buf.readUInt8(0);
    if (width === 2) return buf.readUInt16LE(0);
    return buf.readUInt32LE(0);
  }

  public readUint64(): bigint {
    return this.read(8).readBigUInt64LE(0);
  }

  /** Rejects trailing bytes. Two byte strings must never decode to one value. */
  public finish(): void {
    if (this.remaining !== 0) fail(`${this.remaining} trailing byte(s) after the encoded value`);
  }
}

/* -------------------------------------------------------------------------- */
/* Codecs                                                                     */
/* -------------------------------------------------------------------------- */

export interface Codec<T> {
  /** Used only in error messages. */
  readonly name: string;
  /** Byte width when constant, `null` when the codec is variable-length. */
  readonly fixedSize: number | null;
  encodeInto(writer: ByteWriter, value: T): void;
  decodeFrom(reader: ByteReader): T;
}

export const u8: Codec<number> = {
  name: "u8",
  fixedSize: 1,
  encodeInto: (w, v) => w.writeUint(v, 1),
  decodeFrom: (r) => r.readUint(1),
};

export const u16: Codec<number> = {
  name: "u16",
  fixedSize: 2,
  encodeInto: (w, v) => w.writeUint(v, 2),
  decodeFrom: (r) => r.readUint(2),
};

export const u32: Codec<number> = {
  name: "u32",
  fixedSize: 4,
  encodeInto: (w, v) => w.writeUint(v, 4),
  decodeFrom: (r) => r.readUint(4),
};

/**
 * 64-bit unsigned, carried as `bigint`. Not `number`: a millisecond timestamp
 * is already 41 bits and a sequence counter is unbounded, and silently losing
 * precision past 2^53 in a field that feeds a hash is exactly the class of bug
 * this file exists to prevent.
 */
export const u64: Codec<bigint> = {
  name: "u64",
  fixedSize: 8,
  encodeInto: (w, v) => w.writeUint64(v),
  decodeFrom: (r) => r.readUint64(),
};

/**
 * One byte, 0 or 1. Any other byte is rejected on decode — otherwise 254 other
 * encodings of `true` would exist and the encoding would not be canonical.
 */
export const bool: Codec<boolean> = {
  name: "bool",
  fixedSize: 1,
  encodeInto: (w, v) => w.writeUint(v ? 1 : 0, 1),
  decodeFrom: (r) => {
    const byte = r.readUint(1);
    if (byte > 1) fail(`non-canonical bool: 0x${byte.toString(16)}`);
    return byte === 1;
  },
};

/** A fixed-width byte field. Length is asserted on both encode and decode. */
export function fixedBytes(length: number, name = `bytes${length}`): Codec<Buffer> {
  if (!Number.isInteger(length) || length < 0) fail(`bad fixed length ${length}`);
  return {
    name,
    fixedSize: length,
    encodeInto: (w, v) => {
      if (!Buffer.isBuffer(v)) fail(`${name}: expected a Buffer`);
      if (v.length !== length) fail(`${name}: expected ${length} bytes, got ${v.length}`);
      w.write(v);
    },
    decodeFrom: (r) => r.read(length),
  };
}

/** A 32-byte digest field. */
export const hash: Codec<Hash> = fixedBytes(HASH_LENGTH, "hash");

/** 32 zero bytes — the genesis predecessor, and the "no content" sentinel. */
export function zeroHash(): Hash {
  return Buffer.alloc(HASH_LENGTH, 0);
}

/**
 * Variable-length bytes, prefixed with a `u32` length.
 *
 * `maxLength` is not a style preference: without it a hostile 4-byte length
 * prefix asks for a 4 GiB allocation before any other check runs.
 */
export function varBytes(maxLength = 1 << 20, name = "varBytes"): Codec<Buffer> {
  return {
    name,
    fixedSize: null,
    encodeInto: (w, v) => {
      if (!Buffer.isBuffer(v)) fail(`${name}: expected a Buffer`);
      if (v.length > maxLength) fail(`${name}: ${v.length} bytes exceeds the ${maxLength} cap`);
      w.writeUint(v.length, 4);
      w.write(v);
    },
    decodeFrom: (r) => {
      const length = r.readUint(4);
      if (length > maxLength)
        fail(`${name}: declared ${length} bytes exceeds the ${maxLength} cap`);
      return r.read(length);
    },
  };
}

/**
 * Variable-length text, normalised to Unicode NFC and then encoded as
 * length-prefixed UTF-8.
 *
 * Normalisation is a canonicalisation requirement, not a nicety. "क्षेत्र" typed on
 * one keyboard and pasted from another PDF can be the same text in NFC and NFD
 * form: identical on screen, identical to a human reader, different bytes, and
 * therefore a different hash. Normalising on encode means the two hash alike.
 *
 * The cost is that `decode(encode(s))` returns the NFC form of `s` rather than
 * `s` itself. That is the intended contract — the NFC form IS the canonical
 * value — and the round-trip test asserts it explicitly.
 *
 * Lone surrogates are rejected rather than encoded. `Buffer.from(s, "utf8")`
 * replaces an unpaired surrogate with U+FFFD, which is lossy and maps many
 * distinct strings onto one encoding.
 */
export function varText(maxBytes = 1 << 16, name = "varText"): Codec<string> {
  const inner = varBytes(maxBytes, name);
  return {
    name,
    fixedSize: null,
    encodeInto: (w, v) => {
      if (typeof v !== "string") fail(`${name}: expected a string`);
      for (let i = 0; i < v.length; i += 1) {
        const code = v.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = i + 1 < v.length ? v.charCodeAt(i + 1) : 0;
          if (next < 0xdc00 || next > 0xdfff) fail(`${name}: unpaired high surrogate at ${i}`);
          i += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          fail(`${name}: unpaired low surrogate at ${i}`);
        }
      }
      inner.encodeInto(w, Buffer.from(v.normalize("NFC"), "utf8"));
    },
    decodeFrom: (r) => {
      const bytes = inner.decodeFrom(r);
      const text = bytes.toString("utf8");
      // Round-trip check: UTF-8 decoding substitutes U+FFFD for invalid
      // sequences, so without this a malformed input decodes "successfully"
      // into a value that re-encodes to different bytes.
      if (!Buffer.from(text, "utf8").equals(bytes)) fail(`${name}: invalid UTF-8`);
      if (text.normalize("NFC") !== text) fail(`${name}: text is not in NFC form`);
      return text;
    },
  };
}

/**
 * A closed set of `u16` codes, validated on both sides.
 *
 * Validation on decode is the point. Without it a record carrying code 4919
 * decodes into a value the type system swears is a member of the enum, and the
 * mistake surfaces somewhere far away. Codes are append-only, so an older
 * reader rejecting a code added after it was built is the correct outcome: it
 * cannot know what that event meant, and guessing would be worse.
 */
export function enumU16<T extends number>(name: string, allowed: readonly T[]): Codec<T> {
  const permitted = new Set<number>(allowed);
  return {
    name,
    fixedSize: 2,
    encodeInto: (w, v) => {
      if (!permitted.has(v)) fail(`${name}: ${v} is not a known code`);
      w.writeUint(v, 2);
    },
    decodeFrom: (r) => {
      const code = r.readUint(2);
      if (!permitted.has(code)) fail(`${name}: ${code} is not a known code`);
      return code as T;
    },
  };
}

/** A `u32`-counted, homogeneous sequence. */
export function array<T>(item: Codec<T>, maxCount = 1 << 20, name = `${item.name}[]`): Codec<T[]> {
  return {
    name,
    fixedSize: null,
    encodeInto: (w, v) => {
      if (!Array.isArray(v)) fail(`${name}: expected an array`);
      if (v.length > maxCount) fail(`${name}: ${v.length} items exceeds the ${maxCount} cap`);
      w.writeUint(v.length, 4);
      for (const element of v) item.encodeInto(w, element);
    },
    decodeFrom: (r) => {
      const count = r.readUint(4);
      if (count > maxCount) fail(`${name}: declared ${count} items exceeds the ${maxCount} cap`);
      const out: T[] = [];
      for (let i = 0; i < count; i += 1) out.push(item.decodeFrom(r));
      return out;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Structures                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One field of a struct: a key and the codec for its value.
 *
 * The field list is an ARRAY, and that is the point. Field order is data here,
 * written down once, reviewable in a diff — not an emergent property of how
 * some object happened to be built. This is the same reason `JSON.stringify` is
 * banned; it would be incoherent to ban it and then depend on key order myself.
 */
export type Field<T> = { [K in keyof T]-?: readonly [K, Codec<T[K]>] }[keyof T];

export function struct<T extends object>(name: string, fields: readonly Field<T>[]): Codec<T> {
  const keys = new Set<string>(fields.map(([key]) => String(key)));
  if (keys.size !== fields.length) fail(`${name}: duplicate field name`);

  let fixedSize: number | null = 0;
  for (const [, codec] of fields) {
    if (codec.fixedSize === null || fixedSize === null) fixedSize = null;
    else fixedSize += codec.fixedSize;
  }

  return {
    name,
    fixedSize,
    encodeInto: (w, value) => {
      if (value === null || typeof value !== "object") fail(`${name}: expected an object`);
      // A key on the value that the field list does not mention is an error,
      // never a silent omission. Adding a field to a record type and forgetting
      // to add it here would otherwise leave it out of the hash — the record
      // would look protected and not be.
      for (const key of Object.keys(value)) {
        if (!keys.has(key)) fail(`${name}: field "${key}" is not part of the encoding`);
      }
      for (const [key, codec] of fields) {
        const fieldValue = value[key];
        if (fieldValue === undefined) fail(`${name}: field "${String(key)}" is missing`);
        codec.encodeInto(w, fieldValue);
      }
    },
    decodeFrom: (r) => {
      // Built through a mutable record because the decoded types are usually
      // declared `readonly` — the value is frozen conceptually once returned,
      // and the fields are assigned exactly once, here, in declared order.
      const out: Record<string, unknown> = {};
      for (const [key, codec] of fields) out[String(key)] = codec.decodeFrom(r);
      return out as T;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Versioning                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A structure with a leading `version: uint8`.
 *
 * The schema WILL change, and every proof issued under the old schema has to
 * keep verifying against the old encoding for as long as anyone might rely on
 * it — which, for a legal record, is decades. So a version is never edited in
 * place: `auditEventV1` below is frozen forever, `auditEventV2` is a new
 * exported constant beside it, and a decoder dispatches on the leading byte.
 * Deleting a version invalidates every proof ever issued under it.
 *
 * The version byte is inside the hashed bytes, not beside them. A structure
 * whose version travelled separately could be reinterpreted under a different
 * schema — the same bytes meaning two things is the canonicalisation failure
 * this whole file is built to exclude.
 */
export interface VersionedCodec<T> {
  readonly name: string;
  readonly version: number;
  /** Total encoded size including the version byte, or `null` if variable. */
  readonly fixedSize: number | null;
  encode(value: T): Buffer;
  decode(bytes: Buffer): T;
}

export function versioned<T>(version: number, body: Codec<T>, name?: string): VersionedCodec<T> {
  if (!Number.isInteger(version) || version < 1 || version > 0xff) {
    fail(`bad struct version ${version}; expected 1..255`);
  }
  const label = name ?? `${body.name}.v${version}`;
  return {
    name: label,
    version,
    fixedSize: body.fixedSize === null ? null : body.fixedSize + 1,
    encode: (value) => {
      const writer = new ByteWriter();
      writer.writeUint(version, 1);
      body.encodeInto(writer, value);
      return writer.finish();
    },
    decode: (bytes) => {
      const reader = new ByteReader(bytes);
      const found = reader.readUint(1);
      if (found !== version) fail(`${label}: expected version ${version}, found ${found}`);
      const value = body.decodeFrom(reader);
      reader.finish();
      return value;
    },
  };
}

/**
 * Dispatches decoding across every version of one structure that has ever
 * existed. Callers that must handle historical records — the chain validator,
 * the public verifier — read through this; callers writing new records use the
 * current version's codec directly.
 */
export function versionRegistry<T>(
  name: string,
  codecs: readonly VersionedCodec<T>[],
): { decode(bytes: Buffer): { version: number; value: T }; peekVersion(bytes: Buffer): number } {
  const byVersion = new Map<number, VersionedCodec<T>>();
  for (const codec of codecs) {
    if (byVersion.has(codec.version)) fail(`${name}: version ${codec.version} registered twice`);
    byVersion.set(codec.version, codec);
  }
  return {
    peekVersion: (bytes) => {
      if (bytes.length < 1) fail(`${name}: empty buffer`);
      return bytes.readUInt8(0);
    },
    decode: (bytes) => {
      if (bytes.length < 1) fail(`${name}: empty buffer`);
      const version = bytes.readUInt8(0);
      const codec = byVersion.get(version);
      if (codec === undefined) fail(`${name}: unknown version ${version}`);
      return { version, value: codec.decode(bytes) };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Display boundary                                                           */
/* -------------------------------------------------------------------------- */

/** Bytes to lowercase hex. The only sanctioned exit from `Buffer`. */
export function toHex(value: Buffer): string {
  return value.toString("hex");
}

/**
 * Hex to bytes, strictly: lowercase only, no `0x` prefix, even length. Strict
 * because a verifier pasting a digest from a PDF must get a clear error rather
 * than a silently truncated buffer that fails to match for no stated reason.
 */
export function fromHex(text: string, expectedLength?: number): Buffer {
  if (!/^[0-9a-f]*$/.test(text)) fail("hex must be lowercase [0-9a-f] with no 0x prefix");
  if (text.length % 2 !== 0) fail("hex must have an even number of characters");
  const out = Buffer.from(text, "hex");
  if (expectedLength !== undefined && out.length !== expectedLength) {
    fail(`expected ${expectedLength} bytes of hex, got ${out.length}`);
  }
  return out;
}
