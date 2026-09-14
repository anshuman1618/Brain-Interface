/**
 * The concrete structures that get hashed, built out of `encoding.ts`.
 *
 * One rule governs everything in this file, and it comes from
 * `docs/THREAT-MODEL.md` §7: **no personal data is ever hashed into an anchored
 * structure in a form that survives erasure.** An anchor is permanent. Anything
 * reversible that reaches it is permanent too, and DPDP's right to erasure does
 * not pause for a blockchain.
 *
 * So every identifier below is a `Hash`-width *reference* — the HMAC of the
 * real identifier under a per-tenant key held in KMS, produced by
 * `hmac256` (Phase 2), never a bare `hash256`. A bare SHA-256 of a client name
 * or a matter number is reversible by anyone willing to enumerate a few million
 * plausible strings; hashing is not anonymisation when the input space is small
 * enough to search. Destroying the tenant key destroys the link.
 */

import {
  type Codec,
  type Hash,
  type VersionedCodec,
  enumU16,
  hash,
  struct,
  u64,
  versionRegistry,
  versioned,
} from "./encoding.js";

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What happened. A numeric code rather than a string, for two reasons: a fixed
 * width cannot smuggle free text into an anchored structure, and a code is
 * stable under renaming — relabelling "matter.close" in the UI must not change
 * the bytes of records already anchored.
 *
 * Codes are append-only. Never reuse or renumber one.
 */
export const AuditAction = {
  /** The first row of a tenant's chain. Carries no subject. */
  GENESIS: 1,
  RECORD_CREATED: 2,
  RECORD_UPDATED: 3,
  RECORD_DELETED: 4,
  DOCUMENT_UPLOADED: 5,
  DOCUMENT_DOWNLOADED: 6,
  ACCESS_GRANTED: 7,
  ACCESS_REVOKED: 8,
  /** A DPDP erasure was carried out. The *fact* is retained; the data is not. */
  ERASURE_EXECUTED: 9,
} as const;

export type AuditActionCode = (typeof AuditAction)[keyof typeof AuditAction];

/** What the action was performed on. Append-only, same as `AuditAction`. */
export const AuditSubject = {
  NONE: 0,
  MATTER: 1,
  DOCUMENT: 2,
  TIME_ENTRY: 3,
  INVOICE: 4,
  MEMBERSHIP: 5,
  CLIENT: 6,
} as const;

export type AuditSubjectCode = (typeof AuditSubject)[keyof typeof AuditSubject];

/* -------------------------------------------------------------------------- */
/* Audit event                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The payload of one audit-log row, version 1.
 *
 * Every field is fixed-width, and that is deliberate rather than incidental:
 * there is no free-text field, so no future caller can append "the client said
 * X" to a structure that is about to be anchored and can never be deleted. If a
 * later version genuinely needs variable-length data, it gets a `contextHash`
 * over data held outside the anchored path — which is what v1 already does.
 *
 * 181 bytes: 1 version + 180 body.
 */
export interface AuditEventV1 {
  /** `hmac256(tenantKey, tenantId)`. */
  readonly tenantRef: Hash;
  /** Per-tenant monotonic counter. Starts at 0 for the genesis row. */
  readonly sequence: bigint;
  /** Server clock, milliseconds since the Unix epoch. Not evidence of time —
   *  only a Layer 2/3 timestamp is that. See `docs/THREAT-MODEL.md` §2. */
  readonly recordedAtMs: bigint;
  /** `hmac256(tenantKey, userId)`, or 32 zero bytes when the actor is the system. */
  readonly actorRef: Hash;
  readonly action: AuditActionCode;
  readonly subjectType: AuditSubjectCode;
  /** `hmac256(tenantKey, subjectId)`, or 32 zero bytes when there is no subject. */
  readonly subjectRef: Hash;
  /** `hash256` of document bytes, or 32 zero bytes when the event has no content.
   *  A bare hash is safe here and only here: document content is high-entropy. */
  readonly contentHash: Hash;
  /** Commitment to any further structured context, computed outside the
   *  anchored path so the context itself stays erasable. 32 zero bytes when none. */
  readonly contextHash: Hash;
}

const actionCodec = enumU16<AuditActionCode>("auditEvent.action", Object.values(AuditAction));
const subjectCodec = enumU16<AuditSubjectCode>(
  "auditEvent.subjectType",
  Object.values(AuditSubject),
);

const auditEventBodyV1: Codec<AuditEventV1> = struct<AuditEventV1>("auditEvent", [
  ["tenantRef", hash],
  ["sequence", u64],
  ["recordedAtMs", u64],
  ["actorRef", hash],
  ["action", actionCodec],
  ["subjectType", subjectCodec],
  ["subjectRef", hash],
  ["contentHash", hash],
  ["contextHash", hash],
]);

/**
 * Frozen. Every proof ever issued over a v1 event depends on these exact bytes
 * in this exact order. A v2 goes in a new constant beside this one; this one is
 * never edited and never deleted.
 */
export const auditEventV1: VersionedCodec<AuditEventV1> = versioned(1, auditEventBodyV1);

/** Decodes any version of an audit event that has ever existed. */
export const auditEventCodecs = versionRegistry<AuditEventV1>("auditEvent", [auditEventV1]);
