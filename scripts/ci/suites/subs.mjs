// Subscription: who may change the plan, and can a client name its own price?
const BASE = (process.env.API_BASE_URL ?? "http://localhost:5000") + "/api";
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${n}`);
  } else {
    fail++;
    console.log(`  FAIL  ${n} ${d}`);
  }
};
const section = (t) => console.log(`\n== ${t}`);
const as = (email, name = "", provider = "google") =>
  `preview:email:${provider}:${encodeURIComponent(email)}:${encodeURIComponent(name)}`;

async function call(path, { token, wsToken, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (wsToken) headers["x-workspace-token"] = wsToken;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const stamp = Date.now();
const owner = `sub.owner${stamp}@chambers.test`;
const senior = `sub.senior${stamp}@chambers.test`;
const client = `sub.client${stamp}@x.test`;

section("Setup");
const created = await call("/workspaces", {
  token: as(owner, "S Owner"),
  method: "POST",
  body: { name: `Sub Chambers ${stamp}`, role: "admin" },
});
check("chamber created", created.status === 201, `got ${created.status}`);
const ws = created.data.workspaceToken;

// Whether this server can charge decides what "selecting a plan" is allowed to
// do: activate it outright, or record `pending_payment` and wait for the signed
// webhook. Both are correct, so several assertions below have to ask first.
const billingEnabled =
  (await call("/billing/config", { token: as(owner), wsToken: ws })).data?.enabled === true;

await call("/invites", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { email: senior, role: "senior_advocate" },
});
const seniorS = (await call("/session", { token: as(senior, "S Senior") })).data;

// A client invite must be restricted to a matter — see DECISIONS.md. Nothing
// below cares which one; this exists solely to satisfy that requirement.
const clientCase = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Client onboarding matter", filingRef: `CV-SUB-${stamp}` },
});
await call("/invites", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { email: client, role: "client", caseId: clientCase.data.id },
});
const clientS = (await call("/session", { token: as(client, "S Client") })).data;

section("A new chamber is on trial, not on a paid plan");
const initial = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check("readable", initial.status === 200, `got ${initial.status}`);
check(
  "starts trialing",
  initial.data.subscription.status === "trialing",
  initial.data.subscription?.status,
);
check("nothing charged yet", initial.data.subscription.amountMinor === 0);
check("owner may manage", initial.data.canManage === true);

section("The catalogue is served by the server, not assumed by the client");
const cat = initial.data.catalogue;
// Trial and Custom publish one entry each; Pro and Firm publish three.
check(
  "catalogue is 2 metered plans x 3 terms, plus trial and custom",
  cat.length === 8,
  `${cat.length} entries`,
);
const trialQ = cat.find((q) => q.plan === "trial");
const customQ = cat.find((q) => q.plan === "custom");
check("the trial pack costs Rs 99", trialQ.amountMinor === 9900, String(trialQ?.amountMinor));
check("...and covers two months", trialQ.months === 2 && trialQ.paidMonths === 2);
check(
  "...billed once, not renewing",
  trialQ.renews === false && trialQ.billingPeriod === "one_time",
);
check("the custom plan has no price", customQ.quoteOnly === true && customQ.amountMinor === 0);
check("...and no term", customQ.months === 0 && customQ.billingPeriod === "one_time");
const yearlyPro = cat.find((q) => q.plan === "pro" && q.billingPeriod === "yearly");
const monthlyPro = cat.find((q) => q.plan === "pro" && q.billingPeriod === "monthly");
const monthlyFirm = cat.find((q) => q.plan === "firm" && q.billingPeriod === "monthly");
const halfPro = cat.find((q) => q.plan === "pro" && q.billingPeriod === "half_yearly");

check(
  "yearly gives exactly TWO months free",
  yearlyPro.freeMonths === 2,
  String(yearlyPro.freeMonths),
);
check("...i.e. 12 months charged as 10", yearlyPro.months === 12 && yearlyPro.paidMonths === 10);
check(
  "...priced at 10x the monthly rate",
  yearlyPro.amountMinor === monthlyPro.amountMinor * 10,
  `${yearlyPro.amountMinor} vs ${monthlyPro.amountMinor * 10}`,
);
check(
  "...and the saving is the 2 free months",
  yearlyPro.savingsMinor === monthlyPro.amountMinor * 2,
);
check("Pro is Rs 1,999 a month", monthlyPro.amountMinor === 199900, String(monthlyPro.amountMinor));
check(
  "Firm is Rs 4,999 a month",
  monthlyFirm.amountMinor === 499900,
  String(monthlyFirm.amountMinor),
);
check("half-yearly gives one month free", halfPro.freeMonths === 1 && halfPro.paidMonths === 5);
check("monthly has no discount", monthlyPro.freeMonths === 0 && monthlyPro.savingsMinor === 0);
check(
  "effective monthly beats list on yearly",
  yearlyPro.effectiveMonthlyMinor < monthlyPro.amountMinor,
  `${yearlyPro.effectiveMonthlyMinor} vs ${monthlyPro.amountMinor}`,
);

section("Only billing.manage may change the plan");
const seniorSet = await call("/workspace/subscription", {
  token: as(senior),
  wsToken: seniorS.workspaceToken,
  method: "PUT",
  body: { plan: "firm", billingPeriod: "yearly" },
});
check("a plain Senior Advocate cannot (403)", seniorSet.status === 403, `got ${seniorSet.status}`);
check("...and holds no billing.manage", !seniorS.capabilities.includes("billing.manage"));

const clientSet = await call("/workspace/subscription", {
  token: as(client),
  wsToken: clientS.workspaceToken,
  method: "PUT",
  body: { plan: "firm", billingPeriod: "yearly" },
});
check("a client cannot (403)", clientSet.status === 403, `got ${clientSet.status}`);

const clientRead = await call("/workspace/subscription", {
  token: as(client),
  wsToken: clientS.workspaceToken,
});
check("but everyone may READ the plan", clientRead.status === 200, `got ${clientRead.status}`);
check("...and is told they cannot manage it", clientRead.data.canManage === false);

section("The owner selects a yearly plan");
const chosen = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "pro", billingPeriod: "yearly" },
});
check("accepted", chosen.status === 200, `got ${chosen.status}`);
const sub = chosen.data.subscription;
// Pro costs money. Where a provider is configured, selecting it records the
// intent and waits for the webhook; where none is, it goes straight into force.
check(
  billingEnabled ? "recorded, awaiting payment" : "now active",
  sub.status === (billingEnabled ? "pending_payment" : "active"),
  sub.status,
);
check("plan recorded", sub.plan === "pro" && sub.billingPeriod === "yearly");
check("two free months recorded", sub.freeMonths === 2 && sub.paidMonths === 10);
check("amount matches the catalogue", sub.amountMinor === yearlyPro.amountMinor);
check(
  "period runs 12 months out",
  (() => {
    const end = new Date(sub.currentPeriodEnd),
      start = new Date(sub.startedAt);
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    return months === 12;
  })(),
  sub.currentPeriodEnd,
);

section("Selecting Custom records an enquiry, not an unlimited plan");
const custom = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "custom", billingPeriod: "yearly" },
});
check("accepted", custom.status === 200, `got ${custom.status}`);
check("plan recorded as custom", custom.data.subscription.plan === "custom");
check(
  "...but NOT active - it is a quote request",
  custom.data.subscription.status === "trialing",
  custom.data.subscription.status,
);
check("...nothing charged", custom.data.subscription.amountMinor === 0);
check("...and no period is running", custom.data.subscription.currentPeriodEnd === null);
// The whole point: an unactivated custom plan must not hand out its limits.
const customUsage = await call("/workspace/usage", { token: as(owner), wsToken: ws });
check(
  "the chamber keeps the trial allowance, not unlimited",
  customUsage.data.plan === "trial" && customUsage.data.matters.limit === 10,
  JSON.stringify(customUsage.data),
);

section("The trial pack is always two months, whatever term is sent");
const trialSet = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "trial", billingPeriod: "yearly" },
});
check("accepted", trialSet.status === 200, `got ${trialSet.status}`);
check(
  "the yearly term was normalised away",
  trialSet.data.subscription.billingPeriod === "one_time",
  trialSet.data.subscription.billingPeriod,
);
check("priced at Rs 99", trialSet.data.subscription.amountMinor === 9900);
check(
  "period runs 2 months out",
  (() => {
    const end = new Date(trialSet.data.subscription.currentPeriodEnd);
    const start = new Date(trialSet.data.subscription.startedAt);
    return (
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) === 2
    );
  })(),
  trialSet.data.subscription.currentPeriodEnd,
);

section("A client cannot name its own price");
const cheeky = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "firm", billingPeriod: "yearly", amountMinor: 1, freeMonths: 999, paidMonths: 0 },
});
check("extra fields are ignored, not honoured", cheeky.status === 200, `got ${cheeky.status}`);
const firmYearly = cat.find((q) => q.plan === "firm" && q.billingPeriod === "yearly");
check(
  "price came from the server catalogue",
  cheeky.data.subscription.amountMinor === firmYearly.amountMinor,
  `${cheeky.data.subscription.amountMinor} vs ${firmYearly.amountMinor}`,
);
check(
  "free months came from the server too",
  cheeky.data.subscription.freeMonths === 2,
  String(cheeky.data.subscription.freeMonths),
);

const bogus = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "starter", billingPeriod: "yearly" },
});
check("a retired plan name is refused (400)", bogus.status === 400, `got ${bogus.status}`);
const bogusPeriod = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "pro", billingPeriod: "decade" },
});
check(
  "an unknown period is refused (400)",
  bogusPeriod.status === 400,
  `got ${bogusPeriod.status}`,
);

section("Tenant isolation still holds");
const rival = await call("/workspaces", {
  token: as(`rival${stamp}@other.test`, "R Rival"),
  method: "POST",
  body: { name: `Rival ${stamp}`, role: "admin" },
});
const rivalSub = await call("/workspace/subscription", {
  token: as(`rival${stamp}@other.test`),
  wsToken: rival.data.workspaceToken,
});
check("a second chamber has its own trial", rivalSub.data.subscription.status === "trialing");
check("...unaffected by the first chamber's plan", rivalSub.data.subscription.amountMinor === 0);

const noToken = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: "forged.token.here",
});
check("a forged workspace token is refused (401)", noToken.status === 401, `got ${noToken.status}`);

section("The selection survives a re-read");
const reread = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check(
  "still on the Firm yearly plan",
  reread.data.subscription.plan === "firm" && reread.data.subscription.billingPeriod === "yearly",
);
check("who changed it is recorded", Boolean(reread.data.subscription.updatedBy));

section("Payments: the webhook is the only thing that can mark a plan paid");
// Both states are supported: no provider configured (what CI runs, and what a
// self-hosted deployment looks like) and one configured. The unconfigured half
// of this section only means anything in the first, so it is asked rather than
// assumed — the forged-webhook checks below must hold either way.
const billingCfg = await call("/billing/config", { token: as(owner), wsToken: ws });
check("billing config readable", billingCfg.status === 200, `got ${billingCfg.status}`);

if (!billingEnabled) {
  check("...and exposes no key when unconfigured", billingCfg.data.keyId === null);

  const checkoutOff = await call("/billing/checkout", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: { plan: "pro", billingPeriod: "yearly" },
  });
  check(
    "checkout says so rather than failing obscurely (503)",
    checkoutOff.status === 503 && checkoutOff.data?.reason === "not_configured",
    `got ${checkoutOff.status} ${JSON.stringify(checkoutOff.data)}`,
  );
} else {
  check("...and publishes the public key id", typeof billingCfg.data.keyId === "string");
}

// An unsigned webhook must never be believed, configured or not.
const forged = await fetch(BASE + "/billing/webhook", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    event: "order.paid",
    payload: {
      order: {
        entity: {
          id: "order_forged",
          amount: 1,
          notes: { workspaceId: "1", plan: "firm", billingPeriod: "yearly" },
        },
      },
    },
  }),
});
check(
  "an unsigned payment webhook is refused (400)",
  forged.status === 400,
  `got ${forged.status}`,
);

const badSig = await fetch(BASE + "/billing/webhook", {
  method: "POST",
  headers: { "content-type": "application/json", "x-razorpay-signature": "deadbeef" },
  body: JSON.stringify({ event: "order.paid" }),
});
check("...and so is a wrong signature", badSig.status === 400, `got ${badSig.status}`);

// The plan must not have moved. A forged webhook that changed anything would be
// the whole failure mode this endpoint exists to avoid.
const afterForge = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check(
  "the forged webhook changed nothing",
  afterForge.data.subscription.plan === reread.data.subscription.plan &&
    afterForge.data.subscription.amountMinor === reread.data.subscription.amountMinor,
  JSON.stringify(afterForge.data.subscription),
);

const quoteOnlyCheckout = await call("/billing/checkout", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { plan: "custom", billingPeriod: "yearly" },
});
check(
  "a quote-only plan cannot be checked out",
  quoteOnlyCheckout.status === 400 || quoteOnlyCheckout.status === 503,
  `got ${quoteOnlyCheckout.status}`,
);

const clientCheckout = await call("/billing/checkout", {
  token: as(client),
  wsToken: clientS.workspaceToken,
  method: "POST",
  body: { plan: "pro", billingPeriod: "yearly" },
});
check(
  "a client cannot start a checkout (403)",
  clientCheckout.status === 403,
  `got ${clientCheckout.status}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
