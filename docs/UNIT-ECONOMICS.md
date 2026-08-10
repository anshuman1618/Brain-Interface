# What it costs to run a chamber, and what to charge

Working model for the Pro and Firm packs. Every input is named so you can argue
with it — the conclusion is only as good as the assumptions, and two of them
(support load, storage per chamber) are guesses until you have real customers.

**Assumptions:** ₹88 = $1. Prices exclusive of GST. Costs current as of
August 2026; re-check the provider pages before betting on them.

---

## 1. Fixed costs — the whole platform, not per customer

These do not move whether you have three chambers or three hundred.

| Item                | Provider / plan                    | USD/mo |       ₹/mo |
| ------------------- | ---------------------------------- | -----: | ---------: |
| Application server  | Render Standard, 1 vCPU / 2 GB     |     25 |      2,200 |
| Managed Postgres    | Render Basic (the smallest usable) |     20 |      1,760 |
| Object storage base | Cloudflare R2, first GBs           |      1 |         88 |
| Transactional email | SES-class, ~10k messages           |      2 |        176 |
| Error reporting     | Slack webhook                      |      0 |          0 |
| Authentication      | **Clerk — free to 50,000 users**   |      0 |          0 |
| Domain, TLS         | amortised                          |      2 |        176 |
| **Total**           |                                    | **50** | **₹4,400** |

Two things worth noticing.

**Auth is free and will stay free.** Clerk raised its free allotment to 50,000
monthly retained users in February 2026. At 10 seats per chamber that is 5,000
chambers before authentication costs anything. Do not model it as a cost.

**Do not put case files on a Render disk.** A persistent disk is around
$0.25/GB/month; Cloudflare R2 is **$0.015/GB/month with zero egress** — about
16× cheaper on storage and free on download, where S3 would charge $0.09/GB.
The blob store is four functions behind an interface precisely so this swap is
cheap. At 100 chambers averaging 8 GB it is the difference between roughly
₹17,600/month and ₹1,050/month.

> **Add ₹2,200/month for a second app replica before you take real customers.**
> One instance means a deploy is an outage. It also halves the effective rate
> limit per replica, which is documented but worth planning around.

---

## 2. Variable cost per chamber, per month

### Pro — 10 seats, ~100 open matters

| Item                  | Basis                                |     ₹/mo |
| --------------------- | ------------------------------------ | -------: |
| Document storage      | 8 GB on R2 @ $0.015/GB               |       11 |
| Egress                | ~5 GB of downloads, R2 zero-egress   |        0 |
| Compute share         | 1/100th of the app + database        |       40 |
| Email                 | ~200 notices                         |        2 |
| **Razorpay**          | **2% + 18% GST = 2.36% of ₹1,999**   |   **47** |
| Support, steady state | 0.5 tickets @ 15 min, ₹312/hr loaded |       39 |
| Onboarding, amortised | 2 hours spread over 24 months        |       26 |
| **Total**             |                                      | **₹165** |

**Gross margin at ₹1,999: 91.7%. Contribution ₹1,834/month.**

### Firm — ~30 seats, ~500 open matters

| Item                  | Basis                  |     ₹/mo |
| --------------------- | ---------------------- | -------: |
| Document storage      | 40 GB on R2            |       53 |
| Compute share         | ~3× a Pro chamber      |      120 |
| Email                 | ~600 notices           |        6 |
| **Razorpay**          | **2.36% of ₹4,999**    |  **118** |
| Support, steady state | 1.5 tickets @ 20 min   |      156 |
| Onboarding, amortised | 6 hours over 24 months |       78 |
| **Total**             |                        | **₹531** |

**Gross margin at ₹4,999: 89.4%. Contribution ₹4,468/month.**

### Trial — ₹99 for two months

| Item              | ₹ over the two months |
| ----------------- | --------------------: |
| Revenue           |                    99 |
| Razorpay          |                    −2 |
| Infrastructure    |                   −80 |
| Support (~1 hour) |                  −312 |
| **Net**           |             **−₹295** |

**The trial loses money, and that is correct.** It is not a product, it is a
qualification filter: ₹99 costs nothing to a practising advocate and stops
casual signups who would consume support and never convert. Judge it on
conversion rate, not margin. At a 30% conversion to Pro you recover the ₹295 in
under a week of the subscription.

---

## 3. Break-even

Fixed costs are ₹4,400/month, ₹6,600 with the second replica you should have.

**Three Pro chambers cover the entire platform.** Two Firm chambers do it with
room to spare. That is the useful headline: this is not a business with a
capital wall in front of it — the constraint is distribution and support
capacity, not infrastructure.

At 500 chambers (400 Pro, 100 Firm):

|                         |        ₹/month |
| ----------------------- | -------------: |
| Revenue                 |      1,299,500 |
| Infrastructure (scaled) |        −60,000 |
| Payment fees            |        −30,700 |
| Support (3 people)      |       −150,000 |
| **Gross**               | **₹1,058,800** |

---

## 4. What the prices should be

Cost is not the constraint — every plan clears 89% gross margin. So price on
what a chamber will pay and on how the plans push a firm upward, not on cost.

### Pro at ₹1,999 — keep it, but know it is cheap

At 10 seats this is **₹200 per seat per month**. Indian practice-management
tools generally sit between ₹500 and ₹2,000 per user per month; international
ones are far above that. You are priced at a fraction of the market.

That is defensible as a deliberate land-grab, and I would hold ₹1,999 for the
first twelve months to win reference chambers. Two cautions:

- **Underpricing carries a signal cost in professional services.** A senior
  advocate choosing where to keep privileged client files may read ₹1,999 as
  hobbyist. Whatever you save on price you spend on credibility.
- **Raise it for new customers, never for existing ones.** Grandfathering the
  first hundred chambers costs little and buys advocates who will recommend you.

Move to **₹2,499** for new signups once you have twenty paying chambers. That
is still under ₹250 per seat.

### Firm at ₹4,999 with unlimited seats — change this one

This is the real problem in the current pricing, and it is structural rather
than a matter of a few hundred rupees.

**Unlimited seats means a 15-advocate firm and a 150-advocate firm pay the same
₹4,999** — while the larger one costs several times more to serve and gets many
times the value. You have capped your revenue per customer at the moment the
customer becomes most valuable. It also collapses the gap to Pro: a firm with
30 seats has no reason to consider anything above Firm, ever.

**Recommendation: ₹4,999 including 25 seats, then ₹149 per additional seat per
month.** A 60-seat firm pays ₹10,214 — which is still ₹170 per seat and far
below anything comparable, while tripling your revenue on your best accounts.
The Custom plan then has an honest job: it is where a firm goes when per-seat
stops making sense, rather than a card with nothing behind it.

If you would rather not meter seats at all, the alternative is **₹7,999 for up
to 50 seats**, with Custom above that. Less elegant, simpler to sell.

### GST — the point most SaaS pricing gets wrong here

SaaS attracts 18% GST, so ₹1,999 is ₹2,359 out of the customer's account.

For most B2B software that is a pass-through, because the buyer claims input
tax credit. **Advocates are frequently not in that position**: legal services
supplied to business entities fall under reverse charge, so an advocate's own
output is largely outside the normal credit chain and input credit on their
purchases is often unavailable.

If that holds for your customers — **confirm it with a chartered accountant,
because it turns on their exact registration and mix of work** — then the 18% is
a real cost to them and not a paper entry. Two consequences:

- Quote the GST-inclusive figure in sales conversations. An advocate who
  budgeted ₹1,999 and is invoiced ₹2,359 feels it.
- The annual plan gets more attractive, not less: two free months on a
  GST-inclusive basis saves ₹4,718, which is a number worth putting on the page.

### Summary

| Plan   | Now              | Recommended                               | Why                                             |
| ------ | ---------------- | ----------------------------------------- | ----------------------------------------------- |
| Trial  | ₹99 / 2 months   | **No change**                             | Works as a filter; loses ₹295 by design         |
| Pro    | ₹1,999/mo        | **₹1,999 now, ₹2,499 after ~20 chambers** | Still well under market; grandfather early ones |
| Firm   | ₹4,999 unlimited | **₹4,999 for 25 seats + ₹149/seat**       | Unlimited caps you where the customer is best   |
| Custom | Quoted           | **No change**                             | Gets a real job once Firm has a ceiling         |

---

## 5. What this model does not include

Honest gaps, because the numbers above will be quoted at some point:

- **Your salary**, and anyone else's. This is gross margin, not profit.
- **Sales and marketing.** For a product sold to advocates this is likely to be
  the largest line in the business and is entirely absent here.
- **Professional indemnity insurance.** Worth quoting for early — you are
  holding privileged material, and the terms of service cap liability at fees
  paid, which an insurer will have views about.
- **Compliance work**: the counsel review the legal documents need, a security
  assessment if you sell to a firm large enough to ask for one.
- **Churn.** Every figure above is a snapshot of a customer who stays.
