# Privacy Policy

**LEX Practice**

Last updated: [DATE] · Version 1.0

> **Draft pending review by counsel.** Placeholders in square brackets must be
> completed before publication. See `docs/legal/README.md`.

## Who we are

**[LEGAL ENTITY NAME]** ([CIN]), [REGISTERED ADDRESS], operates LEX Practice.

This policy explains what we do with personal data. It is written to describe
**what the software actually does**, not what a template says it might.

## Two different roles, and why it matters

This is the most important thing on the page.

- **For your chamber's own account data** — the people you invite, their names
  and email addresses, sign-in records, billing details — **we are the Data
  Fiduciary** under the Digital Personal Data Protection Act 2023. This policy
  governs it.
- **For the content inside your chamber** — matters, client names, opposing
  parties, uploaded documents — **your chamber is the Data Fiduciary and we are
  a Data Processor.** We hold that material on your instructions and do not
  decide what happens to it. If you are a client of a chamber and want your
  matter data corrected or removed, **ask that chamber**, not us. Our
  obligations to them are in the [Data Processing Agreement](/legal/dpa).

## What we collect, and why

### Account data (we are the Fiduciary)

| Data                                              | Why                                         | Kept for                                    |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Name, email address, authentication provider      | To identify you and admit you to a chamber  | Life of the account                         |
| Mobile number, where you sign in by SMS           | To identify you and admit you to a chamber  | Life of the account                         |
| Chamber name, your role, membership status        | To decide what you may see and do           | Life of the account                         |
| Sign-in events                                    | Security, and answering "who accessed this" | [12] months                                 |
| Audit records of privileged actions               | Accountability within the chamber           | [24] months                                 |
| Truncated IP address                              | Detecting abuse and account compromise      | With the record it belongs to               |
| Subscription plan, billing period, amount, status | Providing and charging for the Service      | Life of the account, then [8] years for tax |
| Support correspondence                            | Answering you                               | [24] months                                 |

**We truncate IP addresses before storing them.** An IPv4 address keeps three
octets (`203.0.113.x`); an IPv6 address keeps its /48. That is enough to notice
an anomaly and not enough to be a record of where you were.

**We do not store card details.** Payments go directly to our processor.

**If you sign in by mobile number**, we store that number and it is what admits
you to a chamber, in place of an address. Two consequences worth stating
plainly. Your number is disclosed to our authentication provider, which sends
the one-time code by SMS; standard message charges from your operator apply. And
because Indian operators reassign a disconnected number after around ninety
days, a chamber that has admitted a number and not revoked it could later admit
whoever receives that number next — tell your chamber admin when you change
numbers, and ask them to remove the old one.

### Chamber content (your chamber is the Fiduciary)

Matters, parties, tasks, calendar entries, documents, client feedback and
messages. We store and secure it. We do not decide what goes in it.

### What we do not do

- We do not sell personal data. There is no circumstance in which we would.
- We do not use chamber content to train machine-learning models.
- We do not advertise to your clients, and we do not contact them except where
  the Service sends a notification your chamber asked it to send.
- We do not load fonts, analytics, advertising or tracking scripts from third
  parties. The one third-party script the application loads is our
  authentication provider's, which is required to sign you in and which is
  listed as a subprocessor above — signing in therefore discloses your IP
  address to that provider, and to nobody else.

## Legal basis

Under the DPDP Act 2023 we process your account data because it is **necessary
to perform the contract** you have with us, and for the **legitimate uses** the
Act permits — security, fraud prevention, and complying with law. Where we rely
on consent we ask for it separately and you can withdraw it as easily as you
gave it.

## Who else touches the data

Only the providers needed to run the Service. Each is bound by contract, and
each processes only what its function requires:

| Provider                           | What for                            | Where                |
| ---------------------------------- | ----------------------------------- | -------------------- |
| Render Services, Inc.              | Running the application             | Singapore            |
| Render Services, Inc.              | The database                        | Singapore            |
| Clerk, Inc.                        | Sign-in and identity                | [CONFIRM WITH CLERK] |
| Razorpay Software Private Limited  | Taking payment                      | India                |
| [NOT YET ENGAGED — see note below] | Sending notifications and reminders | —                    |

No email provider is engaged at present: `SMTP_HOST` is unset, so reminders and
notices are recorded in the application and not sent by email. This row must be
completed before that changes.

The current list is maintained in `docs/legal/data-processing-agreement.md`.

We may disclose data where compelled by a court or by law. Where we are
permitted to tell you, we will.

**Transfers outside India.** [Complete this. State the countries, and note that
the Central Government may restrict transfers to specified territories under
s.16 of the DPDP Act.]

## How it is protected

Not aspirations — these are implemented and tested:

- **Uploaded documents are encrypted at rest** with AES-256-GCM, a separate
  random initialisation vector per file, and authentication so a modified file
  fails to open rather than returning altered content. The server refuses to
  start in production without an encryption key configured.
- **Every request re-checks authorisation against the database.** Membership is
  the only source of truth; revoking someone takes effect on their next request,
  not when a token happens to expire.
- **Chambers are isolated from each other** at every read, and this is verified
  by an automated suite on every change.
- **Documents can only be reached through an authorisation check.** There is no
  URL that serves a file by path.
- **Every privileged action is written to an append-only audit log** that
  nothing in the application can edit or delete.
- Transport is TLS throughout. Access to production is limited to staff who need
  it, and is logged.

No system is perfectly secure, and we will not claim otherwise.

## Your rights

Under the DPDP Act 2023 you may:

- **Ask what we hold about you** and how it is being processed.
- **Have it corrected** if it is wrong, or completed if it is partial.
- **Ask for erasure** where we no longer need it for the purpose it was
  collected for or to meet a legal obligation.
- **Nominate** someone to exercise these rights if you die or become incapable.
- **Complain** — to us first, then to the Data Protection Board of India.

**How to exercise them:** email **[PRIVACY EMAIL]**. We respond within [30]
days. We may need to verify your identity first, which is a protection for you.

**One limit, stated plainly.** Where erasure would remove a record a chamber
must retain — a matter file, an entry in the audit trail — we cannot delete it.
We **anonymise** instead: the account is renamed, the email address blanked,
access revoked everywhere, and the person's name redacted from the audit log.
The professional record survives; the link between it and you does not. If you
are asking about content inside a chamber, that chamber decides, and we act on
its instruction.

## Retention

We keep account data for as long as the account exists, then for the periods in
the table above. Chamber content is kept until the chamber deletes it or for
**[60] days** after the subscription ends, whichever comes first — see §9 of the
[Terms](/legal/terms).

Backups are retained for [30] days and overwritten on a rolling cycle. Data
deleted from the live system persists in backups until they age out.

## Children

The Service is for legal professionals and their clients. It is not directed at
children, and we do not knowingly collect a child's personal data. Where a
matter involves a minor, that data is chamber content and the chamber's
responsibility as Fiduciary.

## Breach

If a breach is likely to affect you, we will notify you and the Data Protection
Board of India as the Act requires, without undue delay. We will tell you what
happened, what it means for you, and what we are doing.

## Changes

We will post changes here with a new date, and email you before anything
material takes effect.

## Contact

| For                          | Contact                  |
| ---------------------------- | ------------------------ |
| Privacy questions and rights | [PRIVACY EMAIL]          |
| **Grievance Officer** (DPDP) | [NAME], [EMAIL], [PHONE] |
| Postal                       | [REGISTERED ADDRESS]     |

You may also complain to the **Data Protection Board of India**.
