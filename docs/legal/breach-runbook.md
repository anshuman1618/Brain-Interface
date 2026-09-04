# Breach runbook

**LEX Practice** · Anshuman Chauhan, sole proprietor · 3 September 2026

Not served to users. This is the page you open when something has gone wrong
and the clocks have already started.

> **If you are reading this during an incident, go straight to §2.** The rest is
> here so that §2 is short.

---

## 0. The three clocks, and when they start

All three start at **the moment you become aware**, not when you finish
investigating, not when you are certain. "Aware" means you have a credible
report of unauthorised access — a security researcher's email, an alert you
cannot explain, a chamber saying they can see another chamber's matter.

| Clock        | To whom                                     | Basis                                             |
| ------------ | ------------------------------------------- | ------------------------------------------------- |
| **6 hours**  | CERT-In, if it is a listed incident         | CERT-In Directions, 28 April 2022, direction (ii) |
| **48 hours** | Every affected chamber                      | Our own DPA §3                                    |
| **72 hours** | Data Protection Board — the detailed report | DPDP Act 2023 §8(6) and the Rules                 |

Affected individuals are told **without undue delay** — in practice, at the same
time as the chambers, because the chamber is who they will ask.

**Six hours is the one that catches people out.** It is shorter than the time it
takes to work out what happened, which is deliberate: CERT-In wants to know
early and imprecisely, not late and completely. **Report on suspicion.** A
report that turns out to be nothing costs you an email. A late report is a
statutory breach in its own right, on top of whatever happened.

---

## 1. Before anything: preserve, then stop the bleeding

**In this order, and the order matters.**

1. **Do not restart the service.** Do not redeploy. Do not "just try
   something". The process's memory, its logs and the current database state are
   the evidence, and a restart destroys the first and rolls the second.
2. **Capture, in a file, with timestamps:**
   - the Render service logs for the window, exported before they age out;
   - `SELECT * FROM audit_events WHERE at > <window start> ORDER BY at;` — the
     append-only record of every privileged action, which is the single most
     useful artefact you have;
   - the deploy that was live (`git rev-parse HEAD` for the running commit) and
     when it went out;
   - anything the reporter forwarded to `ERROR_WEBHOOK_URL`.
3. **Only then** contain: revoke the credential, suspend the membership, take
   the service down if it is actively leaking. Containment that destroys
   evidence is worse than sixty more seconds of exposure in nearly every case —
   but not every one. If data is actively flowing out, stop it first and say in
   the report that you did.

**Where things are.** Render dashboard → service `lex-practice` → Logs. Database
is `dpg-d9t1dd2jobas738ac3g0-a` in Singapore. **There are no backups** (see the
compliance register §0.2), so there is no snapshot to compare against and no
restore point — which is why the capture step above is not optional.

---

## 2. The first hour

Work down this list. Do not skip ahead to writing the report.

- [ ] **Write down the time you became aware.** In writing, now. Every deadline
      is measured from it and you will not remember it accurately afterwards.
- [ ] **§1 capture and containment**, in that order.
- [ ] **Decide: is personal data involved?** If any chamber's matters, client
      details, documents or member accounts were reachable, yes. When unsure,
      assume yes.
- [ ] **Decide: is it a CERT-In listed incident?** Targeted scanning,
      unauthorised access to data, identity theft, compromise of an application
      or server, data breach or leak — all listed. When unsure, **report**.
- [ ] **Send the CERT-In report** — §3 has the template. Inside six hours.
- [ ] **Tell affected chambers** — §4 template. Inside forty-eight hours, and
      sooner is better, because they have their own seventy-two-hour duty as
      Data Fiduciary and it starts when you tell them.
- [ ] **Report to the Data Protection Board** — §5. Inside seventy-two hours.
- [ ] **Start the log** in §7 and keep it as you go, not afterwards.

---

## 3. CERT-In — within 6 hours

**incident@cert-in.org.in** · <https://www.cert-in.org.in> ·
+91-1800-11-4949. Their current form is on the site; the email is accepted and
is the fast path.

Register for their portal **now, before you need it** — an account created
during an incident is an hour you do not have.

Send what you know. Blank fields are expected at this stage.

```
To: incident@cert-in.org.in
Subject: Security incident report — LEX Practice — <date> <time IST>

1. Organisation:      LEX Practice (sole proprietorship of Anshuman Chauhan)
2. Contact:           Anshuman Chauhan, anshumanchauhan0661@gmail.com
3. Time noticed:      <date, time, IST>
4. Incident type:     <unauthorised access / data leak / suspicious activity>
5. Affected systems:  Web application and PostgreSQL database, hosted on
                      Render, Singapore region
6. What is known:     <two or three sentences. What was seen, by whom,
                      and what is not yet known.>
7. Data involved:     <categories — e.g. chamber member accounts, matter
                      records, uploaded documents. Numbers if known,
                      "under assessment" if not.>
8. Action taken:      <containment so far>
9. Status:            Under investigation. A fuller report will follow.
```

## 4. Affected chambers — within 48 hours

Every chamber whose data was or may have been reachable. Individually, not as a
group email with the addresses in the To field — that is a second breach.

The DPA promises this within forty-eight hours "with what we know and what we
are doing", and it is deliberately faster than the Board deadline so the chamber
can meet its own.

```
Subject: Security incident affecting your chamber's data on LEX Practice

<Chamber name>,

I am writing to tell you about a security incident affecting data your
chamber holds on LEX Practice. I became aware of it at <time> on <date>.

What happened: <plain description, no euphemism. "An error in an access
check let a member of one chamber read another chamber's matter list" —
not "an isolated anomaly was observed".>

What was affected: <specifically. Which matters, which documents, which
member accounts. If you do not yet know, say that you do not yet know
and when you will.>

What I have done: <containment and fix, with times.>

What this means for you: as Data Fiduciary for your chamber's content,
you may have your own obligation to notify the Data Protection Board
within 72 hours, and to tell the individuals concerned. I am available
to give you whatever detail you need for that.

What I am doing next: <steps and dates.>

I am sorry. If anything here is unclear, or you need something specific
for your own report, write or call and I will answer the same day.

Anshuman Chauhan
Grievance Officer, LEX Practice
anshumanchauhan0661@gmail.com
```

**Do not** ask them to keep it confidential, and do not offer anything that
reads as inducement not to report. Both look exactly like what they are.

## 5. Data Protection Board — within 72 hours

Under DPDP §8(6) and the Rules: intimation without delay on becoming aware, and
the detailed report within seventy-two hours. Check the Board's current filing
channel at the time — it has changed since the Act commenced and this page will
go stale before you need it.

The detailed report covers: the nature and extent of the breach, when and how it
happened, its likely consequences, the measures taken to mitigate it, and the
measures taken to prevent recurrence.

**Affected individuals** are told in plain language: what happened, what it
means for them, what they should do, and who to contact. For chamber content the
chamber is Fiduciary and does this — coordinate rather than duplicate, so nobody
receives two differently-worded accounts of the same incident.

## 6. After: the part that is easy to skip

Within a week of closing it:

- [ ] **A test that would have caught it.** Every incident either has one or
      teaches you why it cannot. `scripts/ci/suites/security.mjs` is where a
      tenant-isolation failure belongs; `case-access.mjs` is where a row-scope
      failure belongs.
- [ ] **A DECISIONS.md entry**, written for the person who meets the same
      question in two years and does not have your context.
- [ ] **Update the compliance register** if the incident showed a control that
      was described more confidently than it deserved.
- [ ] **Re-read this runbook** and fix whatever was wrong or missing while you
      were using it. That is the only time you will know.

## 7. The incident log

Keep it as you go. Written afterwards, it is a reconstruction; written at the
time, it is a record — and the difference shows.

```
| Time (IST) | What happened / what I did                      | Who |
| ---------- | ----------------------------------------------- | --- |
|            | Became aware — via <how>                        |     |
|            | Logs and audit_events captured to <where>       |     |
|            | Contained by <what>                             |     |
|            | CERT-In report sent                             |     |
|            | Chambers notified: <which>                      |     |
|            | Board report filed                              |     |
|            | Fix deployed — commit <sha>                     |     |
|            | Closed                                          |     |
```

---

## What this runbook assumes, and where those assumptions are thin

Stated plainly, because a runbook that overstates its own footing is the kind
that fails when used.

- **One person does all of this.** There is no rota and no second pair of hands.
  If the incident is large, the honest first move is to engage counsel and a
  security professional, and to say in the CERT-In report that you have.
- **The audit log is the primary evidence** — append-only, nothing in the
  application can edit or delete a row. It records privileged actions with a
  truncated IP. It does **not** record reads of matters or documents, so "who
  looked at this" is answerable only for the actions in `AUDIT_ACTIONS`.
- **There are no database backups.** Nothing to restore from and nothing to
  diff against. Compliance register §0.1 and §0.2.
- **Uploaded files do not survive a deploy** while `R2_*` is unset, so a
  redeploy during an incident destroys evidence and customer data at once.
  Register §0.3. Another reason §1 says do not redeploy.
- **Error reporting only alerts you if `ERROR_WEBHOOK_URL` is set.** Verify it
  works before you need it:
  `pnpm --filter @workspace/api-server run check-error-webhook`. The server also
  warns at boot when it is unset.
- **Logs live in Singapore, not India**, and are not retained for 180 days —
  which is a CERT-In gap in its own right (register §2, direction iv) and also
  means the evidence window is shorter than the law assumes.

## Keep this current

Review when any of these move: the entity or contact details, the hosting
region, the backup position, CERT-In's or the Board's filing channel. And after
every incident, per §6.
