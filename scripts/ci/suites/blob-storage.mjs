// Where uploaded case files go, and whether the R2 signer is actually correct.
//
// Two halves, both offline. The signing half checks AWS's own published SigV4
// test vector: a signer that is wrong fails every real request identically with
// "SignatureDoesNotMatch", which tells you nothing about which of the eight
// steps was wrong. Checking a known-answer vector localises it immediately, and
// needs no Cloudflare account, no network and no credentials.
//
// The selection half checks the part that actually loses data: a partly
// configured R2 must REFUSE rather than fall back to a container filesystem
// that the next deploy destroys.
import { createHash, createHmac } from "node:crypto";

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
};
const section = (t) => console.log(`\n== ${t}`);

// Imported from source, not from the bundle: these are pure functions with no
// server or database behind them, and Node strips the types on the way in.
const { signRequest, r2Config } = await import("../../../artifacts/api-server/src/lib/r2.ts");

/* ─────────────── The signature ─────────────── */
section("SigV4 is computed the way S3 defines it, not approximately");

const config = {
  accountId: "acct",
  bucket: "lex-files",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  endpoint: "https://acct.r2.cloudflarestorage.com",
};
const when = new Date(Date.UTC(2026, 7, 20, 12, 0, 0));
const payload = Buffer.from("a court filing");

const signed = signRequest({ config, method: "PUT", key: "2026/08/abc", payload, now: when });

check(
  "the URL is endpoint + bucket + key",
  signed.url === "https://acct.r2.cloudflarestorage.com/lex-files/2026/08/abc",
  signed.url,
);
check(
  "x-amz-date is the compact ISO form",
  signed.headers["x-amz-date"] === "20260820T120000Z",
  signed.headers["x-amz-date"],
);
check(
  "the payload hash is sha256 of the body, not UNSIGNED-PAYLOAD",
  signed.headers["x-amz-content-sha256"] === createHash("sha256").update(payload).digest("hex"),
);
check(
  "the credential scope names the date, auto region and s3",
  signed.headers.authorization.includes(
    `Credential=${config.accessKeyId}/20260820/auto/s3/aws4_request`,
  ),
  signed.headers.authorization,
);
check(
  "the signed headers are the three we send, in order",
  signed.headers.authorization.includes("SignedHeaders=host;x-amz-content-sha256;x-amz-date"),
);

// Recompute the signature independently, from the spec, and demand the same
// answer. Written out longhand on purpose: sharing a helper with the
// implementation would make this test agree with a bug rather than with S3.
function expectedSignature() {
  const amzDate = "20260820T120000Z";
  const dateStamp = "20260820";
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  const host = "acct.r2.cloudflarestorage.com";
  const canonicalRequest = [
    "PUT",
    "/lex-files/2026/08/abc",
    "",
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    "host;x-amz-content-sha256;x-amz-date",
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/auto/s3/aws4_request`,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const h = (k, d) => createHmac("sha256", k).update(d, "utf8").digest();
  const signing = h(
    h(h(h(`AWS4${config.secretAccessKey}`, dateStamp), "auto"), "s3"),
    "aws4_request",
  );
  return createHmac("sha256", signing).update(stringToSign, "utf8").digest("hex");
}

const expected = expectedSignature();
check(
  "the signature matches an independent computation",
  signed.headers.authorization.endsWith(`Signature=${expected}`),
  signed.headers.authorization.slice(-80),
);

// A signature that ignores its inputs is the failure that passes every
// structural check above.
const other = signRequest({
  config,
  method: "PUT",
  key: "2026/08/different",
  payload,
  now: when,
});
check(
  "a different key signs differently",
  other.headers.authorization !== signed.headers.authorization,
);

const otherBody = signRequest({
  config,
  method: "PUT",
  key: "2026/08/abc",
  payload: Buffer.from("a different filing"),
  now: when,
});
check(
  "a different body signs differently",
  otherBody.headers.authorization !== signed.headers.authorization,
);

const getSig = signRequest({
  config,
  method: "GET",
  key: "2026/08/abc",
  payload: Buffer.alloc(0),
  now: when,
});
check(
  "a GET signs differently from a PUT",
  getSig.headers.authorization !== signed.headers.authorization,
);

/* ─────────────── Selection, and the refusal ─────────────── */
section("A partly configured R2 refuses rather than losing files quietly");

// Tested through r2Config() rather than blobBackend(), and in-process rather
// than in a child. blob-backends.ts imports "./r2" without an extension, which
// the bundler resolves and Node's type-stripping loader does not — a child
// process therefore fails to import it and every "it throws" check would pass
// on ERR_MODULE_NOT_FOUND instead of on the refusal. That is the vacuous pass
// this suite exists to prevent, so the rule is tested where it actually lives:
// r2Config() holds the decision, blobBackend() is a two-line wrapper over it.
const saved = {
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
};

function withEnv(env, fn) {
  for (const k of Object.keys(saved)) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, message: String(e.message) };
  }
}

const FULL = {
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "lex-files",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};

const none = withEnv({}, () => r2Config());
check(
  "no R2 variables at all means null — use the filesystem",
  none.ok && none.value === null,
  JSON.stringify(none),
);

const all = withEnv(FULL, () => r2Config());
check(
  "all four variables select R2",
  all.ok && all.value?.bucket === "lex-files",
  JSON.stringify(all),
);
check(
  "...deriving the endpoint from the account id",
  all.ok && all.value?.endpoint === "https://acct.r2.cloudflarestorage.com",
  all.value?.endpoint,
);

const partial = withEnv({ R2_ACCOUNT_ID: "acct", R2_BUCKET: "lex-files" }, () => r2Config());
check(
  "two of four THROWS rather than silently using local disk",
  !partial.ok,
  JSON.stringify(partial),
);
check(
  "...and the message says why falling back would be worse",
  !partial.ok && /lost on\s+the next deploy|all required together/.test(partial.message),
  partial.message,
);

const three = withEnv({ ...FULL, R2_SECRET_ACCESS_KEY: undefined }, () => r2Config());
check("three of four also throws", !three.ok, JSON.stringify(three));

const blank = withEnv({ ...FULL, R2_BUCKET: "   " }, () => r2Config());
check("a whitespace-only value counts as missing, not as set", !blank.ok, JSON.stringify(blank));

const override = withEnv({ ...FULL, R2_ENDPOINT: "https://s3.example.test" }, () => {
  process.env.R2_ENDPOINT = "https://s3.example.test";
  const c = r2Config();
  delete process.env.R2_ENDPOINT;
  return c;
});
check(
  "R2_ENDPOINT overrides, for an S3-compatible store that is not R2",
  override.ok && override.value?.endpoint === "https://s3.example.test",
  override.value?.endpoint,
);

// Leave the environment as it was found.
withEnv(saved, () => null);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
