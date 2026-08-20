# Legal documents

Four documents, served to users at `/legal/<slug>` by the API server:

| File                           | Slug      | Who it binds                                    |
| ------------------------------ | --------- | ----------------------------------------------- |
| `terms-of-service.md`          | `terms`   | You and the chamber that subscribes             |
| `privacy-policy.md`            | `privacy` | You and every individual whose data you hold    |
| `dpdp-notice.md`               | `notice`  | Shown at the point personal data is collected   |
| `data-processing-agreement.md` | `dpa`     | You as Data Processor, the chamber as Fiduciary |

## What has already been filled in

The subprocessor tables in `privacy-policy.md` and
`data-processing-agreement.md` are complete, because they are facts about the
deployment rather than decisions: hosting and the database are Render Services,
Inc., both in Render's **Singapore** region (verified against the live service
and Postgres instance), payment is Razorpay, and identity is Clerk.

Two cells in those tables are deliberately still open:

- **Clerk's location.** Clerk's data residency depends on the instance tier and
  is not something to state from memory in a privacy policy. Confirm it with
  Clerk and fill it in — it also determines what the "Transfers outside India"
  paragraph has to say.
- **The email provider.** None is engaged: `SMTP_HOST` is unset, so reminders
  and erasure notices are recorded and not sent. Fill the row in when that
  changes; do not fill it in before.

Everything still bracketed is a decision only you can make: the entity name and
CIN, the registered office, the governing-law seat, the Grievance Officer's
name and contact details, the four contact addresses, and the retention and
notice periods shown as `[30]`, `[12]`, `[24]` and `[8]`.

## Read this before you publish them

**These are drafts, not advice.** They were written to be a competent starting
point that reflects what this codebase actually does — the retention periods,
the encryption, the subprocessors and the erasure behaviour are all taken from
the implementation rather than from a template. That makes them accurate about
the product. It does not make them sufficient for your business.

**A qualified lawyer must review them before you accept a single rupee.** In
particular:

- Every `[SQUARE BRACKET]` is a placeholder you must fill in. The documents will
  not make sense until you do, and some of them (the entity name, the grievance
  officer, the governing-law seat) have legal consequence.
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
