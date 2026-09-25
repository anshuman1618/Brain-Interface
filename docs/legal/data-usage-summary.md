# Data Usage Summary

**LEX Practice**

Last updated: 25 September 2026 · Version 1.0

> **This page is a guide, not the agreement.** It summarises the
> [Terms](/legal/terms), the [Privacy Policy](/legal/privacy), the
> [Data Protection Notice](/legal/notice) and the
> [Data Processing Agreement](/legal/dpa) in one place, for a partner deciding
> whether to put a chamber's matters into this Service. Where it and they
> differ, **they** govern. Nothing here is a term of the contract.

---

## In one paragraph

LEX Practice holds your chamber's matters, documents, time and billing on a
server in Singapore, run by one person in Lucknow. **Your content is yours**; we
hold it as your processor, we do not read it except to operate or repair the
Service, we do not train models on it, and we do not sell anything to anybody.
**Two gaps are real and we publish them rather than bury them:** uploaded
documents are not yet on durable storage and can be lost on a restart, and the
database takes no automated backups. Both are being fixed; neither should be
discovered after you have moved a practice across.

---

## Who holds what, and who answers for it

This is the distinction everything else follows from.

|                                | Your chamber's account data                                                     | The content inside your chamber                                        |
| ------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| What                           | Who you invited, their names and addresses, roles, what they did, what you paid | Matters, parties, documents, notes, tasks, calendar, feedback          |
| Who decides what happens to it | **We do** — we are the Data Fiduciary                                           | **You do** — your chamber is the Data Fiduciary; we are your Processor |
| Who a client asks              | Us                                                                              | **Your chamber.** We act on your instruction, not on theirs            |
| Governed by                    | [Privacy Policy](/legal/privacy)                                                | [DPA](/legal/dpa), and your own obligations to your clients            |

If a client of yours asks us to delete their matter, we will tell them to ask
you. That is not evasion; it is the only answer consistent with you being the
Fiduciary for it.

---

## What leaves our systems, and what never does

| Goes to                       | What                                                                                                 | Why                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Clerk** (United States)     | Your name, sign-in identifier and IP address                                                         | To sign you in. **No chamber content.**       |
| **Razorpay** (India)          | Payment details, which we never see                                                                  | To take payment                               |
| **Render** (Singapore)        | Everything — this is where the Service runs                                                          | Hosting and the database                      |
| **Anthropic** (United States) | Matter facts and document text, **only if your chamber switches AI drafting on**                     | To produce a draft. Not used to train models. |
| **Nobody**                    | Your documents, your clients' names, your matters — to any advertiser, data broker, or model trainer | —                                             |

**AI drafting is off until an administrator of your chamber turns it on.**
Switching it on is written to the audit trail, and so is every draft produced
afterwards, so "what of my client's was sent, and who authorised it" has an
answer. If your professional obligations do not permit it — and for some matters
they will not — leave it off. That decision is yours, matter by matter, and the
Service will not make it for you.

---

## What is actually protected, and how

Implemented and tested, not aspirations:

- **Documents are encrypted at rest** (AES-256-GCM, a fresh IV per file, and
  authentication, so a tampered file fails to open rather than opening wrong).
  Production refuses to start without the key.
- **Every request re-checks your membership against the database.** Revoking
  someone takes effect on their next request, not when a token expires.
- **Chambers cannot see each other**, and an automated suite proves it on every
  change.
- **No document has a URL you can guess.** There is no path that serves a file
  without an authorisation check.
- **Every privileged action is written to an append-only log** that nothing in
  the application can edit or delete.
- **Roles come from our database, never from the identity provider.** Nothing
  Clerk holds can grant anybody a role here.

---

## The four things to know before you decide

**1. Uploaded documents can be lost.** They are written to the application
server's own filesystem, which does not survive a deploy or a restart. Object
storage is configured and waiting on four settings. Until then, keep your own
copy of anything you could not reproduce. _(This one is the reason this page is
worth reading.)_

**2. There are no database backups.** The plan the database runs on takes none
and offers no point-in-time recovery. Deleting something deletes it.

**3. One instance, one person.** No second server, no on-call rota, no status
page. The application sleeps when idle, so the first request after a quiet
period takes about a minute. Support is one address, answered in Indian business
hours. See [Terms §8](/legal/terms).

**4. Liability is capped at what you paid us.** On the ₹99 trial pack, that is
₹99. Read that against what you are about to store, and read
[Terms §11](/legal/terms), which says the same thing at more length and flags it
for your own counsel.

None of these four are secrets we would rather you missed. They are the
difference between a tool you can evaluate and one you find out about.

---

## How long we keep things

| What                            | For how long                                                            |
| ------------------------------- | ----------------------------------------------------------------------- |
| Your account                    | While the account exists                                                |
| Billing records                 | 6 years, which is what the Income-tax Act and §36 CGST require          |
| The audit trail                 | Life of the chamber. It is append-only — that is what makes it evidence |
| Chamber content after you leave | **60 days** to export, then deleted                                     |
| Court cause lists               | Indefinitely. Nothing prunes them, and we would rather say so           |
| Sign-in records                 | **We keep none.** Clerk holds those, under its own policy               |

Deletion at the end of the 60 days is done **by hand**, on request or on review.
No scheduled job performs it. If the date matters to you, ask, and we will
confirm in writing when it is done.

---

## What you can do yourself, today

- **Governance → Export my data** — everything this chamber holds about you, as
  a file you keep.
- **Governance → Request erasure** — puts the request in front of whoever in
  your chamber can decide it.
- Both are written to the audit trail.

**One limit, stated plainly.** Where erasure would remove a record a chamber
must retain, we **anonymise** instead: the account is renamed, the address
blanked, access revoked, the name redacted from the audit log. The professional
record survives; the link between it and the person does not.

---

## Who to write to

| For                                        | Contact                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Anything at all                            | anshumanchauhan0661@gmail.com                                                                 |
| Privacy and your rights under the DPDP Act | Same address, subject "PRIVACY"                                                               |
| A complaint about how we handled either    | Same address, subject "GRIEVANCE" — **Anshuman Chauhan is the Grievance Officer**             |
| A security flaw                            | Same address, subject "SECURITY" — see the [Responsible Disclosure Policy](/legal/disclosure) |

Acknowledged within 48 hours, answered within 30 days. If you are not satisfied,
you may complain to the **Data Protection Board of India**; you do not have to
come to us first, though it is usually faster.
