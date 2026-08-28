# Data Processing Agreement

**LEX Practice** · Last updated: 28 August 2026 · Version 1.0

> **Draft pending review by counsel.** No placeholders remain in this document.
> See `docs/legal/README.md`.

This agreement applies where **Anshuman Chauhan**, sole proprietor carrying on
business as **LEX Practice** ("Processor"), processes personal data on behalf of
a subscribing chamber ("Fiduciary") under the Digital Personal Data Protection
Act 2023. It forms part of the [Terms of Service](/legal/terms).

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
| **Duration**                    | The subscription, plus the 60-day export window                                                           |
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
- **Tell the Chamber without undue delay, and in any case within 48 hours**, of
  becoming aware of a personal data breach, with what we know and what we are
  doing — in time for the Chamber to make its own report to the Data Protection
  Board within the 72 hours the Act allows it.
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
- Dependency and supply-chain controls in the build.

**One measure we do not yet have, stated rather than implied.** The database is
provisioned on a plan that takes **no automated backups and offers no
point-in-time recovery**. A Chamber assessing us should treat loss of the live
database as loss of its data, and should keep its own export. We are moving the
database to a plan with backups and point-in-time recovery; when that is done
this section states the retention period and the date restores were last
tested, and §7 changes with it.

## 5. Subprocessors

The Chamber authorises the following. Each is engaged under terms no less
protective than these:

| Subprocessor                      | Function                          | Location      |
| --------------------------------- | --------------------------------- | ------------- |
| Render Services, Inc.             | Application hosting               | Singapore     |
| Render Services, Inc.             | Managed database                  | Singapore     |
| Clerk, Inc.                       | Authentication and identity       | United States |
| Razorpay Software Private Limited | Payment processing (billing only) | India         |
| Anthropic PBC                     | AI drafting, where enabled        | United States |
| [NOT YET ENGAGED]                 | Transactional email               | —             |

**Anthropic is engaged only where the Chamber switches AI drafting on.** It is
off by default and the Chamber's administrator must enable it deliberately; that
act, and every draft generated afterwards, is recorded in the audit trail. What
reaches Anthropic is the matter's facts, the text of documents the drafting user
may already open, and any style exemplar the Chamber uploaded — never another
matter's material, and never anything if drafting stays off. Anthropic does not
train models on it. A case brief may additionally send short web-search queries
derived from the matter; documents are never sent to a search engine.

No email subprocessor is engaged at present: `SMTP_HOST` is unset, so
transactional mail is not sent. Complete this row before enabling it.

We will give **30 days' notice** before adding or replacing one. The Chamber
may object on reasonable data-protection grounds; if we cannot resolve the
objection, the Chamber may terminate the affected Service without penalty and
receive a pro-rated refund.

We remain liable for our subprocessors' acts and omissions as for our own.

## 6. Cross-border transfer

Processing occurs outside India, and the Chamber should know where before it
puts a client's file into the Service:

| Where             | What goes there                                            | Who             |
| ----------------- | ---------------------------------------------------------- | --------------- |
| **Singapore**     | All Chamber content — matters, documents, the lot          | Render Services |
| **United States** | Users' names, sign-in identifiers, IP addresses            | Clerk           |
| **United States** | Matter facts and document text, **only if drafting is on** | Anthropic       |
| **India**         | Payment details, which we never see                        | Razorpay        |

**Safeguards.** Each subprocessor is engaged under its own data-processing terms
binding it to confidentiality, to processing only on instruction, and to
security measures no less protective than §4. Transport is TLS throughout.
Documents are encrypted at rest before they reach storage, so the hosting
provider holds ciphertext, not files.

Under §16 of the Act the Central Government may restrict transfers to
territories it specifies. None of Singapore or the United States is restricted
at the date of this agreement. If one becomes restricted we will relocate the
processing or give the Chamber notice and the right to terminate under §5.

**The Chamber remains the Fiduciary for this decision.** Whether a particular
client's file may sit on a server outside India, and whether it may be sent to
an AI provider at all, is a professional judgement for the Chamber. We provide
the switch and the record; we do not make the call.

## 7. Return and deletion

On termination the Chamber may export its data for **60 days**. After that we
delete it from live systems within **30 days**, except where law requires
retention.

There are currently no backups for it to persist in — see §4 — so deletion from
the live system is deletion. When backups exist, this section will state how
long deleted data survives in them.

That deletion is performed by us on request or on review; no scheduled job
performs it. A Chamber that needs deletion by a date should ask, and we will
confirm it in writing.

## 8. Audit

Once in any twelve months, on 30 days' notice, the Chamber may request:

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

| For                | Contact                                         |
| ------------------ | ----------------------------------------------- |
| Data protection    | anshumanchauhan0661@gmail.com                   |
| Grievance Officer  | Anshuman Chauhan, anshumanchauhan0661@gmail.com |
| Security incidents | anshumanchauhan0661@gmail.com                   |

All three reach the proprietor directly. Mark a security incident "SECURITY" in
the subject line.
