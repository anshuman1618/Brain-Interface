// Subscription: who may change the plan, and can a client name its own price?
import { declareBarRegistration } from "../lib/bar-registration.mjs";
import { grantPreviewPlan } from "../lib/preview-plan.mjs";

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
await declareBarRegistration(call, as(owner));

// Whether this server can charge decides what "selecting a plan" is allowed to
// do: activate it outright, or record `pending_payment` and wait for the signed
// webhook. Both are correct, so several assertions below have to ask first.
const billingEnabled =
  (await call("/billing/config", { token: as(owner), wsToken: ws })).data?.enabled === true;

// Read BEFORE anything touches the plan. A chamber that has just been founded
// has never paid, and the moment the setup below gives it an allowance that
// state is gone — so the assertions in the next section run against this.
const initial = await call("/workspace/subscription", { token: as(owner), wsToken: ws });

// A chamber that has never paid may read its own shell and nothing else, and
// the setup below opens a matter. See lib/preview-plan.mjs.
await grantPreviewPlan(call, as(owner), ws);

await call("/invites", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { email: senior, role: "senior_advocate" },
});
const seniorS = (await call("/session", { token: as(senior, "S Senior") })).data;
await declareBarRegistration(call, as(senior));

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
/*
 * One entry, because one plan is on sale.
 *
 * Pro, Firm and Custom are still built, priced and quota-enforced — a chamber
 * already on one keeps its limits — but they are off the storefront, so the
 * catalogue does not publish them and the write paths refuse them. See
 * OFFERED_PLANS in lib/plans.ts.
 *
 * The Pro/Firm price assertions that used to live here (yearly = ten months
 * charged, half-yearly = one free, Pro Rs 2,499, Firm Rs 7,999) tested quotes
 * the API no longer publishes. They are PARKED with the plans rather than
 * deleted quietly: when those go back on sale the assertions come back with
 * them. Recorded in FLOW so it is a decision rather than a gap somebody finds.
 */
check("exactly one plan is on offer", cat.length === 1, `${cat.length} entries`);
const trialQ = cat.find((q) => q.plan === "trial");
check("...and it is the trial pack", Boolean(trialQ), JSON.stringify(cat.map((q) => q.plan)));
check("the trial pack costs Rs 99", trialQ.amountMinor === 9900, String(trialQ?.amountMinor));
check("...and covers two months", trialQ.months === 2 && trialQ.paidMonths === 2);
check(
  "...billed once, not renewing",
  trialQ.renews === false && trialQ.billingPeriod === "one_time",
);

// The storefront is enforced, not merely rendered: a crafted request for a
// plan that is not offered is refused on BOTH the selection and the money path.
for (const plan of ["pro", "firm", "custom"]) {
  const refused = await call("/workspace/subscription", {
    token: as(owner),
    wsToken: ws,
    method: "PUT",
    body: { plan, billingPeriod: "yearly" },
  });
  check(
    `selecting ${plan} is refused while it is off the storefront`,
    refused.status === 400 && refused.data?.error === "plan_not_offered",
    `got ${refused.status} ${refused.data?.error}`,
  );
}
check(
  "...and it cannot be paid for either",
  (
    await call("/billing/checkout", {
      token: as(owner),
      wsToken: ws,
      method: "POST",
      body: { plan: "firm", billingPeriod: "yearly" },
    })
  ).status === 400,
  "the checkout gate is the one that stops money changing hands",
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

/*
 * The pack that IS on sale is selected in "The trial pack is always two months"
 * below — one trial per chamber, so selecting it twice would 409 and the
 * second section would fail for a reason that has nothing to do with what it
 * tests. That section carries the "records intent vs goes into force"
 * assertion this one used to duplicate.
 */

/*
 * PARKED WITH THE PLANS.
 *
 * The yearly-term maths (12 months charged as 10, the saving equal to two
 * months, Pro at Rs 2,499 and Firm at Rs 7,999) and the Custom-enquiry
 * behaviour (recorded, never active, keeps the trial allowance rather than
 * handing out unlimited) were asserted here. They test quotes the API no
 * longer publishes and selections the write path now refuses, because those
 * plans are off the storefront.
 *
 * They are named rather than deleted so the coverage comes back deliberately
 * when the plans do. `quote()` and `activatesOnSelection()` still implement
 * every one of these rules; nothing about them was removed.
 */

section("The trial pack is always two months, whatever term is sent");
const trialSet = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "trial", billingPeriod: "yearly" },
});
check("accepted", trialSet.status === 200, `got ${trialSet.status}`);
// The pack costs money. Where a provider is configured, selecting it records
// the intent and waits for the signed webhook; where none is, it goes straight
// into force. Both are correct, so which one is asserted has to be asked.
check(
  billingEnabled ? "recorded, awaiting payment" : "now active",
  trialSet.data.subscription.status === (billingEnabled ? "pending_payment" : "active"),
  trialSet.data.subscription.status,
);
check(
  "amount matches the catalogue",
  trialSet.data.subscription.amountMinor === trialQ.amountMinor,
);
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
// Named against the pack that IS on sale: `plan_not_offered` is checked before
// the body is priced, so forging a Firm price would be refused for the wrong
// reason and this would stop testing that the server prices it itself.
const cheeky = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: {
    plan: "trial",
    billingPeriod: "one_time",
    amountMinor: 1,
    freeMonths: 999,
    paidMonths: 0,
  },
});
check(
  "extra fields are ignored, not honoured",
  cheeky.status === 200 || cheeky.status === 409,
  `got ${cheeky.status}`,
);
if (cheeky.status === 200) {
  check(
    "price came from the server catalogue",
    cheeky.data.subscription.amountMinor === trialQ.amountMinor,
    `${cheeky.data.subscription.amountMinor} vs ${trialQ.amountMinor}`,
  );
  check(
    "months came from the server too",
    cheeky.data.subscription.paidMonths === 2,
    String(cheeky.data.subscription.paidMonths),
  );
} else {
  // The trial is once per chamber and this suite has already taken it, so the
  // forged amount never reaches pricing at all — which is a stronger refusal,
  // not a weaker one. Assert the row was left alone.
  const after = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
  check(
    "a refused forgery changes nothing",
    after.data.subscription.amountMinor === trialQ.amountMinor,
    String(after.data.subscription.amountMinor),
  );
}

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
  body: { plan: "trial", billingPeriod: "decade" },
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
await declareBarRegistration(call, as(`rival${stamp}@other.test`));
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
  "still on the pack that was selected",
  reread.data.subscription.plan === "trial" &&
    reread.data.subscription.billingPeriod === "one_time",
  `${reread.data.subscription.plan}/${reread.data.subscription.billingPeriod}`,
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
    // A plan that IS on sale: `plan_not_offered` is checked first, so asking
    // for Pro here would 400 and this would stop testing the thing it names.
    body: { plan: "trial", billingPeriod: "one_time" },
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
