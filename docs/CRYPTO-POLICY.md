# Cryptography policy and current state

Every cryptographic requirement this codebase is held to, what is actually
implemented today, and — for each gap — whether it is scheduled, deliberately
declined, or not achievable on this runtime.

A row that says "not achievable" is not a row to quietly delete before an audit.
A compliance document that claims a property the code does not have is worse
than one that admits the gap, because the first thing an assessor does is test a
claim.

Companion documents: `docs/THREAT-MODEL.md` (what the anchoring system proves
and does not), `DECISIONS.md` (why individual choices were made),
`docs/legal/compliance-register.md` (the regulatory register).

---

## 0. Findings from the audit of existing code

Five things were found reviewing the cryptography already in the repository.
They are listed worst first. None is a break of an algorithm; all four of the
real ones are a construction used in a way that does not do what the
surrounding comment believes it does.

### 0.1 Uploaded files are encrypted without binding them to their identity — HIGH · **FIXED**

`artifacts/api-server/src/lib/blob-store.ts` encrypts each file with AES-256-GCM
under a fresh random IV. GCM authenticates the _bytes_; it does not authenticate
_which file those bytes are_. Nothing in the stored blob commits to its storage
key, so an attacker with write access to the blob store — a compromised R2
token, a host operator, a misdirected backup restore — can move file A's
ciphertext to file B's key and it decrypts cleanly, with a valid tag, and is
served as file B.

For a practice where the files are evidence, a silent swap of one client's
document for another's is close to the worst available outcome, and it leaves
no trace: the tag verifies, so nothing logs an error.

**Fixed** by the `LEXP2` format in `artifacts/api-server/src/lib/blob-crypto.ts`.
The storage key, the owning workspace and the key scheme are bound in as
additional authenticated data, built with the canonical encoder rather than
concatenated — an ambiguous AAD binds less than it appears to. The AAD is rebuilt
at read time from what the _caller_ believes it is reading, never from the blob's
own header, so a moved or re-pointed blob fails the tag. `blob-crypto.test.ts`
carries the attack as a test.

**Still open for legacy blobs.** A `LEXP1` tag was computed without AAD and
cannot gain one retroactively, so files written before this change remain
swappable until the estate is rewritten as v2. That rewrite needs each blob's
owning workspace from the document rows; it is tracked in §7.

### 0.2 A plaintext blob is served in place of an encrypted one — HIGH · **FIXED**

The same file treats an absent `LEXP1` magic prefix as "written before
encryption existed" and returns the bytes unchanged. That is a sound migration
decision and an unsound security one: it means anyone who can write to the blob
store can _remove_ encryption from a document by replacing the ciphertext with
plaintext, and the read path will serve it without complaint. An at-rest
encryption control that an attacker can turn off per-file is not a control.

**Fixed** by refusing, in `blob-store.ts`. A blob with no recognised magic
prefix is an error once key material is configured. The legacy allowance is an
explicit `ALLOW_PLAINTEXT_BLOBS=on`, off by default, reported by `preflight.ts`
at every boot while it is on, and documented as a migration step rather than a
setting.

Deliberately _not_ done with a per-row encryption column: the rule has to hold
for every blob the process reads, including paths that never load a document
row, and a check enforced in one query is a check the next caller forgets. Where
no key material is configured at all — preview and local development — plaintext
is still returned, because that is what `put` wrote. Production cannot reach that
branch: the boot guard aborts first.

### 0.3 One global file-encryption key for every chamber — HIGH · **PARTLY FIXED**

`FILE_ENCRYPTION_KEY` is a single 32-byte key, read from an environment
variable, covering every tenant's documents. Three consequences: the blast
radius of a leak is every firm at once; there is no per-tenant crypto-shredding,
so DPDP erasure depends entirely on deleting every copy of the ciphertext; and
the key sits in the process environment, which is visible to anything that can
read `/proc/self/environ`, appears in a crash dump, and is printed by a careless
`console.log(process.env)`.

**Partly fixed.** Keys are now per tenant per purpose, derived by HKDF in
`artifacts/api-server/src/lib/keys.ts`. A key recovered from a log or a crash
dump opens one chamber's files rather than every chamber's, and destroying one
firm's key material is a meaningful act rather than an estate-wide one.

**The custody half is still open.** The root is still an environment variable,
readable through `/proc/self/environ`, present in a crash dump, and printed by
one careless `console.log(process.env)`. Cloud KMS is the intended destination
and `KeyProvider` is the shape it will arrive in — nothing else in the codebase
reads key material, so that swap touches one file.

### 0.4 `WORKSPACE_TOKEN_SECRET` is a passphrase, checked only for length — MEDIUM

`artifacts/api-server/src/lib/workspace-token.ts` accepts any string of 16 or
more characters as an HMAC key. `.env.example` says to generate it with
`openssl rand -hex 32`, and `preflight.ts` warns when it is unset or short, but
nothing requires it to be random and nothing fails the boot. A 16-character
human-chosen passphrase as a MAC key is brute-forceable offline by anyone
holding one token.

The unset case is deliberately a warning rather than a fatal, and that trade is
defensible — a random per-process fallback signs people out on restart, which is
an availability problem, not a forgery one. The _weak_ case is different: a bad
key is worse than no key, because it looks configured.

**Fix:** require 32 bytes of hex or base64 in production, matching the shape
`FILE_ENCRYPTION_KEY` already enforces, and fail closed on a short one.

### 0.5 Invite tokens are stored in the clear — LOW

`lib/db/src/schema/invites.ts` stores the invite token as `text`, and
`routes/invites.ts` mints it with `randomBytes(24)` — 192 bits, properly random,
so it is unguessable. But anyone with database read access can use one directly.
Tokens are bearer credentials and should be stored as `hash256` of the token,
with the plaintext existing only in the email that carries it.

**Not a break**, and lower priority than the four above, but it is the same
class of mistake as storing a password.

### 0.6 Not findings — checked and sound

Recorded so the next reviewer does not spend the afternoon on them again:

- **`razorpay.ts`** verifies the webhook signature with `createHmac` and
  `timingSafeEqual`, over the raw body captured by `express.raw()` before
  `express.json()`. Correct, including the part everybody gets wrong.
- **`workspace-token.ts`** uses `JSON.stringify` in the token payload. That is
  safe here and is _not_ an instance of the rule in `lib/crypto-core`:
  verification re-signs the received payload string rather than re-serialising a
  parsed object, so key order never enters the comparison.
- **`r2.ts`** implements AWS SigV4 from `createHash`/`createHmac`. SigV4 is a
  fully specified scheme, not a home-made protocol, and the implementation is
  the standard one. It is on the edge of the "no custom crypto" rule and worth
  replacing with an SDK if one is ever pulled in for another reason.

---

## 1. Algorithm selection

| Requirement              | Status | What is used                                                                      |
| ------------------------ | ------ | --------------------------------------------------------------------------------- |
| Strong, non-deprecated   | Met    | SHA-256 and double SHA-256; HMAC-SHA-256; HKDF-SHA-256; AES-256-GCM; Ed25519      |
| No custom crypto         | Met    | `node:crypto` only, which is OpenSSL. No third-party crypto library in any `src/` |
| Peer-reviewed primitives | Met    | Every primitive has published test vectors, and the suite asserts against them    |

**Asymmetric: Ed25519, not RSA-3072.** The checklist offers "RSA (3072+ bit) or
ECC"; Ed25519 is the ECC branch. It is chosen over RSA and over ECDSA for
reasons that matter specifically here: signatures are 64 bytes rather than 384,
which matters when they are published on-chain and paid for by the byte;
verification has no per-signature randomness, so a court-appointed expert
re-implementing the verifier cannot introduce a nonce-reuse bug the way ECDSA
invites; and it is supported natively by Google Cloud KMS as `EC_SIGN_ED25519`.

**Symmetric: AES-256-GCM.** Already in use for files at rest. ChaCha20-Poly1305
would be equally acceptable; AES-GCM is hardware-accelerated on every host this
runs on and is what the existing blobs are written with, so switching would
strand data for no gain.

**Hashing: double SHA-256, not SHA-3.** Reasoning is in the header of
`lib/crypto-core/src/hash.ts`. Briefly: SHA-256 is in every standard library and
every expert's toolkit, doubling removes length-extension for nothing, and a
verifier who must install something to check a proof does not check the proof.

**One rule stated plainly, because it is the one most often broken by accident:**

> `hash256` is for high-entropy content — document bytes, and nothing else.
> `hmac256` under a secret key is **mandatory** for any value with a guessable
> domain: a client name, a matter number, an email, a date, a workspace id.

`sha256("Sharma & Associates / Matter 2026-041")` is not anonymised. It is
recovered by guessing a thousand plausible strings.
`lib/crypto-core/src/hash.test.ts` runs that attack as a passing test — it
succeeds against `hash256` and fails against `hmac256` — and it stays in the
suite as documentation.

---

## 2. Key management

| Requirement                        | Status       | Notes                                                                  |
| ---------------------------------- | ------------ | ---------------------------------------------------------------------- |
| Keys outside application code      | Met          | No key is a literal anywhere in the repository                         |
| Keys in a KMS or HSM               | **Not met**  | Today: environment variables. Google Cloud KMS is the scheduled target |
| Key rotation without losing access | **Declined** | Deliberate. See §2.2 — this is the one checklist item we do not meet   |

### 2.1 Target architecture

Three tiers, each with a different custody rule:

```
Google Cloud KMS
 ├─ KEK  (symmetric, never leaves KMS)      wraps every per-tenant key
 └─ Ed25519 signing key (never leaves KMS)  signs the daily chain head

Database
 └─ per-tenant key material, WRAPPED by the KEK      ciphertext, not a key

Process memory
 └─ per-tenant key, unwrapped on demand, cached      Buffer only, never a string
```

**Why per-tenant keys are not themselves KMS keys.** The audit log HMACs several
identifiers on every event. A KMS `MacSign` call per HMAC is a network round trip
per identifier per event, which is not a performance preference — it makes the
audit log fail when KMS is slow, and an audit log that fails open is not an audit
log. So the per-tenant key is unwrapped once and cached, and the honest
consequence is recorded in `docs/THREAT-MODEL.md`: an attacker with process
memory gets the keys of the tenants currently cached, not all tenants and not the
KEK.

**Why the signing key stays KMS-native.** It is used once a day. There is no
throughput argument, and the write/sign separation is the property the entire
threat model turns on — whoever can write to the database must not be able to
sign. `AsymmetricSign` only, and the application genuinely cannot read the key.

**Wrapped keys in the database are not "keys in the database".** The build brief
forbids the latter and is right to. A KEK-wrapped key blob is ciphertext that is
useless without a KMS call the attacker cannot make.

### 2.2 Rotation: declined, with the consequence stated

**Decision: per-tenant keys are not rotated.** Taken by the product owner, having
been told it fails the rotation requirement.

The reasoning is real. Rotation and crypto-shredding pull in opposite
directions: rotation must preserve access to old data, and shredding is the
deliberate destruction of exactly that access. A scheme that retains old key
versions so that old data stays readable is a scheme in which destroying a key
does not erase anything, and DPDP erasure is the reason this key hierarchy
exists at all. Choosing shreddability over rotation is a coherent choice.

**What it costs, stated so nobody is surprised later:**

- **There is no remediation for a leaked tenant key.** If one is disclosed, every
  identifier reference ever anchored for that tenant is permanently
  de-anonymisable by anyone holding the leak. The anchors are on a public chain
  and cannot be withdrawn. The only response is to tell the firm.
- **Erasure granularity is the whole tenant, not one document.** Destroying a
  tenant key unlinks every anchored reference for that firm at once. A single
  data principal's erasure request cannot be satisfied by key destruction and
  must be satisfied by deleting the underlying row and blob.
- **Deleting a blob is only erasure if every copy goes.** Backups, R2 object
  versions and volume snapshots are copies. Without a per-document key to
  destroy, "we deleted the file" is a claim about a storage system's retention
  behaviour rather than a cryptographic fact.

That last point is the one worth a second look, and it is narrower than full
rotation: a random per-document key, wrapped by the per-tenant key, gives
per-document shredding and a real answer on backups **without introducing key
rotation at all**. The per-tenant key still never rotates and destroying it still
shreds the tenant. Flagged for the product owner; not implemented against the
current decision.

### 2.3 Generation and handling rules

- Key material is generated with `randomSecretKey()` (`node:crypto` CSPRNG),
  never from a passphrase, a UUID, or a timestamp.
- Key material is a `Buffer` from creation to destruction and **never a
  `string`**. Strings are immutable and cannot be wiped; this is the actual
  mitigation behind §4.2.
- Purpose separation is by HKDF `info`, never by reusing one key for two jobs.
  `hkdf256` refuses an empty `info` for this reason.
- Fail closed. A production boot without configured key material must abort, not
  fall back to a generated key or to plaintext. `assertEncryptionConfigured`
  already does this for files; §0.4 extends it to the token secret.

---

## 3. Data at rest

| Requirement              | Status      | Notes                                                               |
| ------------------------ | ----------- | ------------------------------------------------------------------- |
| Authenticated encryption | Met         | AES-256-GCM for uploaded files                                      |
| Identity bound in        | **Not met** | §0.1 — no AAD, so ciphertexts are swappable between files           |
| Unique IV per operation  | Met         | 12 random bytes per file, never derived from the content or the key |
| No IV reuse              | Met         | A fresh `randomBytes(12)` per encryption, and blobs are immutable   |

On IV reuse specifically, because it is the failure that silently destroys GCM:
two encryptions under the same key and IV leak the XOR of the plaintexts and
allow forgery of the authentication tag. Files here are written once and never
re-encrypted in place, so the only way to reuse an IV would be to derive it
deterministically. Nothing does, and nothing may.

Database columns are not separately encrypted at rest beyond whatever the host
provides at the volume level. That is a deliberate scope boundary and is stated
in `docs/legal/compliance-register.md` rather than hidden here.

---

## 4. Implementation

| Requirement            | Status      | Notes                                                         |
| ---------------------- | ----------- | ------------------------------------------------------------- |
| CSPRNG for all secrets | Met         | `randomBytes` is exported so nothing needs `Math.random()`    |
| Constant-time compare  | Met         | `constantTimeEqual`; `timingSafeEqual` in the two older paths |
| Zeroization            | **Partial** | See §4.2 — honest limits, not a claim                         |
| Errors leak nothing    | **Partial** | See §4.3                                                      |

### 4.1 Randomness

`Math.random()` is a non-cryptographic PRNG whose future output is predictable
from a handful of prior values. It appears nowhere in a security path.
`randomBytes` and `randomSecretKey` are exported from `@workspace/crypto-core`
so there is never a reason to reach for anything else.

### 4.2 Zeroization is best-effort, and saying otherwise would be false

`zeroize()` overwrites a `Buffer` in place. On this runtime that is genuinely all
that can be done, and the limits are these:

- **A `string` cannot be wiped.** JavaScript strings are immutable and the engine
  may have interned or copied one anywhere. The mitigation is not to wipe strings
  but to never put key material in one — which is a rule in §2.3, enforced by
  every key-handling signature taking a `Buffer`.
- **Copies are beyond reach.** Anything that copied the key before the wipe still
  holds it. `hash.test.ts` asserts this rather than describing it.
- **The operating system may have paged that memory to disk**, and a container
  host may have snapshotted it. Nothing inside a process changes that.

So `zeroize` shortens the window in which a heap dump is useful. It is not a
guarantee, and its presence is not a reason to hold a key longer than needed.

### 4.3 Error handling

Cryptographic failures return a single undifferentiated result to the caller: a
signature check returns `false`, a decrypt failure is one error. No message
distinguishes "wrong key" from "bad padding" from "wrong length" — that
distinction is what turns a decryption routine into an oracle.

**Gap:** `EncodingError` and `CryptoUsageError` carry detailed messages by
design, because they describe programming mistakes rather than failed attacker
attempts, and a canonicalisation bug that reports "decode failed" is a bug nobody
can fix. They must therefore never be returned to an unauthenticated caller
verbatim. The public verifier (Phase 8) is the place this could go wrong, and the
requirement is recorded here for when it is built: internal detail to the log,
one flat "verification failed" to the response.

---

## 5. Data in transit

| Requirement             | Status             | Notes                                                           |
| ----------------------- | ------------------ | --------------------------------------------------------------- |
| TLS 1.3 / 1.2 minimum   | Host-controlled    | Terminated at Render's edge, not in this process                |
| Old TLS/SSL disabled    | Host-controlled    | Same                                                            |
| Perfect forward secrecy | Host-controlled    | ECDHE suites, set by the edge                                   |
| HSTS                    | Met                | `middlewares/securityHeaders.ts`, 180 days, `includeSubDomains` |
| Certificate pinning     | **Not applicable** | See below                                                       |

TLS version and cipher suite are properties of the edge that terminates it. The
application cannot enforce them and must not pretend to. What it _can_ do it
does: HSTS in production, and `TRUST_PROXY` handled explicitly so a forwarded
header cannot be forged to dodge rate limits.

**Certificate pinning does not apply to this product.** The client is a browser
SPA. Browser-based pinning (HPKP) was removed from every major browser because it
was a reliable way to take your own site offline permanently, and there is no
replacement a web page can use. Pinning is a mobile/desktop control, and there is
no mobile or desktop app here. If one is ever built, pin there.

Two items for the deployment checklist rather than the code:

- HSTS `max-age` is 180 days without `preload`. Adding preload is a one-way door
  — removal takes months — so it is a deliberate decision, not an oversight.
- Outbound calls (Razorpay, R2, a TSA, an RPC endpoint) must verify certificates.
  Nothing disables verification today; nothing may.

---

## 6. Compliance

The checklist names GDPR, HIPAA and PCI-DSS. What actually applies here:

- **DPDP Act 2023 (India)** — the real regime for this product. The right to
  erasure is the constraint that shapes the key hierarchy; see
  `docs/DPDP-ARCHITECTURE.md` and `docs/legal/compliance-register.md`.
- **GDPR** — applies only if a chamber has EU data principals. The architecture
  is compatible: Article 17 erasure is satisfied by the same crypto-shredding
  path as DPDP §12, and the pseudonymisation Article 32 asks for is what
  `hmac256` under a destroyable key provides. Not separately certified.
- **PCI-DSS** — out of scope, and deliberately so. Razorpay is the payment
  processor; no card number, CVV or PAN touches this system. The only
  payment-related cryptography here is the webhook HMAC, and keeping it that way
  is worth more than any control we could implement.
- **HIPAA** — not applicable. No protected health information, no US covered
  entity.

**Nothing in this document is a legal opinion.** Evidentiary and compliance
claims in product copy, marketing or a generated PDF are reviewed by counsel
before release — the rule is in `docs/THREAT-MODEL.md` §6.5 and it is not a
formality.

---

## 7. Open items

Ordered by severity, not by effort.

| #    | Item                                                           | Severity | State                   |
| ---- | -------------------------------------------------------------- | -------- | ----------------------- |
| §0.3 | Move the root key into Cloud KMS                               | High     | Open — seam in place    |
| §0.1 | Rewrite legacy `LEXP1` blobs as `LEXP2` so they gain a binding | High     | Open — needs owner rows |
| §0.4 | Require a 32-byte random `WORKSPACE_TOKEN_SECRET`              | Medium   | Open                    |
| §0.5 | Store `hash256` of invite tokens, not the tokens               | Low      | Open                    |
| §4.3 | Flat error surface on the public verifier                      | Low      | Open — Phase 8          |
| §0.1 | Bind identity as GCM AAD on every new write                    | High     | **Done**                |
| §0.2 | Fail closed on an unencrypted blob                             | High     | **Done**                |
| §0.3 | Per-tenant, per-purpose key derivation                         | High     | **Done**                |

§2.2 — a per-document key, for per-document shredding — was put to the product
owner and **declined**. Erasure of one data principal is therefore satisfied by
deleting the row and the blob, and the limit that follows is accepted: a copy
surviving in a backup or an R2 object version is outside that guarantee. Recorded
here rather than discovered during an audit.
