# Legal documents

Six documents, served to users at `/legal/<slug>` by the API server, and two
that are for you rather than for them:

| File                           | Slug         | Who it binds                                       |
| ------------------------------ | ------------ | -------------------------------------------------- |
| `terms-of-service.md`          | `terms`      | You and the chamber that subscribes                |
| `privacy-policy.md`            | `privacy`    | You and every individual whose data you hold       |
| `dpdp-notice.md`               | `notice`     | Shown at the point personal data is collected      |
| `data-processing-agreement.md` | `dpa`        | You as Data Processor, the chamber as Fiduciary    |
| `data-usage-summary.md`        | `summary`    | **Binds nobody.** One page a partner reads first   |
| `responsible-disclosure.md`    | `disclosure` | You and a security researcher — a standing licence |
| `compliance-register.md`       | —            | Not served. What you owe, and whether you do it    |
| `breach-runbook.md`            | —            | Not served. What to do in the first hour           |

**The summary is deliberately not binding**, and says so at the top. Four
documents is the right amount of detail and the wrong amount to read before
deciding, so the summary exists to be read instead — and then to point at the
one that governs. If it ever contradicts them, it is the summary that is wrong.

**The disclosure policy is the permission Terms §5 refers to.** §5 used to
forbid probing "without our written permission" with a parenthetical aside
telling you to get in touch, which is a prohibition wearing a policy's clothes:
a chamber's security reviewer reads the prohibition and stops. It now points at
`/legal/disclosure`, which grants standing permission, sets a safe harbour, and
draws the line in the same words §5 uses — so the two cannot drift apart.

**Start with `compliance-register.md`.** Its §0 lists four things that outrank
everything else, three of which are about to cost you data rather than a fine.

**`breach-runbook.md` is the one to have read _before_ you need it.** Three
statutory clocks start the moment you become aware of an incident, and the
shortest is six hours.

## What is filled in

The entity is a **sole proprietorship**: Anshuman Chauhan, trading as LEX
Practice. There is no CIN and the documents no longer imply one. The
**Grievance Officer is Anshuman Chauhan**, published in all four documents with
`anshumanchauhan0661@gmail.com`, which is also the single address for support,
privacy and security — a proprietorship publishing four addresses to one inbox
would be pretending to be a support organisation, so the Terms say so instead.

Subprocessor tables are complete: Render for hosting and the database, both in
**Singapore**; Razorpay in India; Clerk and **Anthropic** in the United States.
"Transfers outside India" now itemises what goes where rather than asking to be
completed.

**Anthropic was missing entirely and has been added.** AI drafting sends matter
facts and document text to a third country, and a privacy policy that did not
mention it was the largest inaccuracy in this directory. Both tables now carry
it, with the off-by-default behaviour and the audit record described.

**No placeholders remain.** The principal place of business is
**Sector I, Jankipuram, Lucknow, Uttar Pradesh**, filled in on 24 September 2026
across the Terms and the Privacy Policy. It also fixed the governing-law seat:
Terms §13 now names the courts at **Lucknow, Uttar Pradesh**, and the address
the e-commerce rules require you to display is now displayed.

The email provider row stays `[NOT YET ENGAGED]` deliberately: `SMTP_HOST` is
unset, so reminders and erasure notices are recorded and not sent. Fill it in
when that changes, not before.

**Added 25 September 2026**, all four requested and all four describing the
system as it is rather than as it should be:

- **Cookies and browser storage** (Privacy Policy). Nothing anywhere disclosed
  them. There is no cookie banner and the section explains why there is nothing
  for one to ask: every cookie is Clerk's and strictly necessary, the API sets
  none at all, and the five browser-storage keys are named with what each holds
  and when it clears. `portal:workspaceToken` gets a paragraph of its own
  because it looks like a key and is a signed pointer.
- **Court cause lists** (Privacy Policy, and a register row). The one category
  of personal data here that belongs to people who never agreed to anything —
  parties and opposing counsel in a published list. Written before the parser
  lands rather than after, with the §3(c)(ii) and §17(1) basis recorded so it
  can be argued with. It also admits that nothing prunes fetched listings.
- **A service level** (Terms §8). A 99% target, the maintenance window, the
  exclusions, and the three facts a chamber will otherwise discover by itself:
  one instance, a plan that sleeps when idle, and documents that do not survive
  a restart.
- **Document durability** (Privacy Policy, DPA §4, summary). `R2_*` is confirmed
  unset on the Render service, so uploaded files are lost on every deploy. It is
  now disclosed the way the backup gap already was. Disclosure is not the fix.

**Terms §8 and §11 now point in opposite directions on purpose.** §8 tells a
chamber the deployment is one instance with no backups; §11 caps our liability
at the fees paid. Counsel should read those two together, because a chamber's
professional indemnity insurer will.

## What was corrected, and why it matters

Four statements were true of a template and false of this system. They were
changed rather than left, because the rule at the bottom of this file cuts both
ways:

- **"Backups are retained for 30 days"** and **"automated backups with
  point-in-time recovery; restores tested"**. The database is a Render `free`
  instance: no backups, no PITR, and it **expires on 9 September 2026**. Both
  documents now state the absence plainly and say what will change when it is
  fixed.
- **"Sign-in events — kept 12 months."** There is no such table. Clerk holds
  sign-in records; we hold the audit trail of what was done afterwards. The row
  was replaced with the truth.
- **"Audit records — 24 months."** Nothing deletes them, by design — the table
  is append-only, which is what makes it evidence. It now says life of the
  chamber, and explains why.
- **"8 years for tax."** Six is what the Income-tax Act and §36 CGST require of
  a proprietorship. Keeping personal data two years past its purpose is the
  thing the DPDP Act objects to, so the longer figure was not the safer one.

Deletion at the end of the 60-day export window is done by hand; no scheduled
job performs it. Both documents now say so rather than describing an automation
that does not exist.

## Numbers I chose, which are yours to change

- **7 days, full refund on the trial pack** if no matter has been opened
  (Terms §6). A published refund policy is required by the e-commerce rules and
  by Razorpay before it activates a live account, so its absence was not a
  neutral option. The window is a commercial decision and one paragraph to edit.
- **48 hours to acknowledge, 30 days to answer** a grievance. The e-commerce
  rules set the outer limits; these are inside them and achievable by one
  person.

## Read this before you publish them

**These are drafts, not advice.** They were written to be a competent starting
point that reflects what this codebase actually does — the retention periods,
the encryption, the subprocessors and the erasure behaviour are all taken from
the implementation rather than from a template. That makes them accurate about
the product. It does not make them sufficient for your business.

**A qualified lawyer must review them before you accept a single rupee.** In
particular:

- The place of business is now filled in, and with it the governing-law seat
  in Terms §13 — the courts at Lucknow. Confirm that is the forum you want;
  it follows from §1 rather than having been chosen separately.
- The limitation-of-liability and indemnity clauses are the ones your counsel
  will most want to change. The numbers in them are placeholders chosen to be
  obviously provisional, not commercially negotiated positions.
- The DPDP Act 2023 is in force but its Rules continue to be operationalised.
  Consent-manager registration, breach-notification timing and the significant-
  Data-Fiduciary thresholds are the parts most likely to have moved since these
  were written. Check the current position.
- Advocates are separately bound by the Bar Council of India rules and by
  professional privilege. A chamber's obligations to its own clients are not
  something your terms can waive on their behalf.

## Keeping them honest

The documents describe the system as built. If you change what the system does,
change these too — a privacy policy that describes a retention period the code
does not implement is worse than no policy, because it is a written admission.

Specific couplings to watch:

- **Encryption at rest** (`privacy-policy.md`, `dpa.md`) — true only while
  `FILE_ENCRYPTION_KEY` is set. It is required in production; do not remove that
  guard without editing the documents.
- **Erasure anonymises rather than deletes** (`privacy-policy.md`) — matches
  `POST /privacy/erasure` and the retention argument for matter records.
- **Truncated IP addresses** (`privacy-policy.md`) — matches `truncateIp()`.
- **Subprocessor list** (`dpa.md`) — matches what the deployment actually uses.
  Adding a service means adding a row and giving notice.
- **AI drafting off by default** (`privacy-policy.md`, `dpa.md` §5) — matches
  `workspaces.drafting_enabled`, and the audit actions `drafting.enabled` and
  `drafting.generated` are the consent record the documents point to. If
  drafting ever becomes on-by-default, both documents are wrong that day.
- **No backups** (`privacy-policy.md` "Retention", `dpa.md` §4 and §7,
  `data-usage-summary.md`) — matches a Render `free` Postgres plan. Moving to a
  paid plan makes four paragraphs and `compliance-register.md` item 0.2 wrong at
  once. Change them together.
- **Documents are not on durable storage** (`privacy-policy.md` "Retention",
  `dpa.md` §4, `terms-of-service.md` §8, `data-usage-summary.md`,
  `responsible-disclosure.md` out-of-scope) — matches `R2_*` being unset.
  Setting those four variables makes five passages wrong the same afternoon.
- **The service level** (`terms-of-service.md` §8, `data-usage-summary.md`) —
  matches one instance on Render's `free` web-service plan, which sleeps. Both
  say the first request after an idle period is slow; neither is true once the
  service moves off that plan.
- **Cause-list sync is off** (`privacy-policy.md` "Court cause lists") — matches
  `CAUSE_LIST_SYNC` being unset. Turning it on makes the policy's opening claim
  false that day.
- **Cookie and storage names** (`privacy-policy.md`) — match `portal:theme`,
  `portal:accessRequestIntent`, `portal:activeWorkspaceId`,
  `portal:workspaceToken`, `lex.signin.pending-code` and Clerk's own cookies.
  Renaming a key, or adding one, means editing that table.
- **The sign-in notice** (`dpdp-notice.md`) — matches the paragraph beneath the
  submit control in `pages/portal-sign-in.tsx`. Removing it breaks the §5 claim.
