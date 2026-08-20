import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { blobBackend, storageRoot } from "./blob-backends";

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

/* ── Encryption at rest ───────────────────────────────────────────────────
 *
 * AES-256-GCM, one random IV per file, authenticated so a modified file fails
 * to decrypt rather than returning corrupted bytes to a court filing.
 *
 * Stored layout, identical on both backends:
 *
 *   magic "LEXP1"  5 bytes   identifies an encrypted blob
 *   iv            12 bytes   random per file
 *   authTag       16 bytes   GCM tag over the ciphertext
 *   ciphertext    n bytes
 *
 * Files are capped at 25 MB, so encrypting and decrypting in memory is simpler
 * than a stream pipeline and cannot get the tag-verification order wrong — GCM
 * only knows the plaintext was authentic once the whole thing has been read,
 * and a streaming decrypt happily pipes unverified bytes to the client until
 * that moment.
 *
 * A blob written before this existed has no magic prefix and is returned as-is.
 * That is deliberate: an upgrade must not make existing documents unreadable.
 * `pnpm --filter @workspace/api-server run encrypt-existing` rewrites them.
 */

const MAGIC = Buffer.from("LEXP1", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;

/**
 * The key, or null when none is configured.
 *
 * Read on every call rather than cached at import: a module-level constant
 * would freeze whatever the environment looked like when the file was first
 * required, which makes the production guard below untestable.
 */
export function encryptionKey(): Buffer | null {
  const raw = process.env["FILE_ENCRYPTION_KEY"]?.trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "FILE_ENCRYPTION_KEY must be 32 bytes — 64 hex characters, or base64. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return key;
}

/**
 * Fail fast rather than quietly writing plaintext.
 *
 * Called at startup. Outside production an unset key is allowed so the preview
 * mode still runs with no configuration at all, but it is a warning, not
 * silence — the whole failure mode this guards against is nobody noticing.
 */
export function assertEncryptionConfigured(log: (msg: string) => void): void {
  const key = encryptionKey();
  if (key) return;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "FILE_ENCRYPTION_KEY is required in production: uploaded case files are " +
        "privileged and must not be written in the clear. Generate one with " +
        "`openssl rand -hex 32` and set it before starting. See DEPLOYMENT.md §4a.",
    );
  }
  log(
    "FILE_ENCRYPTION_KEY is unset — uploaded files are being written UNENCRYPTED. " +
      "This is refused in production.",
  );
}

function isEncrypted(buf: Buffer): boolean {
  return buf.length >= HEADER_BYTES && timingSafeEqual(buf.subarray(0, MAGIC.length), MAGIC);
}

function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(stored: Buffer, key: Buffer): Buffer {
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = stored.subarray(MAGIC.length + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // final() throws if the tag does not verify, which is the point.
  return Buffer.concat([decipher.update(stored.subarray(HEADER_BYTES)), decipher.final()]);
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
export async function put(buf: Buffer): Promise<StoredBlob> {
  if (buf.length === 0) throw new Error("empty upload");
  if (buf.length > maxUploadBytes()) throw new Error("upload too large");

  const now = new Date();
  const shard = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const key = `${shard}/${randomUUID()}`;

  const key32 = encryptionKey();
  const stored = key32 ? encrypt(buf, key32) : buf;

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
export async function read(key: string): Promise<Buffer> {
  const stored = await blobBackend().get(key);
  if (!isEncrypted(stored)) return stored; // written before encryption existed
  const key32 = encryptionKey();
  if (!key32) {
    throw new Error(
      "This file is encrypted but FILE_ENCRYPTION_KEY is not set. The key that " +
        "wrote it is the only thing that can read it back.",
    );
  }
  return decrypt(stored, key32);
}

/** Whether a stored blob is still plaintext — used by the migration script. */
export async function isPlaintextOnDisk(key: string): Promise<boolean> {
  return !isEncrypted(await blobBackend().get(key));
}

/** Rewrite a plaintext blob in place as ciphertext. No-op if already encrypted. */
export async function encryptInPlace(key: string): Promise<boolean> {
  const key32 = encryptionKey();
  if (!key32) throw new Error("FILE_ENCRYPTION_KEY is not set");
  const backend = blobBackend();
  const stored = await backend.get(key);
  if (isEncrypted(stored)) return false;
  await backend.put(key, encrypt(stored, key32));
  return true;
}

export async function exists(key: string): Promise<boolean> {
  return blobBackend().exists(key);
}

export async function remove(key: string): Promise<void> {
  await blobBackend().remove(key);
}
