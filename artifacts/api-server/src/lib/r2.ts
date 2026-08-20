import { createHash, createHmac } from "node:crypto";

/**
 * Cloudflare R2, spoken directly over its S3-compatible API.
 *
 * **No SDK.** `@aws-sdk/client-s3` is tens of megabytes of dependency, pulled
 * into a process that holds decryption keys and every chamber's privileged
 * files, to do four HTTP requests. The signing algorithm below is a hundred
 * lines and this server already hand-verifies HMAC signatures for the Razorpay
 * webhook, so it is not a new kind of code to own. The trade is deliberate:
 * fewer moving parts next to the sensitive data, at the cost of writing SigV4
 * once and testing it against published vectors.
 *
 * What reaches Cloudflare is **ciphertext**. Encryption happens in
 * `blob-store.ts`, above this layer, so R2 holds AES-256-GCM blobs it cannot
 * read and `FILE_ENCRYPTION_KEY` never leaves the server. That is the whole
 * reason object storage is acceptable for privileged client files at all.
 */

export type R2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Overridable for tests and for S3-compatible stores that are not R2. */
  endpoint: string;
};

const REGION = "auto"; // R2 has one; the signature still needs the field.
const SERVICE = "s3";

/**
 * The configuration, or null when the filesystem backend should be used.
 *
 * Throws on a *partial* configuration rather than falling back. Silently
 * writing to a local disk because one of four variables was mistyped is the
 * failure this whole change exists to remove — the operator would see uploads
 * succeed and lose them on the next deploy, exactly as before.
 */
export function r2Config(): R2Config | null {
  const accountId = process.env["R2_ACCOUNT_ID"]?.trim();
  const bucket = process.env["R2_BUCKET"]?.trim();
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"]?.trim();
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"]?.trim();

  const given = [accountId, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (given === 0) return null;
  if (given < 4) {
    throw new Error(
      "R2 is partly configured. R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and " +
        "R2_SECRET_ACCESS_KEY are all required together — refusing to fall back to " +
        "local disk, because uploads would appear to succeed and then be lost on " +
        "the next deploy. See DEPLOYMENT.md §4a.",
    );
  }

  return {
    accountId: accountId!,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    endpoint: process.env["R2_ENDPOINT"]?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/**
 * Percent-encode one path segment the way SigV4 requires.
 *
 * `encodeURIComponent` leaves `!'()*` alone and AWS does not, so a key
 * containing one would sign differently from how it is sent and every request
 * would fail with a signature mismatch. Our keys are `YYYY/MM/<uuid>` and
 * contain none of them, but a signer that is only correct for the keys we
 * happen to generate today is a trap for whoever changes the key format.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, key: string): string {
  const segments = key.split("/").map(encodeSegment);
  return `/${encodeSegment(bucket)}/${segments.join("/")}`;
}

/**
 * Sign a request the S3 way: AWS Signature Version 4.
 *
 * Exported so it can be checked against published test vectors without a
 * network or an account — a signer that is wrong fails every request
 * identically, which tells you nothing about *why*.
 */
export function signRequest({
  config,
  method,
  key,
  payload,
  now,
}: {
  config: R2Config;
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  key: string;
  payload: Buffer;
  now: Date;
}): { url: string; headers: Record<string, string> } {
  const host = new URL(config.endpoint).host;
  const path = canonicalPath(config.bucket, key);

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260820T221530Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);

  // Sorted by header name, lowercased, values trimmed — the order is part of
  // what is signed, so it cannot be left to object key ordering.
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    path,
    "", // no query string on any request we make
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), REGION), SERVICE),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    url: `${config.endpoint}${path}`,
    headers: {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

const EMPTY = Buffer.alloc(0);

async function send(
  config: R2Config,
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  payload: Buffer = EMPTY,
): Promise<Response> {
  const { url, headers } = signRequest({ config, method, key, payload, now: new Date() });
  return fetch(url, {
    method,
    headers,
    body: method === "PUT" ? new Uint8Array(payload) : undefined,
  });
}

/**
 * Errors carry the status and R2's own message.
 *
 * A bare "request failed" during an incident sends whoever is on call to read
 * this file instead of the fix. 403 means the credentials or the bucket name;
 * 404 on a read means the object is genuinely gone.
 */
async function fail(op: string, key: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(
    `R2 ${op} failed for ${key}: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`,
  );
}

export async function r2Put(config: R2Config, key: string, body: Buffer): Promise<void> {
  const res = await send(config, "PUT", key, body);
  if (!res.ok) await fail("PUT", key, res);
}

export async function r2Get(config: R2Config, key: string): Promise<Buffer> {
  const res = await send(config, "GET", key);
  if (!res.ok) await fail("GET", key, res);
  return Buffer.from(await res.arrayBuffer());
}

export async function r2Exists(config: R2Config, key: string): Promise<boolean> {
  const res = await send(config, "HEAD", key);
  if (res.ok) return true;
  if (res.status === 404) return false;
  return fail("HEAD", key, res);
}

export async function r2Delete(config: R2Config, key: string): Promise<void> {
  const res = await send(config, "DELETE", key);
  // S3 deletes are idempotent: a missing object is the desired end state.
  if (!res.ok && res.status !== 404) await fail("DELETE", key, res);
}
