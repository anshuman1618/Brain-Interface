import { hkdf256, SECRET_KEY_BYTES } from "@workspace/crypto-core";

/**
 * Where key material comes from.
 *
 * Every symmetric key this server uses is derived here, per tenant, from one
 * root secret. Nothing else in the codebase may read a key out of the
 * environment or hold a long-lived one — the point of routing it through a
 * single seam is that swapping the root for a KMS later touches this file and
 * nothing else.
 *
 * ## The custody position today, stated plainly
 *
 * The root is an environment variable. `docs/CRYPTO-POLICY.md` §0.3 records
 * that as a HIGH finding and it remains open: an environment variable is
 * readable by anything that can read `/proc/self/environ`, lands in a crash
 * dump, and is printed by one careless `console.log(process.env)`. Cloud KMS is
 * the intended destination and `KeyProvider` is the shape it will arrive in.
 *
 * What this file does fix is the part that does not need a KMS: one global key
 * for every chamber becomes one key per chamber per purpose. A key recovered
 * from a log now opens one firm's files, not the whole estate, and destroying a
 * tenant's key material is a meaningful act.
 *
 * ## Derivation
 *
 *     tenantKey(ws, purpose) = HKDF-SHA256(root, salt="", info="lex:v1:<purpose>:ws:<ws>", 32)
 *
 * No salt, because the root is 32 bytes from a CSPRNG and HKDF's salt exists to
 * handle input keying material that is not already uniform. The `info` string
 * carries the whole of the domain separation, so two purposes never share a
 * key and one tenant's key says nothing about another's.
 *
 * Derivation is two HMACs. It is not cached: the cost is negligible next to the
 * disk or network read it accompanies, and not caching means key material is
 * resident for the length of one operation rather than the life of the process.
 */

/**
 * What a derived key is for. Part of the derivation input, so adding a purpose
 * here is adding a new, independent key — never a reuse of an existing one.
 */
export type KeyPurpose =
  /** AES-256-GCM content key for uploaded case files. */
  | "file"
  /** HMAC key for identifier references in the audit chain (Phase 3). */
  | "audit-ref";

export interface KeyProvider {
  /** Names the custody arrangement. Reported by `/health` so it is auditable. */
  readonly name: string;
  /** The key for one tenant and one purpose. Callers must not retain it. */
  tenantKey(workspaceId: number, purpose: KeyPurpose): Buffer;
}

export class KeyConfigurationError extends Error {
  public override readonly name = "KeyConfigurationError";
}

/** Parses 32 bytes from hex or base64, or explains precisely what was wrong. */
function parseKeyMaterial(raw: string, envName: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== SECRET_KEY_BYTES) {
    throw new KeyConfigurationError(
      `${envName} must be ${SECRET_KEY_BYTES} bytes — 64 hex characters, or base64. ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }
  return key;
}

/**
 * The legacy single file key.
 *
 * Still required, and required indefinitely: every blob written before this
 * change is AES-GCM ciphertext under this exact key and there is no other way
 * to read it back. It is no longer used to write anything.
 */
export function legacyFileKey(): Buffer | null {
  const raw = process.env["FILE_ENCRYPTION_KEY"]?.trim();
  if (!raw) return null;
  return parseKeyMaterial(raw, "FILE_ENCRYPTION_KEY");
}

/**
 * The root every per-tenant key is derived from.
 *
 * `DATA_ROOT_KEY` when set. Otherwise derived from `FILE_ENCRYPTION_KEY`, so an
 * existing deployment gains per-tenant keys without an operator having to set a
 * new variable before the next restart — a security change that takes the
 * service down on deploy is a security change that gets rolled back.
 *
 * The fallback derives rather than reusing: the root and the legacy AES key must
 * not be the same 32 bytes serving two roles. HKDF's extract step makes the
 * derived root computationally independent of the legacy key, so a compromise of
 * one does not hand over the other for free.
 */
export function rootKey(): Buffer | null {
  const explicit = process.env["DATA_ROOT_KEY"]?.trim();
  if (explicit) return parseKeyMaterial(explicit, "DATA_ROOT_KEY");

  const legacy = legacyFileKey();
  if (!legacy) return null;
  return hkdf256(
    legacy,
    Buffer.alloc(0),
    Buffer.from("lex:v1:root-from-legacy-file-key", "utf8"),
    SECRET_KEY_BYTES,
  );
}

/** True when the root is a dedicated variable rather than the legacy fallback. */
export function rootKeyIsDedicated(): boolean {
  return Boolean(process.env["DATA_ROOT_KEY"]?.trim());
}

class EnvRootKeyProvider implements KeyProvider {
  public readonly name: string;

  public constructor(
    private readonly root: Buffer,
    dedicated: boolean,
  ) {
    this.name = dedicated ? "env-root" : "env-root(derived-from-legacy)";
  }

  public tenantKey(workspaceId: number, purpose: KeyPurpose): Buffer {
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      // A zero or NaN workspace id would silently derive one shared key for
      // every caller that got its scoping wrong — the exact failure this
      // separation exists to prevent, arriving as a bug rather than an attack.
      throw new KeyConfigurationError(`tenantKey: workspaceId ${workspaceId} is not a workspace`);
    }
    return hkdf256(
      this.root,
      Buffer.alloc(0),
      Buffer.from(`lex:v1:${purpose}:ws:${workspaceId}`, "utf8"),
      SECRET_KEY_BYTES,
    );
  }
}

/**
 * The provider, or null when no key material is configured.
 *
 * Read from the environment on every call rather than captured at import. A
 * module-level constant freezes whatever the environment looked like when the
 * file was first required, which makes the production guard untestable — and an
 * untested fail-closed guard is a guard that has never been shown to close.
 */
export function keyProvider(): KeyProvider | null {
  const root = rootKey();
  if (!root) return null;
  return new EnvRootKeyProvider(root, rootKeyIsDedicated());
}

/** The provider, or a thrown error naming what to set. For write paths. */
export function requireKeyProvider(): KeyProvider {
  const provider = keyProvider();
  if (provider) return provider;
  throw new KeyConfigurationError(
    "No key material is configured. Set DATA_ROOT_KEY (32 bytes) before storing " +
      "privileged files. Generate one with: openssl rand -hex 32",
  );
}
