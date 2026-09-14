# Threat model — tamper-evident audit and document anchoring

This document states what the anchoring system defends against, what it does
not, and which assumptions have to hold for its claims to mean anything. It is
maintained alongside the code: a change that moves a boundary in this document
lands in the same commit as the code that moved it.

Read `docs/DPDP-ARCHITECTURE.md` for how erasure is reconciled with an immutable
anchor, and `DECISIONS.md` for the reasoning behind individual choices.

---

## 1. What the system is for

A firm, that firm's client, or a court must be able to establish that a document
or an audit event existed **in a specific form at a specific time**, without
trusting LEX Practice's servers and without trusting LEX Practice.

That is the entire claim. It is narrower than it sounds, and §6 states the
narrowing precisely. Everything in this system is built so that the claim stays
literally true under adversarial reading — including reading by opposing counsel
whose interest is to break it.

---

## 2. Three layers, and what each buys

Each layer is useful on its own. Together they compound, because each one
removes a different party from the set you have to trust.

| Layer                                     | Detects tampering by                       | Requires trusting     |
| ----------------------------------------- | ------------------------------------------ | --------------------- |
| 1. Hash-chained audit log                 | Anyone without full database write access  | LEX Practice          |
| 2. Signed chain head + RFC 3161 timestamp | LEX Practice staff without KMS signing key | A timestamp authority |
| 3. Public chain anchor                    | Everyone, including LEX Practice           | Nobody                |

**Layer 1 ships first, and it ships before there is anything to anchor.** History
that was never hashed cannot be anchored retroactively — an anchor placed today
says nothing about a record written last month unless that record was in the
chain when it was written. Every day Layer 1 is not running is a day of
permanently unanchorable history. This is why the build order is not negotiable.

---

## 3. Adversaries we defend against

Each entry names the adversary, what they can do, and which layer stops them.

### 3.1 A firm employee altering a matter record after the fact

A clerk or an advocate who realises a limitation date was missed, or that a
conflict of interest was recorded and ignored, and edits the record to match the
story they now want to tell.

**Capability:** ordinary application access, possibly administrative access
within their own chamber. No database credentials.

**Stopped by Layer 1.** The application cannot rewrite an audit row — the
database refuses `UPDATE` and `DELETE` on the audit table by trigger, and no role
holds those grants. The chain makes a deletion detectable as well as a
modification: removing a row leaves a sequence gap and a broken link in every
subsequent row.

### 3.2 A LEX Practice engineer with production database access

An engineer who can connect to the production database as a superuser, acting on
a request from a large client, under legal pressure, or dishonestly.

**Capability:** arbitrary SQL, including `ALTER TABLE ... DISABLE TRIGGER` and
direct writes. Can rewrite any row and recompute the whole hash chain so that it
validates internally.

**Not stopped by Layer 1.** A chain whose head is only ever stored in the same
database that the adversary controls can be rewritten end to end. This is the
specific reason Layer 1 alone is not sufficient and is marked "requires trusting
LEX Practice" in the table above.

**Stopped by Layers 2 and 3.** The daily chain head is signed with a key held in
cloud KMS, which the application server can use but cannot read, and is timestamped
by an external authority and published to a public chain. Rewriting history
requires producing a new head — and the old head is already signed, timestamped
and on-chain. The rewrite is detectable by anyone who kept, or can fetch, the
earlier head.

**This is the property the whole design turns on:** whoever can write to the
database must not also be able to sign. If those two capabilities ever sit with
the same principal, every claim in the table above collapses to "trust LEX
Practice". The separation is not an implementation detail, it is the security
property; everything else is plumbing.

### 3.3 A third party holding a database dump

Someone who obtains a backup — legitimately in discovery, or otherwise — modifies
it, and returns it as genuine.

**Capability:** total control of the copy they hand over. None over the original.

**Stopped by Layers 1–3, jointly.** The recipient recomputes the chain from the
dump and compares the resulting head against the signed, timestamped, on-chain
head for that day. A modified dump produces a different head. Note that this only
works if the verifier checks against an independently published head; comparing
the dump against itself proves nothing, because a competent modifier recomputes
the chain.

### 3.4 An opposing party alleging a record was fabricated

Not an attack on the system — an attack on the evidence in proceedings. The
allegation is that a matter note, an attendance record or a document was created
after the dispute arose and backdated.

**Stopped by Layer 3, partially and honestly.** An anchor establishes that the
document's hash was committed to a public chain in a block whose time is not
under LEX Practice's control or the firm's. It rebuts "created last week" for
anything anchored a year ago. It does **not** establish that the document is
truthful, that the named author wrote it, or that it was unaltered between
creation and anchoring. See §6.

---

## 4. Adversaries we explicitly do not defend against

Naming these is part of the design, not an apology for it. A system that claims
to defend against everything is not trustworthy.

### 4.1 An attacker controlling both the database and the KMS signing key

If one principal can rewrite rows and sign the resulting head, they can produce a
self-consistent false history. Layer 3 limits the damage — they cannot change a
root already published on-chain, so the falsification is confined to the period
after the last anchor and is bounded by the anchoring interval. Beyond that
bound, this adversary wins, and the mitigation is operational (key custody,
separation of duties, KMS audit logging), not cryptographic.

### 4.2 A firm that anchors a false document

Anchoring proves existence and time. It says nothing about truth. A firm can
anchor a fabricated attendance note on the day it fabricates it, and the anchor
will verify forever. This is not a flaw to be fixed — no cryptographic system can
attest to the truthfulness of a statement — but it is a thing users will assume
we do unless the copy is careful. It is why "proves authenticity" is a banned
string in user-facing text.

### 4.3 Coercion of the timestamp authority

RFC 3161 tokens are as trustworthy as the authority that issued them. A coerced
or compromised TSA can backdate. Layer 3 is the mitigation: a public chain's
block times are not issued by any single party we could be asked to lean on.
Where both are present, the weaker claim of the two is the one that should be
reported.

### 4.4 Compromise before the point of anchoring

The central limitation, stated in full in §6.3.

### 4.5 Availability

Nothing here prevents deletion of the underlying document, denial of service, or
loss of the database. Tamper-**evidence** is not tamper-**resistance** and it is
not backup. Detecting that a record was destroyed does not restore it.

---

## 5. Assumptions

If one of these fails, the claims above fail with it.

- **SHA-256 is collision-resistant.** All of Layers 1–3 reduce to this. A
  practical collision attack would let an adversary produce a second document
  matching an anchored hash. There is no known attack; if one appears, every
  anchor written before it is still meaningful and every one after it is not.
- **Ed25519 signatures are unforgeable without the private key**, and the KMS
  holds that key such that the application can request a signature and cannot
  read the key.
- **The database enforces its own constraints.** Append-only is a trigger and a
  set of grants, not a convention in application code — application code is
  precisely what an adversary replaces.
- **The public chain we anchor to is not reorganised past our confirmation
  depth.** A root reported as anchored at N confirmations is as final as that
  chain is at N confirmations, no more.
- **Verifiers keep or can independently fetch the published head.** A proof
  checked only against data the prover supplied is not a proof.

---

## 6. What this system does not prove

These are constraints on user-facing copy, enforced by a test, not caveats in a
footnote. Every string in the UI and every PDF export must be consistent with
this list.

### 6.1 Not authorship

It proves a file existed. It does not prove who made it. Anchoring binds a hash
to a time, and nothing in the construction binds it to a person.

### 6.2 Not truth

A perfectly anchored document can be entirely false. Existence at a time is
orthogonal to accuracy of content.

### 6.3 Not integrity before anchoring

We prove a document existed in a given form at a given time. We do **not** prove
it was not altered before it was first anchored. If a document is created on
Monday, altered on Tuesday and anchored on Wednesday, the anchor attests to the
Wednesday version and is silent about Monday.

Two consequences follow, and both are requirements rather than observations:

- Anchor as early in the document lifecycle as possible — at upload, not at
  matter close.
- The anchoring timestamp is shown in the UI wherever an anchor is shown, so the
  gap between creation and anchoring is never hidden from the person relying on
  it.

### 6.4 Not prevention

It detects tampering. It does not stop it. An adversary with write access can
still alter a record; what changes is that the alteration becomes provable
rather than deniable.

### 6.5 Not admissibility

Electronic records in India still require the certificate under the Bharatiya
Sakshya Adhiniyam. Anchoring supports that certificate — it is evidence going to
the integrity of the record — but it does not replace it, and no part of this
system produces one. Any evidentiary claim made in product copy, marketing or a
generated PDF is reviewed by counsel before it ships.

### 6.6 Banned strings

`lib/verify/src/copy.test.ts` asserts that no user-facing string contains:

> "proves authenticity", "legally valid", "court-approved", "tamper-proof",
> "immutable record"

Tamper-**evident** is accurate. Tamper-**proof** is false, and a court is exactly
the audience that will notice the difference.

---

## 7. Privacy is a constraint on the cryptography, not a review step

An anchor is permanent. Anything hashed into it in a reversible form is
permanent too, and DPDP grants a right to erasure that no amount of on-chain
immutability excuses.

The rule that follows is absolute and shapes the design of every structure in
`lib/crypto-core`:

**No personal data is ever hashed into an anchored structure in a form that
survives erasure.**

Concretely:

- `hash256` is for **high-entropy** content only — document bytes. A bare hash of
  a file's contents is not reversible in any practical sense.
- `hmac256` under a per-tenant KMS key is **mandatory** for anything with a
  guessable domain: a client name, a matter number, a case type, an email, a
  date. SHA-256 of "Sharma & Associates / Matter 2026-041" is reversible by
  anyone willing to enumerate a few million plausible strings. Hashing is not
  anonymisation when the input space is small enough to search.
- Audit event payloads carry document hashes and HMAC'd identifiers. They never
  quote the record being audited. An audit log that embeds the data it audits has
  recreated the privacy problem inside the one table nothing can be deleted from.

Erasure is then crypto-shredding: delete the document, delete its per-document
salt, destroy or rotate the key material. The root stays on-chain and is no
longer linkable to any person or document. `docs/DPDP-ARCHITECTURE.md` sets this
out for a Data Protection Officer.

---

## 8. Scope boundary: the learning chain

`lib/learning-chain` implements proof-of-work for teaching purposes. It is
not in the production path, nothing in the production path may import from it,
and a lint rule enforces that. `docs/WHY-NO-POW.md` records why mining is
excluded from the product: proof-of-work buys resistance to history rewriting in
a system with no trusted operator, LEX Practice has a trusted operator, and
anchoring to an existing chain buys the same property for pennies a day.

---

## 9. Review

This document is reviewed when any of the following change: the set of layers in
§2, key custody, the anchoring interval or confirmation depth, or the contents of
an anchored structure. A change to §6 requires counsel review before release.
