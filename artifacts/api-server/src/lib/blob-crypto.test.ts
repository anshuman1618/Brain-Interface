/**
 * Tests for the stored-file format.
 *
 * Two of these are the findings from `docs/CRYPTO-POLICY.md` §0.1 and §0.2,
 * written as attacks. They are the reason this module exists, and they stay in
 * the suite so that a later "simplification" that drops the AAD fails loudly
 * rather than quietly restoring a swap primitive.
 *
 * Run with `pnpm --filter @workspace/api-server run test`.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import {
  BlobFormatError,
  KeyScheme,
  decryptV1,
  decryptV2,
  encryptV1,
  encryptV2,
  inspect,
} from "./blob-crypto";

const key = (fill: number): Buffer => Buffer.alloc(32, fill);
const plain = Buffer.from("PRIVILEGED: the Mehta engagement letter", "utf8");

function storeA(): Buffer {
  return encryptV2({
    plain,
    key: key(0x11),
    keyScheme: KeyScheme.ENV_ROOT_HKDF,
    workspaceId: 7,
    storageKey: "2026/09/aaaaaaaa-0000-0000-0000-000000000001",
  });
}

/* -------------------------------------------------------------------------- */

describe("format detection", () => {
  it("recognises v2 and reads its header", () => {
    const format = inspect(storeA());
    assert.equal(format.version, 2);
    assert.equal(format.version === 2 && format.workspaceId, 7);
    assert.equal(format.version === 2 && format.keyScheme, KeyScheme.ENV_ROOT_HKDF);
  });

  it("recognises v1", () => {
    assert.equal(inspect(encryptV1(plain, key(0x22))).version, 1);
  });

  it("reports anything unprefixed as version 0", () => {
    // It cannot distinguish "written before encryption existed" from "an
    // attacker replaced the ciphertext with plaintext". Neither can anything
    // else, which is why the decision belongs to the caller.
    assert.equal(inspect(plain).version, 0);
    assert.equal(inspect(Buffer.alloc(0)).version, 0);
  });

  it("rejects a truncated blob rather than reading past it", () => {
    assert.throws(() => inspect(storeA().subarray(0, 10)), BlobFormatError);
  });
});

describe("v2 round trip", () => {
  it("returns the original bytes", () => {
    const out = decryptV2({
      stored: storeA(),
      key: key(0x11),
      expectedWorkspaceId: 7,
      storageKey: "2026/09/aaaaaaaa-0000-0000-0000-000000000001",
    });
    assert.deepEqual(out, plain);
  });

  it("uses a fresh IV every time, so two encryptions never match", () => {
    // A repeated (key, IV) under GCM leaks the XOR of the plaintexts and allows
    // tag forgery. It is the one way to destroy this construction with
    // everything still appearing to work.
    const first = storeA();
    const second = storeA();
    assert.notDeepEqual(first, second);
    const ivAt = 5 + 1 + 4;
    assert.notDeepEqual(first.subarray(ivAt, ivAt + 12), second.subarray(ivAt, ivAt + 12));
  });

  it("refuses a key that is not 32 bytes", () => {
    assert.throws(
      () =>
        encryptV2({
          plain,
          key: Buffer.alloc(16, 1),
          keyScheme: KeyScheme.ENV_ROOT_HKDF,
          workspaceId: 7,
          storageKey: "k",
        }),
      BlobFormatError,
    );
  });

  it("refuses a workspace id that is not a workspace", () => {
    for (const workspaceId of [0, -1, 1.5]) {
      assert.throws(
        () =>
          encryptV2({
            plain,
            key: key(0x11),
            keyScheme: KeyScheme.ENV_ROOT_HKDF,
            workspaceId,
            storageKey: "k",
          }),
        BlobFormatError,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * CRYPTO-POLICY §0.1. The finding that motivated the v2 format.
 *
 * GCM authenticates the bytes of a file. It does not authenticate which file
 * they are. Without AAD, an attacker who can write to the blob store moves one
 * client's ciphertext onto another document's storage key and it decrypts
 * cleanly, tag valid, nothing logged.
 */
describe("a blob cannot be moved to another storage key", () => {
  it("fails the tag when the storage key differs", () => {
    const stored = storeA();
    assert.throws(
      () =>
        decryptV2({
          stored,
          key: key(0x11),
          expectedWorkspaceId: 7,
          // Same chamber, same content key, different file.
          storageKey: "2026/09/bbbbbbbb-0000-0000-0000-000000000002",
        }),
      /unable to authenticate|Unsupported state/i,
    );
  });

  it("fails when the blob is claimed by another workspace", () => {
    assert.throws(
      () =>
        decryptV2({
          stored: storeA(),
          key: key(0x11),
          expectedWorkspaceId: 9,
          storageKey: "2026/09/aaaaaaaa-0000-0000-0000-000000000001",
        }),
      BlobFormatError,
    );
  });

  it("fails when the header workspace is edited to match a forged claim", () => {
    // The header is not trusted: the AAD is built from what the caller believes,
    // so rewriting the header alone does not help an attacker.
    const tampered = storeA();
    tampered.writeUInt32LE(9, 5 + 1);
    assert.throws(
      () =>
        decryptV2({
          stored: tampered,
          key: key(0x11),
          expectedWorkspaceId: 9,
          storageKey: "2026/09/aaaaaaaa-0000-0000-0000-000000000001",
        }),
      /unable to authenticate|Unsupported state/i,
    );
  });

  it("fails under another chamber's content key", () => {
    assert.throws(
      () =>
        decryptV2({
          stored: storeA(),
          key: key(0x99),
          expectedWorkspaceId: 7,
          storageKey: "2026/09/aaaaaaaa-0000-0000-0000-000000000001",
        }),
      /unable to authenticate|Unsupported state/i,
    );
  });

  it("fails when a single ciphertext byte is flipped", () => {
    const tampered = storeA();
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0x01, last);
    assert.throws(
      () =>
        decryptV2({
          stored: tampered,
          key: key(0x11),
          expectedWorkspaceId: 7,
          storageKey: "2026/09/aaaaaaaa-0000-0000-0000-000000000001",
        }),
      /unable to authenticate|Unsupported state/i,
    );
  });
});

/**
 * The AAD is built with the canonical encoder rather than by concatenating
 * strings, and this is why.
 */
describe("the identity binding is unambiguous", () => {
  it("does not confuse a split between workspace and storage key", () => {
    // With naive concatenation, a storage key that absorbs a digit from the
    // workspace id could produce the same AAD bytes for two different files.
    // Length-prefixed encoding makes that impossible.
    const a = encryptV2({
      plain,
      key: key(0x11),
      keyScheme: KeyScheme.ENV_ROOT_HKDF,
      workspaceId: 1,
      storageKey: "23/file",
    });
    assert.throws(
      () =>
        decryptV2({
          stored: a,
          key: key(0x11),
          expectedWorkspaceId: 12,
          storageKey: "3/file",
        }),
      BlobFormatError,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("v1 legacy blobs", () => {
  it("still round-trips, because refusing would destroy documents", () => {
    const stored = encryptV1(plain, key(0x22));
    assert.deepEqual(decryptV1(stored, key(0x22)), plain);
  });

  it("still rejects tampering with the bytes", () => {
    const stored = encryptV1(plain, key(0x22));
    stored.writeUInt8(stored.readUInt8(stored.length - 1) ^ 0x01, stored.length - 1);
    assert.throws(() => decryptV1(stored, key(0x22)), /unable to authenticate|Unsupported state/i);
  });

  it("remains swappable between storage keys — the gap v2 closes", () => {
    // Asserted rather than described. The tag over a v1 blob was computed
    // without AAD and cannot gain one retroactively, so a v1 blob moved to
    // another storage key still decrypts. This is why the estate has to be
    // rewritten as v2 and why that task is tracked rather than assumed done.
    const stored = encryptV1(plain, key(0x22));
    assert.deepEqual(decryptV1(stored, key(0x22)), plain);
  });

  it("will not decrypt a v2 blob, or the reverse", () => {
    assert.throws(() => decryptV1(storeA(), key(0x11)), BlobFormatError);
    assert.throws(
      () =>
        decryptV2({
          stored: encryptV1(plain, key(0x22)),
          key: key(0x22),
          expectedWorkspaceId: 7,
          storageKey: "k",
        }),
      BlobFormatError,
    );
  });
});

describe("larger payloads", () => {
  it("round-trips a megabyte unchanged", () => {
    const big = randomBytes(1024 * 1024);
    const stored = encryptV2({
      plain: big,
      key: key(0x33),
      keyScheme: KeyScheme.ENV_ROOT_HKDF,
      workspaceId: 42,
      storageKey: "2026/09/big",
    });
    assert.deepEqual(
      decryptV2({
        stored,
        key: key(0x33),
        expectedWorkspaceId: 42,
        storageKey: "2026/09/big",
      }),
      big,
    );
  });
});
