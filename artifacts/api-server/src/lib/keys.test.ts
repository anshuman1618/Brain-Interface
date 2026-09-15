/**
 * Tests for key derivation and custody.
 *
 * The properties asserted here are the ones that make a leaked key a bounded
 * incident rather than an estate-wide one: separation per tenant, separation
 * per purpose, and a write path that refuses to run unconfigured rather than
 * falling back to something.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KeyConfigurationError,
  keyProvider,
  legacyFileKey,
  requireKeyProvider,
  rootKey,
  rootKeyIsDedicated,
} from "./keys";

const ROOT = "a".repeat(64); // 32 bytes of hex
const LEGACY = "b".repeat(64);

/** Runs `body` with exactly the given key environment, then restores it. */
function withEnv(env: Record<string, string | undefined>, body: () => void): void {
  const keys = ["DATA_ROOT_KEY", "FILE_ENCRYPTION_KEY"];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    body();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/* -------------------------------------------------------------------------- */

describe("root key resolution", () => {
  it("prefers a dedicated DATA_ROOT_KEY", () => {
    withEnv({ DATA_ROOT_KEY: ROOT, FILE_ENCRYPTION_KEY: LEGACY }, () => {
      assert.equal(rootKeyIsDedicated(), true);
      assert.deepEqual(rootKey(), Buffer.from(ROOT, "hex"));
      assert.equal(keyProvider()?.name, "env-root");
    });
  });

  it("falls back to the legacy file key, so an existing deploy keeps booting", () => {
    withEnv({ FILE_ENCRYPTION_KEY: LEGACY }, () => {
      assert.equal(rootKeyIsDedicated(), false);
      assert.notEqual(rootKey(), null);
      assert.equal(keyProvider()?.name, "env-root(derived-from-legacy)");
    });
  });

  it("derives the fallback root rather than reusing the legacy key verbatim", () => {
    // The legacy key still decrypts v1 blobs directly. If the root were the
    // same 32 bytes, one secret would be serving two roles and a compromise of
    // either would hand over the other.
    withEnv({ FILE_ENCRYPTION_KEY: LEGACY }, () => {
      assert.notDeepEqual(rootKey(), Buffer.from(LEGACY, "hex"));
      assert.deepEqual(legacyFileKey(), Buffer.from(LEGACY, "hex"));
    });
  });

  it("is null when nothing is configured", () => {
    withEnv({}, () => {
      assert.equal(rootKey(), null);
      assert.equal(keyProvider(), null);
      assert.equal(legacyFileKey(), null);
    });
  });

  it("accepts base64 as well as hex", () => {
    const raw = Buffer.alloc(32, 0x5a);
    withEnv({ DATA_ROOT_KEY: raw.toString("base64") }, () => {
      assert.deepEqual(rootKey(), raw);
    });
  });

  it("refuses key material that is not 32 bytes, rather than truncating it", () => {
    for (const bad of ["too short", "abc", "f".repeat(62)]) {
      withEnv({ DATA_ROOT_KEY: bad }, () => {
        assert.throws(() => rootKey(), KeyConfigurationError);
      });
    }
  });
});

describe("per-tenant derivation", () => {
  it("gives each workspace a different key", () => {
    // The point of the whole change: a key recovered from a log opens one
    // chamber's files, not every chamber's.
    withEnv({ DATA_ROOT_KEY: ROOT }, () => {
      const provider = requireKeyProvider();
      const a = provider.tenantKey(1, "file");
      const b = provider.tenantKey(2, "file");
      assert.equal(a.length, 32);
      assert.notDeepEqual(a, b);
    });
  });

  it("gives each purpose a different key", () => {
    // Without domain separation, a MAC produced for the audit chain would
    // verify as a file key and vice versa.
    withEnv({ DATA_ROOT_KEY: ROOT }, () => {
      const provider = requireKeyProvider();
      assert.notDeepEqual(provider.tenantKey(1, "file"), provider.tenantKey(1, "audit-ref"));
    });
  });

  it("is deterministic, or nothing written yesterday opens today", () => {
    withEnv({ DATA_ROOT_KEY: ROOT }, () => {
      assert.deepEqual(
        requireKeyProvider().tenantKey(3, "file"),
        keyProvider()?.tenantKey(3, "file"),
      );
    });
  });

  it("never reveals the root", () => {
    withEnv({ DATA_ROOT_KEY: ROOT }, () => {
      const derived = requireKeyProvider().tenantKey(1, "file");
      assert.notDeepEqual(derived, Buffer.from(ROOT, "hex"));
    });
  });

  it("refuses a workspace id that is not a workspace", () => {
    // A zero or NaN id would derive one key shared by every caller whose
    // scoping went wrong — the failure this separation exists to prevent,
    // arriving as a bug rather than an attack.
    withEnv({ DATA_ROOT_KEY: ROOT }, () => {
      const provider = requireKeyProvider();
      for (const id of [0, -1, 1.5, Number.NaN]) {
        assert.throws(() => provider.tenantKey(id, "file"), KeyConfigurationError);
      }
    });
  });

  it("derives different keys under a different root", () => {
    let underA: Buffer | undefined;
    withEnv({ DATA_ROOT_KEY: ROOT }, () => {
      underA = requireKeyProvider().tenantKey(1, "file");
    });
    withEnv({ DATA_ROOT_KEY: "c".repeat(64) }, () => {
      assert.notDeepEqual(requireKeyProvider().tenantKey(1, "file"), underA);
    });
  });
});

describe("fail closed", () => {
  it("requireKeyProvider throws, naming what to set", () => {
    withEnv({}, () => {
      assert.throws(() => requireKeyProvider(), KeyConfigurationError);
      assert.throws(() => requireKeyProvider(), /DATA_ROOT_KEY/);
    });
  });

  it("reads the environment on every call, so a guard can be tested at all", () => {
    withEnv({}, () => assert.equal(keyProvider(), null));
    withEnv({ DATA_ROOT_KEY: ROOT }, () => assert.notEqual(keyProvider(), null));
  });
});
