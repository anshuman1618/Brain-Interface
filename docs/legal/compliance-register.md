# Compliance register

**LEX Practice**, operated by Anshuman Chauhan, sole proprietor · 28 August 2026

The four documents in this directory say what we do. This file says what we owe
and whether we are doing it. It exists because a policy is only worth what the
system behind it does, and the gap between the two is the thing that gets
found — by a regulator, by a chamber's counsel doing vendor diligence, or by a
client after something goes wrong.

Every row is one of four things:

- **Done** — implemented and verifiable in the code or the account today.
- **Owner** — a decision or a registration only Anshuman Chauhan can make.
- **Counsel** — needs a qualified lawyer before it is relied on.
- **Ongoing** — a duty with no end date, performed by a person, not a job.

---

## 0. Before taking a single rupee

Four things outrank everything else on this page, and three of them are
operational rather than legal. They are here because a platform that loses a
chamber's files has committed the most serious compliance failure available to
it — §8(5) of the DPDP Act asks for reasonable security safeguards, and losing
the data is the least reasonable outcome there is.

| #   | Item                                                                                                                                                                                                                                                  | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0.1 | **The database expires on 9 September 2026.** It is a Render `free` plan (`dpg-d9t1dd2jobas738ac3g0-a`, Singapore). On expiry it is gone. Move it to a paid plan.                                                                                     | Owner  |
| 0.2 | **That plan takes no backups and has no point-in-time recovery.** Loss of the instance is loss of every chamber's data. The paid plan in 0.1 fixes this; until it does, the Privacy Policy and DPA §4 say so out loud, because a silent gap is worse. | Owner  |
| 0.3 | **Uploaded case files are written to the container filesystem.** `R2_*` is unset, so every document a chamber uploads is destroyed by the next deploy. The server already warns about this at every boot. These are privileged client files.          | Owner  |
| 0.4 | **Fill in `[PLACE OF BUSINESS]`.** Six occurrences across the Terms and the Privacy Policy. It is also the court named in Terms §13 and the address the e-commerce rules require to be displayed. Nothing else in this directory is blank.            | Owner  |

Until 0.1–0.3 are resolved, do not onboard a chamber that will put a real
client's file into the Service. That is not a legal opinion; it is arithmetic.

---

## 1. Digital Personal Data Protection Act 2023

We are a **Data Fiduciary** for account data and a **Data Processor** for
chamber content. Both roles are set out in the Privacy Policy, and the split is
the single most important thing in it.

| §     | Obligation                                             | Where it stands                                                                                                                                                         | Status  |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| §5    | Notice at the point of collection                      | `dpdp-notice.md`, summarised on the sign-in screen beneath the submit control and linked from there. Invited members land on the same screen.                           | Done    |
| §6    | Consent, where consent is the basis                    | We do not rely on consent for account data — the basis is performance of the contract, stated in the Privacy Policy. No consent manager is engaged, and none is needed. | Done    |
| §8(4) | Accuracy and completeness                              | Members correct their own details; a chamber admin corrects membership and role.                                                                                        | Done    |
| §8(5) | Reasonable security safeguards                         | See §4 below. Real, except for 0.2 and 0.3.                                                                                                                             | Partial |
| §8(6) | Breach intimation to the Board and to affected persons | Committed in the Privacy Policy: without delay, detailed report within 72 hours. **There is no tooling and no rehearsed runbook.** See §6 below.                        | Ongoing |
| §8(7) | Erasure when purpose is served                         | `POST /api/privacy/erasure` → a chamber decides → anonymise, not delete, where a professional record must survive. The reasoning is in `routes/governance.ts`.          | Done    |
| §8(9) | Publish contact of the person answering questions      | **Anshuman Chauhan**, `anshumanchauhan0661@gmail.com`, in all four documents.                                                                                           | Done    |
| §9    | Children's data                                        | Not directed at children; where a matter concerns a minor that is chamber content and the chamber is Fiduciary. Stated in the Privacy Policy.                           | Done    |
| §10   | Significant Data Fiduciary duties (DPO, audit, DPIA)   | Turns on volume and sensitivity as notified by the Government. At current scale we are not one. **Re-check at every material increase in chambers.**                    | Ongoing |
| §11   | Right to access and to a summary of processing         | `GET /api/privacy/export` returns everything this chamber holds about the caller, scoped by the same row scope as the rest of the app.                                  | Done    |
| §12   | Right to correction and erasure                        | As §8(4) and §8(7).                                                                                                                                                     | Done    |
| §13   | Grievance redressal, and publishing the officer        | **Anshuman Chauhan is the Grievance Officer.** Acknowledge in 48 hours, answer in 30 days, published in all four documents.                                             | Done    |
| §14   | Nomination                                             | Stated as a right in the Privacy Policy. **No mechanism exists in the product** — a nomination arrives by email and is honoured by hand.                                | Ongoing |
| §16   | Cross-border transfer                                  | Singapore, United States and India, itemised in the Privacy Policy and DPA §6, with what goes to each. None restricted at today's date.                                 | Done    |

**The one to watch.** The DPDP Rules continue to be operationalised. Breach
timing, the Significant Data Fiduciary thresholds and consent-manager
registration are the parts most likely to have moved. Re-read them before
launch rather than trusting this table's date.

## 2. CERT-In Directions of 28 April 2022

These bind any body corporate providing services in India, with no revenue or
size threshold. They are the obligation most often missed by a small platform,
and two of them we do not currently meet.

| Direction | Obligation                                                                   | Where it stands                                                                                                               | Status |
| --------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| (i)       | Synchronise system clocks to NIC or NPL time                                 | Render's hosts, not ours to set. Note the reliance and move on.                                                               | Done   |
| (ii)      | Report listed cyber incidents to CERT-In **within 6 hours** of noticing them | Committed in the Privacy Policy. **No runbook, no CERT-In account, no rehearsed contact path.**                               | Owner  |
| (iv)      | Retain ICT logs for **180 days**, **within India**                           | Logs live with Render in **Singapore**, and application logs are not retained for 180 days at all. **This is a genuine gap.** | Owner  |
| (v)       | KYC and records for subscribers, retained 5 years                            | Chamber and member records are retained for the life of the chamber; billing records for 6 years.                             | Done   |

**On direction (iv).** Meeting it means shipping application logs to a store in
an Indian region and keeping 180 days of them. It is a day of work and a small
running cost. It is listed as Owner rather than Done because nobody has done it,
and writing "we retain logs in India" anywhere before it is true would be the
exact failure this register exists to prevent.

## 3. Consumer Protection (E-Commerce) Rules 2020

A paid self-service platform is an e-commerce entity. Rule 4 requires certain
things to be displayed and certain response times met.

| Requirement                                              | Where it stands                                                               | Status  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| Legal name of the entity                                 | "Anshuman Chauhan, sole proprietor trading as LEX Practice", Terms §1.        | Done    |
| Address of the principal place of business               | `[PLACE OF BUSINESS]` — item 0.4.                                             | Owner   |
| Contact details, including email                         | Terms §14, one address, with what to put in the subject line.                 | Done    |
| Grievance officer's name and contact                     | Anshuman Chauhan, published in all four documents.                            | Done    |
| Acknowledge a complaint within 48 hours                  | Committed in Terms §14 and the Privacy Policy.                                | Done    |
| Redress within one month                                 | Committed as 30 days.                                                         | Done    |
| No unfair trade practice in the description of the offer | The plan screen is the price list, and it now offers only what can be bought. | Done    |
| Published cancellation and refund policy                 | Terms §6 — 7-day full refund on the trial pack if no matter has been opened.  | Counsel |

**The 7-day refund window is a number I chose, not one you decided.** It is
there because a published refund policy is required both by these rules and by
Razorpay before a live account is activated, and because leaving it absent was
the worse option. Change it if it is wrong for you; it is one paragraph.

## 4. Security safeguards, as actually implemented

Claimed in Privacy Policy "How it is protected" and DPA §4. Each is verifiable:

| Measure                                                     | Where                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Documents encrypted at rest, AES-256-GCM, per-file IV       | Production refuses to start without `FILE_ENCRYPTION_KEY`.               |
| Authorisation re-derived from the database on every request | `requireWorkspace`; a revoked member loses access on their next request. |
| Capability matrix, roles never self-selected                | `lib/permissions.ts`, the authoritative list.                            |
| Row scope on top of capability                              | `visibleCaseIds` / `getVisibleCase` — case-access grants are honoured.   |
| Tenant isolation verified on every change                   | `scripts/ci/suites/security.mjs`.                                        |
| Documents unreachable except through an authorisation check | No path-addressable URL.                                                 |
| Append-only audit log                                       | `audit_events`; nothing in the API updates or deletes a row.             |
| IP addresses truncated before storage                       | `truncateIp()` — /24 for IPv4, /48 for IPv6.                             |
| Identity provider never trusted for roles                   | Clerk `publicMetadata` is never read. `.agents/memory/`.                 |
| TLS throughout, HSTS                                        | `app.ts`.                                                                |

**Not implemented, and claimed nowhere:** backups (0.2), durable file storage
(0.3), 180-day Indian log retention (§2), a penetration test by a third party,
and any certification. Do not let a sales conversation imply otherwise.

## 5. Tax, registration and the money

| Item                                                                                                                              | Status  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| GST registration — the ₹20 lakh services threshold is a long way off at ₹99 a chamber                                             | Owner   |
| Terms §6 now says GST is added only if and when we are registered, and cannot be claimed until                                    | Done    |
| Invoices to chambers must carry the GSTIN once registered                                                                         | Owner   |
| Billing records retained 6 years, per the Income-tax Act and §36 CGST                                                             | Done    |
| Udyam registration, and Shops & Establishments where the State requires it                                                        | Owner   |
| A current account in the business name, which Razorpay settlement will want                                                       | Owner   |
| Razorpay activation needs published terms, privacy policy, refund policy and contact — all now exist and are served at `/legal/*` | Done    |
| Income from the platform is proprietorship business income, taxed at slab rates                                                   | Counsel |

## 6. Breach response — the one duty with no code behind it

Three clocks start at the same moment and none of them is long:

1. **6 hours** — report to CERT-In, if it is a listed cyber incident.
2. **Without delay** — tell affected persons and the Data Protection Board;
   **72 hours** for the detailed report.
3. **48 hours** — tell every affected chamber, per DPA §3, so it can meet its
   own 72-hour duty as Fiduciary.

None of this is automated and none of it should be improvised at the time. What
is needed is a one-page runbook naming who is called, what is captured before
anything is restarted, where the audit log is read from, and the CERT-In
reporting address — written now, while nothing is on fire. **It does not exist
yet.**

## 7. Bar Council of India, and the professional line

We are not advocates and the BCI does not regulate us. It regulates our
customers, and two consequences reach the product:

- **Rule 36 restricts advertising and solicitation by advocates.** Nothing we
  publish may read as touting work on a chamber's behalf, and no feature should
  turn the client portal into a channel for a chamber to advertise to people who
  are not already its clients. Nothing in the product does today.
- **Privilege is the chamber's, not ours, and we cannot assert it.** If we are
  compelled to produce data we hold, the privilege belongs to the chamber's
  client. Our undertaking is to tell the chamber where we are permitted to, so
  it can assert it — Privacy Policy, "Who else touches the data". A chamber's
  counsel will ask about this; the honest answer is that our contractual
  confidentiality is strong and our legal standing to resist is weak.

The Terms already refuse to give professional advice, and say plainly that
conflict screening is an aid rather than a clearance and that deadline reminders
are not a diary system. Those two sentences are the most load-bearing in the
document. Do not soften them in marketing copy.

## 8. Keeping this register honest

The rule from `README.md` applies here hardest: **a document describing
behaviour the code does not have is a written admission.** When the database
moves to a plan with backups, four things change together — Privacy Policy
"Retention", DPA §4 and §7, item 0.2 here, and `DEPLOYMENT.md`. When logs move
to India, §2 changes. When an email provider is engaged, two subprocessor tables
and a note in each change.

Review this file when any of those move, and in any case every six months.
