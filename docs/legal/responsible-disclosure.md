# Responsible Disclosure Policy

**LEX Practice**

Last updated: 25 September 2026 · Version 1.0

> **Draft pending review by counsel.** No placeholders remain. See
> `docs/legal/README.md`.

## Why this page exists

A chamber's security reviewer looking for a way to report a flaw should find a
policy, not a prohibition. §5 of the [Terms](/legal/terms) forbids probing the
Service "outside this policy" — **this is the written permission that §5 refers
to**, and it is standing. You do not need to ask for it, and you do not need to
tell us before you start.

We hold privileged legal material belonging to other people's clients. A flaw
found by a researcher who tells us is the cheapest outcome available to
everybody in that sentence.

## Where to send it

**anshumanchauhan0661@gmail.com**, with **SECURITY** at the front of the subject
line.

One person reads that address — Anshuman Chauhan, the proprietor. There is no
triage team and no ticketing system between you and him, which means a real
answer rather than an automated one, and it also means we ask for a little
patience over a weekend.

If a report is sensitive enough that plain email is the wrong channel, say so in
a message with no detail in it and we will arrange something else before you
send the substance.

## What we promise you

**Safe harbour.** For research that stays inside the scope below, and that is
reported to us rather than to anyone else first:

- **We will not bring or support legal action against you** for the research
  itself, including under the Information Technology Act 2000 §43 or §66, and we
  will not treat it as a breach of §5 of the Terms.
- **We will not report you to law enforcement** or to your employer for it.
- **If a third party brings action against you** over research we had authorised
  under this policy, we will say so, in writing, to them and to a court.

This safe harbour is ours to give and covers only our systems and our claims.
**It cannot cover our providers.** Render, Clerk, Razorpay, Cloudflare and
Anthropic each have their own programmes and their own rules, and testing their
infrastructure is between you and them.

**What we will do, and when.**

| Stage                                   | When                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| We acknowledge your report              | **2 working days**                                                                                      |
| We tell you whether we can reproduce it | **7 days**                                                                                              |
| We tell you our fix plan and a date     | With the triage outcome                                                                                 |
| We fix it                               | Critical: **7 days**. High: **30 days**. Everything else: next release cycle, and we will tell you when |
| We tell you it is fixed                 | Same day it ships                                                                                       |

If we disagree that something is a vulnerability, we will say so and say why,
rather than going quiet. Going quiet is the thing that makes researchers publish.

**Credit.** We will name you in the fix note if you want to be named, and not if
you do not. Ask either way; we will not assume.

**We do not pay bounties.** This is a one-person proprietorship on a ₹99 pack.
Saying so on the page is fairer than letting you find out after the work.

## Scope

**In scope**

- `lexpractice.co` and any subdomain of it, and `lex-practice.onrender.com`.
- The API under `/api`, the legal documents under `/legal`, and the single-page
  application served from the same origin.
- The source repository, if you can reach it.

**Out of scope — and please genuinely do not**

- **Anything touching a real chamber's data.** This is the one that matters. If
  a proof of concept requires reading somebody's matter, stop at the point you
  know it would work and tell us that. A description of the step you did not
  take is worth as much to us and costs a chamber nothing.
- **Denial of service, load testing, or anything that degrades the Service for
  others.** One instance serves everybody.
- **Social engineering, phishing, or physical access** — of us, of a chamber, or
  of any provider's staff.
- **Our providers' own infrastructure.** Report those to them.
- **Spam and automated scanning that generates volume** rather than findings.

**Reports we will read and close without a fix**, because they are known,
documented, or not defects:

- Missing security headers with no demonstrated exploit, including the
  Content-Security-Policy, which is a known and tracked gap.
- The absence of rate limiting on an endpoint that is not an authentication
  endpoint.
- Software version disclosure, banner grabbing, and the output of an automated
  scanner pasted without analysis.
- Email deliverability findings — SPF, DKIM, DMARC — on a deployment that sends
  no email, because no email provider is engaged.
- Self-XSS, clickjacking on a page with no state-changing action, and anything
  requiring a user to have already installed malware.
- The two things we already publish as unresolved: uploaded documents are not on
  durable storage, and the database takes no automated backups. Both are in the
  [Privacy Policy](/legal/privacy) and both are being fixed.

## How to write it up

We do not need a template. We do need, somewhere in the message:

1. **What you did**, precisely enough that we can do it again.
2. **What you saw** that you should not have.
3. **Which account and chamber you used.** Create your own; do not use someone
   else's.
4. **When**, with a timezone, so we can find it in the logs.

If you tested against a preview build rather than production, say so — preview
mode mocks authentication deliberately, so a finding there may not be a finding
at all.

## Disclosure

We ask for **90 days** from acknowledgement before you publish, or until the fix
ships, whichever is sooner. If we are slower than that on something serious,
tell us and we will agree a date rather than argue about one; a fix that is late
is our failure and not a reason to silence you.

Where a flaw amounts to a personal data breach, we have duties of our own that
are shorter than any of this — notification without delay, a report to the Data
Protection Board within 72 hours, and where CERT-In's Directions apply, six
hours. Your report may start those clocks, which is another reason we want it
early.

## Contact

| For              | Contact                                           |
| ---------------- | ------------------------------------------------- |
| Security reports | anshumanchauhan0661@gmail.com, subject "SECURITY" |
| Everything else  | See [Terms §14](/legal/terms)                     |
