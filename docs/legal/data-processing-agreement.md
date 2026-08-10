# Data Processing Agreement

**LEX Practice** · Last updated: [DATE] · Version 1.0

> **Draft pending review by counsel.** Placeholders in square brackets must be
> completed before publication. See `docs/legal/README.md`.

This agreement applies where **[LEGAL ENTITY NAME]** ("Processor") processes
personal data on behalf of a subscribing chamber ("Fiduciary") under the Digital
Personal Data Protection Act 2023. It forms part of the
[Terms of Service](/legal/terms).

## 1. Roles

The **Chamber is the Data Fiduciary**. It decides what personal data enters the
Service, why, and for how long.

**We are the Data Processor.** We process it only to provide the Service, and
only on the Chamber's documented instructions — of which these terms and the
Chamber's ordinary use of the Service are the standing set.

If we believe an instruction breaches the Act, we will say so before acting.

## 2. What we process

|                                 |                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Subject matter**              | Providing practice-management software                                                                    |
| **Duration**                    | The subscription, plus the [60]-day export window                                                         |
| **Nature**                      | Storage, retrieval, transmission, backup, deletion                                                        |
| **Purpose**                     | Operating the Service for the Chamber                                                                     |
| **Categories of data subject**  | The Chamber's personnel; its clients; opposing parties and other individuals named in matters             |
| **Categories of personal data** | Names, contact details, roles; matter records; documents the Chamber uploads; correspondence and feedback |

**Special note.** Matter content may include data of a sensitive character —
health, financial affairs, criminal proceedings, the fact of seeking legal
advice — and is likely to attract legal professional privilege. Both parties
process it accordingly.

## 3. Our obligations

We will:

- **Process only on instruction** and only for the Service.
- **Bind everyone with access to confidentiality**, in writing, surviving the
  end of their engagement.
- **Apply the security measures in §4**, and not weaken them during the term.
- **Not use Chamber data for our own purposes.** No model training, no
  analytics resold, no marketing to data subjects.
- **Assist the Chamber** in responding to data-subject requests, and in its own
  breach notification and impact assessments.
- **Tell the Chamber without undue delay, and in any case within [48] hours**,
  of becoming aware of a personal data breach, with what we know and what we are
  doing.
- **Delete or return the data** at the end of the term, per §7.
- **Make available what the Chamber reasonably needs** to satisfy itself we are
  meeting these obligations.

## 4. Security measures

These are implemented, not aspirational:

**Encryption**

- Documents encrypted at rest with AES-256-GCM, per-file random IV, authenticated
  so tampering fails closed. The production server refuses to start without a key.
- TLS in transit throughout, with HSTS.

**Access control**

- Authorisation re-derived from the database on every request; a revoked member
  loses access on their next request.
- Tenant isolation enforced at every read and verified by an automated suite on
  every change.
- Role-based capabilities, granted by a Chamber administrator, never
  self-selected.
- Documents reachable only through an authorisation check — no path-addressable URL.

**Accountability**

- Append-only audit log of privileged actions, which the application cannot edit
  or delete.
- IP addresses truncated before storage.

**Operational**

- Staff access to production limited to those who need it, and logged.
- Automated backups with point-in-time recovery; restores tested.
- Dependency and supply-chain controls in the build.

## 5. Subprocessors

The Chamber authorises the following. Each is engaged under terms no less
protective than these:

| Subprocessor        | Function                          | Location |
| ------------------- | --------------------------------- | -------- |
| [HOSTING PROVIDER]  | Application hosting               | [REGION] |
| [DATABASE PROVIDER] | Managed database and backups      | [REGION] |
| [CLERK / AUTH]      | Authentication and identity       | [REGION] |
| [PAYMENT PROCESSOR] | Payment processing (billing only) | India    |
| [EMAIL PROVIDER]    | Transactional email               | [REGION] |

We will give **[30] days' notice** before adding or replacing one. The Chamber
may object on reasonable data-protection grounds; if we cannot resolve the
objection, the Chamber may terminate the affected Service without penalty and
receive a pro-rated refund.

We remain liable for our subprocessors' acts and omissions as for our own.

## 6. Cross-border transfer

[Complete. Identify any processing outside India, the safeguards applied, and
note that the Central Government may restrict transfers to specified territories
under s.16 of the Act.]

## 7. Return and deletion

On termination the Chamber may export its data for **[60] days**. After that we
delete it from live systems within **[30] days**, and from backups as those age
out on their normal cycle (currently [30] days), except where law requires
retention.

We will confirm deletion in writing on request.

## 8. Audit

Once in any twelve months, on [30] days' notice, the Chamber may request:

- our current security documentation and any third-party assessment we hold; and
- written answers to a reasonable security questionnaire.

An on-site audit is available where a regulator requires it, or following a
breach affecting the Chamber, at the Chamber's cost, on terms protecting other
customers' confidentiality.

## 9. Liability

Liability under this agreement is subject to the limitations in the
[Terms of Service](/legal/terms), except where the Act does not permit that.

## 10. Precedence

If this agreement conflicts with the Terms of Service on the processing of
personal data, **this agreement prevails**.

## Contact

| For                | Contact          |
| ------------------ | ---------------- |
| Data protection    | [PRIVACY EMAIL]  |
| Grievance Officer  | [NAME], [EMAIL]  |
| Security incidents | [SECURITY EMAIL] |
