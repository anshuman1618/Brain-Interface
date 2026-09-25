# Privacy Policy

**LEX Practice**

Last updated: 28 August 2026 · Version 1.0

> **Draft pending review by counsel.** No placeholders remain. See
> `docs/legal/README.md`.

## Who we are

**Anshuman Chauhan**, a sole proprietor carrying on business in India as **LEX
Practice**, at Sector I, Jankipuram, Lucknow, Uttar Pradesh, operates this
Service. It is a proprietorship, not a company, and has no CIN.

This policy explains what we do with personal data. It is written to describe
**what the software actually does**, not what a template says it might.

## Two different roles, and why it matters

This is the most important thing on the page.

- **For your chamber's own account data** — the people you invite, their names
  and email addresses, what they did in the Service, billing details — **we are the Data
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

| Data                                              | Why                                        | Kept for                                      |
| ------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Name, email address, authentication provider      | To identify you and admit you to a chamber | Life of the account                           |
| Mobile number, where you sign in by SMS           | To identify you and admit you to a chamber | Life of the account                           |
| Chamber name, your role, membership status        | To decide what you may see and do          | Life of the account                           |
| Audit records of privileged actions               | Accountability within the chamber          | Life of the chamber — see below               |
| Truncated IP address                              | Detecting abuse and account compromise     | With the audit record it belongs to           |
| Subscription plan, billing period, amount, status | Providing and charging for the Service     | Life of the account, then 6 years for tax law |
| Support correspondence and feedback               | Answering you                              | Life of the chamber                           |

**We do not keep our own sign-in log.** Records of when and from where you
signed in are held by our authentication provider (below), under its retention
policy, not ours. What we keep is the audit trail of what was _done_ after
sign-in, which is a different record and a shorter one.

**The audit trail is kept for the life of the chamber, and we say so rather
than naming a shorter period.** It is append-only by design: nothing in the
application can edit or delete a row, which is the property that makes it
evidence at all. A chamber's accountability record is also the thing it needs
years later, when a client asks who saw a file. If you want it pruned on a
schedule, that is a change to the software and to this page together — ask.

**Six years, not eight, for billing records.** That is what the Income-tax Act
and §36 of the CGST Act require of a proprietorship, measured from the end of
the relevant year. We do not keep them longer to be safe; keeping personal data
past its purpose is itself the thing the DPDP Act objects to.

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

### Court cause lists — personal data about people who are not our users

A cause list is published by a court and names parties, and sometimes counsel,
who have never used this Service and never agreed to anything with us. That
deserves its own heading rather than a line in a table, because it is the one
category of personal data here that nobody in the relationship chose to give us.

**It is off unless it is switched on.** Cause-list synchronisation runs only
where `CAUSE_LIST_SYNC` is enabled on the deployment. It is not enabled today,
so no court list is being fetched at the date of this policy. The rest of this
section describes what happens when it is.

**The basis, written down rather than assumed.** §3(c)(ii) of the DPDP Act 2023
puts personal data outside the Act where the individual concerned has made it
publicly available, and §17(1)(b) and (d) exclude processing for the purposes of
a judicial function and for enforcing a legal right. A High Court's daily list
is published by the court under its own rules, and an advocate consulting it to
know when to appear is doing the thing the list exists for. We record that
reasoning here, and in the compliance register, so it can be argued with rather
than assumed.

What we do with it, precisely:

- **We fetch a published list; we do not crawl and we do not aggregate.**
  Retrieval is per court and per date.
- **A listing is stored as printed**, including the parties line and the raw
  text of the row. The raw text is kept deliberately: a cause list decides
  whether an advocate must be in a courtroom tomorrow, and when a parsed field
  and an advocate's memory disagree, somebody has to be able to read what the
  page actually said. Courts rarely keep an archive, so if we discard it, it is
  gone.
- **No profile is built about anybody.** Listings are stored as rows of a court's
  list, not as records about the people named in them. Nothing is enriched,
  cross-referenced between matters, or joined to anything outside the list.
- **A listing reaches a chamber only where it matches a matter that chamber
  already holds**, and then only as a proposal a person has to accept. The table
  of fetched listings is common to the Service and is not readable by any
  chamber; the table a chamber reads only ever names its own matters.
- **Nothing is published or sold onward.** The court's list stays the court's.

**Retention, stated accurately: nothing prunes it.** Fetched listings are kept
indefinitely, because no job deletes them and we would rather say so than
describe a schedule that does not exist. A person named in a court's list who
wants to know what we hold, or wants it removed, should write to the address
under "Your rights" — but note that the authoritative copy is the court's, not
ours, and removing our copy does not touch it.

### What we do not do

- We do not sell personal data. There is no circumstance in which we would.
- We do not use chamber content to train machine-learning models, and neither
  does the AI provider we send it to when a chamber switches drafting on. See
  "AI drafting" below for exactly what is sent and when.
- We do not advertise to your clients, and we do not contact them except where
  the Service sends a notification your chamber asked it to send.
- We do not load fonts, analytics, advertising or tracking scripts from third
  parties. The one third-party script the application loads is our
  authentication provider's, which is required to sign you in and which is
  listed as a subprocessor above — signing in therefore discloses your IP
  address to that provider, and to nobody else.

## Cookies, and what your browser keeps

**There is no cookie banner, and that is a statement about the software rather
than a convenience.** We set no analytics, advertising or tracking cookie,
because there is no analytics script, no advertising pixel and no third-party
font anywhere in the application to set one. Everything listed below is either
required to keep you signed in or a preference your own browser remembers. A
consent banner would have nothing to ask you about.

### Cookies

Every cookie is set by our authentication provider, Clerk, and exists to carry a
signed-in session. **Our own API sets no cookie at all** and reads none.

| Cookie              | What it does                                                                                                                         | Kind               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `__session`         | The signed session token each request is authenticated with. Without it you are signed out.                                          | Strictly necessary |
| `__client_uat`      | Records when your signed-in state last changed, so a page can tell a signed-out visitor from one whose token needs refreshing.       | Strictly necessary |
| `__clerk_handshake` | Transient. Written and cleared during the redirect that establishes a session.                                                       | Strictly necessary |
| `__clerk_db_jwt`    | Development and preview instances only. Carries the session where the production cookie cannot be used. Not set on the live Service. | Strictly necessary |

They are strictly necessary in the ordinary sense of the phrase: there is no
version of signing in that does not set them, and refusing them refuses access.
Their lifetimes are set by Clerk, not by us; signing out clears the session.
Clerk's own published list is the authoritative one and governs if the two ever
disagree.

### Local and session storage

Not cookies — these never leave your browser. Nothing here is sent with a
request, and none of it reaches us.

| Key                                                 | Store          | What it is for                                                                                               | Cleared                               |
| --------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `portal:theme`                                      | localStorage   | Light or dark.                                                                                               | When you clear site data              |
| `portal:accessRequestIntent`                        | localStorage   | Which role you chose before being asked to sign in, so the request form arrives filled in.                   | Once the request is submitted         |
| `portal:activeWorkspaceId`, `portal:workspaceToken` | sessionStorage | Which chamber this tab is looking at, and the token the server signed when it agreed to the switch.          | When the tab closes                   |
| `lex.signin.pending-code`                           | sessionStorage | Which address a one-time code went to, so refreshing the tab mid-sign-in does not strand you holding a code. | When the tab closes, or on signing in |
| `portal:previewSession`                             | localStorage   | Preview builds only. Never present on the live Service.                                                      | —                                     |

`portal:workspaceToken` is the one worth understanding, because it looks like a
key and is not one. It is a **pointer the server signed**, not a permission.
Editing it in developer tools achieves nothing: the API re-reads your membership
from its own database on every single request and answers 403 for a chamber you
are not an active member of.

**On a shared or public computer**, sign out — that clears the session cookies —
and close the tab, which clears the rest.

## Legal basis

Under the DPDP Act 2023 we process your account data because it is **necessary
to perform the contract** you have with us, and for the **legitimate uses** the
Act permits — security, fraud prevention, and complying with law. Where we rely
on consent we ask for it separately and you can withdraw it as easily as you
gave it.

## Who else touches the data

Only the providers needed to run the Service. Each is bound by contract, and
each processes only what its function requires:

| Provider                           | What for                            | Where         |
| ---------------------------------- | ----------------------------------- | ------------- |
| Render Services, Inc.              | Running the application             | Singapore     |
| Render Services, Inc.              | The database                        | Singapore     |
| Clerk, Inc.                        | Sign-in and identity                | United States |
| Razorpay Software Private Limited  | Taking payment                      | India         |
| Anthropic PBC                      | AI drafting — only if switched on   | United States |
| [NOT YET ENGAGED — see note below] | Sending notifications and reminders | —             |

No email provider is engaged at present: `SMTP_HOST` is unset, so reminders and
notices are recorded in the application and not sent by email. This row must be
completed before that changes.

### AI drafting, and what it sends where

This is the one part of the Service that sends chamber content to a third
party, so it is described in full rather than in a table row.

- **It is off unless your chamber turns it on.** A chamber administrator has to
  switch it on deliberately; a new chamber has it off. The moment of switching
  it on is written to the audit trail, and so is every draft generated
  afterwards — between them they answer "what of my client's was sent, and who
  authorised it".
- **When it is on and someone drafts**, the matter's own facts, the text of
  documents that person is already allowed to read, and any style exemplar the
  chamber uploaded are sent to **Anthropic PBC in the United States** to produce
  the draft. Only that matter's material is sent, and only material the person
  drafting could already open.
- **Anthropic does not train models on it.** It is processed to return the
  draft and is not used to improve any model.
- **A case brief may search the web.** Where it does, short queries derived from
  the matter — a case citation, a statutory provision, a party name where the
  matter is already public — are sent to a search provider through Anthropic.
  Documents are never sent to a search engine.
- **Switching it off stops all of this.** Drafts already produced stay in your
  chamber, because they are your work product.

If your chamber's professional obligations do not permit this — and for some
matters they will not — leave it off. The decision is the chamber's, matter by
matter, and the Service does not make it for you.

The current list is maintained in `docs/legal/data-processing-agreement.md`.

We may disclose data where compelled by a court or by law. Where we are
permitted to tell you, we will.

**Transfers outside India.** Your data leaves India, and you should know exactly
where it goes:

- **Singapore.** The application and the database run in Render's Singapore
  region. Everything your chamber puts into the Service is stored there.
- **United States.** Your name, your sign-in identifier and your IP address
  reach Clerk, Inc., which authenticates you. Chamber content does not.
- **India.** Payment details go to Razorpay and stay in India. We never see
  them.

Under §16 of the DPDP Act the Central Government may restrict transfers to
territories it specifies. None of the above is restricted at the date of this
policy. If that changes we will move the processing or tell you before it
continues.

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

**How to exercise them:** email **anshumanchauhan0661@gmail.com**. We
acknowledge within **48 hours** and answer within **30 days**. We may need to
verify your identity first, which is a protection for you.

If you hold an account, two of these are built into the Service and do not need
an email at all: **Governance → Export my data** returns everything this chamber
holds about you as a file you keep, and **Governance → Request erasure** puts
the request in front of the person in your chamber who can decide it. Both are
recorded in the audit trail.

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
**60 days** after the subscription ends, whichever comes first — see §9 of the
[Terms](/legal/terms).

Deletion at the end of that window is done by hand, on request or on review. No
scheduled job performs it, and we would rather say so than describe an
automation that does not exist.

**Uploaded documents are not yet on durable storage.** Files a chamber uploads
are written to the application server's own filesystem, not to an object store.
That filesystem does not survive a deploy or a restart, so **an uploaded
document can be lost**, and the encryption described above protects it against
being read rather than against being lost. The application warns about this at
every start. Object storage is configured and waiting on the four settings that
switch it on; when they are set, this paragraph goes and the Service keeps
documents as durably as it keeps everything else. Until then: keep your own copy
of anything you could not reproduce.

**Backups, stated accurately.** The database runs on a paid plan with
**continuous point-in-time recovery over a rolling 3-day window** — the figure
our host publishes for this plan tier. There are no separate nightly backup
files; point-in-time recovery replaced them, and a copy can be exported on
demand. This paragraph previously said there were no backups at all, which was
true of the plan the Service started on and stopped being true when the database
was upgraded on 17 September 2026. It understated the protection for eight days
and is corrected here.

**What that means for erasure, which is the part that affects you.** Data
deleted from the live system **remains inside the recovery window for up to
three days** before it ages out. We cannot reach into that window to remove one
person's record from it — nobody can; that is what makes it a recovery point
rather than a copy of the database. So when we tell you something has been
deleted, it has been deleted from the live system that day and is gone
completely within three. We would rather say that than let "deleted" carry an
absoluteness it does not have.

## Children

The Service is for legal professionals and their clients. It is not directed at
children, and we do not knowingly collect a child's personal data. Where a
matter involves a minor, that data is chamber content and the chamber's
responsibility as Fiduciary.

## Breach

If a breach is likely to affect you, we will notify you and the Data Protection
Board of India as the Act requires, without undue delay. We will tell you what
happened, what it means for you, and what we are doing.

Concretely, that means: **you and the Board are told without delay** on our
becoming aware, and the Board receives our detailed report — what happened, how
far it reached, who was affected, what we did — **within 72 hours**, or such
longer period as it allows. Where the incident is also a cyber security incident
reportable under the CERT-In Directions of 28 April 2022, we report it to
CERT-In **within 6 hours**. Chambers are told at the same time as we tell the
Board, not after.

## Changes

We will post changes here with a new date, and email you before anything
material takes effect.

## Contact

| For                          | Contact                                         |
| ---------------------------- | ----------------------------------------------- |
| Privacy questions and rights | anshumanchauhan0661@gmail.com                   |
| **Grievance Officer** (DPDP) | Anshuman Chauhan, anshumanchauhan0661@gmail.com |
| Postal                       | Sector I, Jankipuram, Lucknow, Uttar Pradesh    |

**Anshuman Chauhan is the Grievance Officer** for the purposes of §13(3) of the
DPDP Act 2023, and is the person to whom questions about this policy, requests
under "Your rights", and complaints about how either was handled should go. He
is the proprietor of LEX Practice, based in India, and answers in person — there
is no support desk between you and him.

If you are not satisfied with how we handle your grievance, you may complain to
the **Data Protection Board of India**. You do not have to exhaust our process
first, though telling us first usually resolves it faster.
