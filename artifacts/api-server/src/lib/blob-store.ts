import { createHash, randomUUID } from "node:crypto";
import {
  BlobFormatError,
  KeyScheme,
  decryptV1,
  decryptV2,
  encryptV1,
  encryptV2,
  inspect,
} from "./blob-crypto";
import { blobBackend, storageRoot } from "./blob-backends";
import { KeyConfigurationError, keyProvider, legacyFileKey, requireKeyProvider } from "./keys";

export { storageRoot };

/**
 * Where uploaded case files actually live.
 *
 * Two stores, one code path. `blob-backends.ts` decides between the local
 * filesystem and Cloudflare R2 from the environment; routes never see a path
 * or a bucket, and everything that makes a file SAFE lives here, above that
 * choice, so a backend cannot weaken it.
 *
 * R2 exists because a container filesystem is not storage. On a host with no
 * mounted volume — Render's free plan cannot have one — every uploaded case
 * file is destroyed by the next deploy or restart, and nothing says so until a
 * chamber opens a filing weeks later and it is gone.
 *
 * The key rules, in order of how badly they go wrong if broken:
 *
 *  1. The client never supplies the storage key. It is a generated UUID under a
 *     date-sharded prefix, so a name like "../../etc/passwd" is inert — it is
 *     kept as a display label in the database and never touches the filesystem.
 *  2. On the filesystem backend every resolved path is re-checked to be inside
 *     the storage root before any read or write. Belt and braces with (1),
 *     because path handling is where this class of bug always hides.
 *  3. Size is capped while streaming, not after. A cap enforced after the bytes
 *     are already on disk is not a cap.
 *  4. Bytes are encrypted before they leave this process. These are privileged
 *     client files; a stray backup, a snapshotted volume, a host operator — or
 *     Cloudflare — should read ciphertext and nothing else. It is why object
 *     storage is acceptable for them at all: FILE_ENCRYPTION_KEY never leaves
 *     the server, so R2 holds blobs it cannot open.
 */

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/* ── Encryption at rest ──────────────────────────────────────────
 *
 * AES-256-GCM. The format, the identity binding and the reasoning live in
 * `blob-crypto.ts`, which has no filesystem and no environment so that the
 * rules can be tested directly. This file supplies the two things that module
 * deliberately does not know: which key to use, and what to do about a blob
 * that is not encrypted at all.
 *
 * Files are capped at 25 MB, so encrypting and decrypting in memory is simpler
 * than a stream pipeline and cannot get the tag-verification order wrong — GCM
 * only knows the plaintext was authentic once the whole thing has been read,
 * and a streaming decrypt happily pipes unverified bytes to the client until
 * that moment.
 */

/**
 * Whether a blob with no recognised magic prefix may be served as plaintext.
 *
 * **Defaults to refusing, and that is the security property.** Without it,
 * anyone who can write to the blob store can strip encryption from a document
 * one file at a time: replace the ciphertext with plaintext and the read path
 * hands it straight back. An at-rest control an attacker can switch off per
 * file is not a control.
 *
 * The escape hatch exists because a deployment that still holds blobs written
 * before encryption existed would otherwise lose access to them at the moment
 * this ships, and a security change that takes documents offline is a security
 * change that gets reverted. The sequence is: set `ALLOW_PLAINTEXT_BLOBS=on`,
 * run `pnpm --filter @workspace/api-server run encrypt-existing`, unset it.
 * `preflight.ts` says so loudly at every boot while it is on.
 */
function plaintextBlobsAllowed(): boolean {
  return process.env["ALLOW_PLAINTEXT_BLOBS"]?.trim().toLowerCase() === "on";
}

/**
 * Fail fast rather than quietly writing plaintext.
 *
 * Called at startup. Outside production an unset key is allowed so preview mode
 * still runs with no configuration at all, but it is a warning, not silence —
 * the whole failure mode this guards against is nobody noticing.
 */
export function assertEncryptionConfigured(log: (msg: string) => void): void {
  if (keyProvider()) {
    if (plaintextBlobsAllowed()) {
      log(
        "ALLOW_PLAINTEXT_BLOBS=on — an unencrypted blob will be served rather than " +
          "refused. This is the migration setting; unset it once `encrypt-existing` " +
          "has run.",
      );
    }
    return;
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "No key material is configured: uploaded case files are privileged and must " +
        "not be written in the clear. Set DATA_ROOT_KEY (32 bytes). Generate one " +
        "with `openssl rand -hex 32` and set it before starting. See DEPLOYMENT.md §4a.",
    );
  }
  log(
    "DATA_ROOT_KEY and FILE_ENCRYPTION_KEY are both unset — uploaded files are being " +
      "written UNENCRYPTED. This is refused in production.",
  );
}

/**
 * Whether at-rest encryption is configured, for `/health` and `preflight`.
 *
 * A boolean rather than the key: nothing outside `keys.ts` has a reason to hold
 * key material, and a reporting path is the last place that should be able to.
 * Throws on malformed key material rather than returning false, so a bad value
 * is reported as its own distinct problem instead of looking like an unset one.
 */
export function encryptionConfigured(): boolean {
  return keyProvider() !== null;
}

export function maxUploadBytes(): number {
  const raw = Number(process.env["MAX_UPLOAD_BYTES"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

/**
 * What a chamber actually exchanges. An allowlist rather than a blocklist:
 * a blocklist is a list of the attacks somebody already thought of.
 */
export const ALLOWED_MIME = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/tiff", "tiff"],
  ["image/webp", "webp"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime.split(";")[0]!.trim().toLowerCase());
}

/**
 * Does the file actually look like what the caller said it is?
 *
 * The allowlist above checks a Content-Type header, which the client writes.
 * On its own that is a declaration, not a fact: a shell script uploaded as
 * "application/pdf" passes it. Nothing here executes an upload, downloads are
 * forced to `attachment` with `nosniff`, and files are stored encrypted outside
 * any served directory — so the declared type being a lie is not currently
 * exploitable. It is still the one property in this path that was taken on
 * trust, and the cost of checking it is reading sixteen bytes.
 *
 * Signatures only, deliberately. Parsing the container to prove a PDF is a
 * well-formed PDF means running a parser over hostile input, which adds more
 * attack surface than it removes.
 */
type Signature = { offset: number; bytes: number[] };

const SIGNATURES = new Map<string, Signature[]>([
  ["application/pdf", [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }]], // %PDF-
  ["image/jpeg", [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
  ["image/png", [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }]],
  [
    "image/tiff",
    [
      { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }, // little-endian
      { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // big-endian
    ],
  ],
  [
    "image/webp",
    [
      // RIFF....WEBP — the four size bytes in between are not fixed.
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  ],
  // .doc and .xls are OLE compound documents; .docx and .xlsx are ZIP archives.
  ["application/msword", [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }]],
  [
    "application/vnd.ms-excel",
    [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  ],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  ],
]);

/** webp needs BOTH of its parts; every other format needs any ONE alternative. */
const ALL_PARTS_REQUIRED = new Set(["image/webp"]);

function matches(buf: Buffer, sig: Signature): boolean {
  if (buf.length < sig.offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => buf[sig.offset + i] === b);
}

/**
 * Text has no signature, so the test is inverted: reject what text cannot be.
 *
 * A NUL byte in the first block is the giveaway for an executable or an office
 * document renamed to .txt. A shell script is genuinely valid text and is
 * accepted — correctly, since nothing here will ever run it, and refusing it
 * would break a chamber attaching a legitimate plain-text exhibit.
 */
function looksLikeText(buf: Buffer): boolean {
  return !buf.subarray(0, 8192).includes(0x00);
}

export function contentMatchesMime(buf: Buffer, mime: string): boolean {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  if (m === "text/plain" || m === "text/csv") return looksLikeText(buf);

  const sigs = SIGNATURES.get(m);
  // An allowed type with no signature defined would fail open; there are none
  // today, and this keeps it that way if the allowlist grows.
  if (!sigs) return false;

  return ALL_PARTS_REQUIRED.has(m)
    ? sigs.every((s) => matches(buf, s))
    : sigs.some((s) => matches(buf, s));
}

/** Never rendered as HTML by us, and never handed back with a type that would be. */
export function safeContentType(mime: string | null | undefined): string {
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  return isAllowedMime(m) ? m : "application/octet-stream";
}

/** Strip anything that could be read as a path or a control character. */
export function sanitiseFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[ -]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "file").slice(0, 180);
}

export type StoredBlob = { key: string; bytes: number; checksum: string };

/**
 * Write a buffer to the store under a freshly generated key.
 *
 * Callers pass bytes they have already length-checked; `put` re-checks anyway
 * so no future caller can forget to.
 */
export async function put(buf: Buffer, workspaceId: number): Promise<StoredBlob> {
  if (buf.length === 0) throw new Error("empty upload");
  if (buf.length > maxUploadBytes()) throw new Error("upload too large");

  const now = new Date();
  const shard = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const key = `${shard}/${randomUUID()}`;

  // The workspace is now part of what gets written, not just part of the row
  // that points at it: it selects the content key AND is authenticated into the
  // ciphertext, so a blob cannot later be read as another chamber's file.
  const provider = keyProvider();
  let stored: Buffer;
  if (provider) {
    const contentKey = provider.tenantKey(workspaceId, "file");
    stored = encryptV2({
      plain: buf,
      key: contentKey,
      keyScheme: KeyScheme.ENV_ROOT_HKDF,
      workspaceId,
      storageKey: key,
    });
    contentKey.fill(0);
  } else {
    // Only reachable outside production; `assertEncryptionConfigured` aborts
    // the boot otherwise.
    stored = buf;
  }

  await blobBackend().put(key, stored);

  return {
    key,
    // Both describe the PLAINTEXT. The checksum is what the chamber uploaded
    // and what it will download; the ciphertext is longer by the header and is
    // an implementation detail nobody outside this file should see.
    bytes: buf.length,
    checksum: createHash("sha256").update(buf).digest("hex"),
  };
}

/**
 * Read a blob back as plaintext.
 *
 * Returns a Buffer rather than a stream on purpose — see the note on the file
 * format above. A tampered or truncated file throws here instead of streaming
 * unverified bytes to the caller.
 */
export async function read(key: string, workspaceId: number): Promise<Buffer> {
  const stored = await blobBackend().get(key);
  const format = inspect(stored);

  if (format.version === 2) {
    const provider = requireKeyProvider();
    const contentKey = provider.tenantKey(workspaceId, "file");
    try {
      // Note what is passed: the workspace the CALLER believes owns this file,
      // and the key it was fetched under. Both are authenticated into the
      // ciphertext, so a blob moved between storage keys or re-pointed at
      // another chamber fails the tag rather than decrypting into the wrong
      // hands.
      return decryptV2({
        stored,
        key: contentKey,
        expectedWorkspaceId: workspaceId,
        storageKey: key,
      });
    } finally {
      contentKey.fill(0);
    }
  }

  if (format.version === 1) {
    // Legacy: one global key, and no identity binding — the tag over these
    // bytes was computed without AAD and cannot gain one retroactively. Still
    // readable, deliberately, because refusing would destroy documents.
    const legacy = legacyFileKey();
    if (!legacy) {
      throw new KeyConfigurationError(
        "This file was encrypted with FILE_ENCRYPTION_KEY, which is not set. That " +
          "key is the only thing that can read it back — do not rotate it away " +
          "until every blob has been rewritten in the current format.",
      );
    }
    try {
      return decryptV1(stored, legacy);
    } finally {
      legacy.fill(0);
    }
  }

  // No recognised prefix. Either a blob written before encryption existed, or
  // plaintext somebody substituted for ciphertext, and nothing here can tell
  // the two apart. Refusing is the only safe default; see
  // `plaintextBlobsAllowed`.
  //
  // Not configured at all means preview or local development, where `put`
  // wrote this plaintext itself and refusing it would be refusing our own
  // output. Unreachable in production: the boot guard aborts before a request
  // is served without key material.
  if (plaintextBlobsAllowed() || !encryptionConfigured()) return stored;
  throw new BlobFormatError(
    "Refusing to serve an unencrypted blob. If this deployment still holds files " +
      "written before encryption, set ALLOW_PLAINTEXT_BLOBS=on, run " +
      "`pnpm --filter @workspace/api-server run encrypt-existing`, then unset it.",
  );
}

/** Whether a stored blob is still plaintext — used by the migration script. */
export async function isPlaintextOnDisk(key: string): Promise<boolean> {
  return inspect(await blobBackend().get(key)).version === 0;
}

/**
 * Rewrite a plaintext blob in place as ciphertext. No-op if already encrypted.
 *
 * Writes the LEGACY v1 format on purpose. This is the migration path for blobs
 * that predate encryption, it runs from a script with no request context and so
 * no workspace, and v1 is readable forever. Rewriting the estate into v2 — which
 * is what actually closes the swap gap for these files — is a separate task that
 * needs the document rows to learn each blob's owner.
 */
export async function encryptInPlace(key: string): Promise<boolean> {
  const legacy = legacyFileKey();
  if (!legacy) throw new KeyConfigurationError("FILE_ENCRYPTION_KEY is not set");
  const backend = blobBackend();
  const stored = await backend.get(key);
  if (inspect(stored).version !== 0) return false;
  try {
    await backend.put(key, encryptV1(stored, legacy));
  } finally {
    legacy.fill(0);
  }
  return true;
}

export async function exists(key: string): Promise<boolean> {
  return blobBackend().exists(key);
}

export async function remove(key: string): Promise<void> {
  await blobBackend().remove(key);
}
