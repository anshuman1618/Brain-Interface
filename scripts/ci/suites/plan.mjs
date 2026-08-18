// Plan enforcement: payment required, seats and matters actually capped,
// expiry evaluated, and a lapsed chamber that reads but cannot write.
//
// Every limit in here was walkable before this suite existed. The point of
// each section is a specific hole, named in the comment above it.
import { paymentsConfigured, payForPlan, activatePlan } from "../lib/billing.mjs";

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

const suffix = Date.now();
const owner = `plan.owner+${suffix}@plan.test`;

const founded = await call("/workspaces", {
  token: as(owner, "Plan Owner"),
  method: "POST",
  body: { name: `Plan Chambers ${suffix}`, role: "admin" },
});
const ws = founded.data.workspaceToken;
const wsId = founded.data.activeWorkspace.id;
check("chamber founded", founded.status === 201, `got ${founded.status}`);

// With no provider configured a selected plan activates immediately; with one
// it must wait for money. Both are correct, so the suite asks which server it
// is looking at rather than hardcoding either. CI runs it both ways.
const paymentsOn = await paymentsConfigured(call, as(owner), ws);
console.log(`\n(payments ${paymentsOn ? "CONFIGURED" : "not configured"} on this server)`);

const activate = (plan, billingPeriod) =>
  activatePlan(BASE, call, {
    token: as(owner),
    wsToken: ws,
    workspaceId: wsId,
    plan,
    billingPeriod,
    paymentsOn,
  });

/* ─────────────── 1. A FRESH CHAMBER IS NOT LAPSED ─────────────── */
// The regression guard. `currentPeriodEnd IS NULL` must never read as expired,
// or a refactor of the lapse rule bricks every new signup on their first click.
section("1. A chamber with no subscription row can still work");
const fresh = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check("subscription readable", fresh.status === 200, `got ${fresh.status}`);
check("...and is not lapsed", fresh.data.subscription.lapsed === false);
check("...with no period running", fresh.data.subscription.currentPeriodEnd === null);
check("...and no day count", fresh.data.subscription.daysLeft === null);

const firstCase = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "First matter", filingRef: `CV-P-${suffix}` },
});
check("a brand-new chamber can file a matter", firstCase.status === 201, `got ${firstCase.status}`);

/* ─────────────── 2. THE TRIAL ALLOWANCE ─────────────── */
section("2. The trial allowance is 10 matters and 5 seats");
const usage = await call("/workspace/usage", { token: as(owner), wsToken: ws });
check("matters capped at 10", usage.data.matters.limit === 10, JSON.stringify(usage.data.matters));
check("seats capped at 5", usage.data.seats.limit === 5, JSON.stringify(usage.data.seats));

/* ─────────────── 3. THE MATTERS CAP HOLDS ON REOPEN ─────────────── */
// Hole 4: the cap was checked on create only, so closing a matter, creating a
// replacement and reopening the closed one walked straight past it.
section("3. Reopening a closed matter is capped, not free");
for (let i = 2; i <= 10; i++) {
  await call("/cases", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: { title: `Matter ${i}`, filingRef: `CV-P-${suffix}-${i}` },
  });
}
const atCap = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Over cap", filingRef: `CV-P-${suffix}-over` },
});
check("the 11th matter is refused", atCap.status === 402, `got ${atCap.status}`);

// Close one, fill the freed slot, then try to reopen the closed one.
await call(`/cases/${firstCase.data.id}`, {
  token: as(owner),
  wsToken: ws,
  method: "PATCH",
  body: { status: "closed" },
});
const replacement = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Replacement", filingRef: `CV-P-${suffix}-repl` },
});
check("closing frees a slot", replacement.status === 201, `got ${replacement.status}`);

const reopen = await call(`/cases/${firstCase.data.id}`, {
  token: as(owner),
  wsToken: ws,
  method: "PATCH",
  body: { status: "open" },
});
check(
  "...but reopening the closed one is refused (402)",
  reopen.status === 402,
  `got ${reopen.status}`,
);
check(
  "...naming the plan and the number",
  /Trial/.test(reopen.data?.message ?? "") && /10/.test(reopen.data?.message ?? ""),
  reopen.data?.message,
);

// A PATCH on an already-open matter must never 402 — the guard is on the
// transition, not on the plan being full.
const renameOpen = await call(`/cases/${replacement.data.id}`, {
  token: as(owner),
  wsToken: ws,
  method: "PATCH",
  body: { title: "Renamed while at cap" },
});
check(
  "editing an already-open matter at cap still works",
  renameOpen.status === 200,
  `got ${renameOpen.status}`,
);

/* ─────────────── 4. THE TRIAL PACK IS BOUGHT ONCE ─────────────── */
section("4. The two-month trial cannot be taken twice");
const trial1 = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "trial", billingPeriod: "one_time" },
});
check("the trial is accepted the first time", trial1.status === 200, `got ${trial1.status}`);

const trial2 = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "trial", billingPeriod: "one_time" },
});
check("...and refused the second (409)", trial2.status === 409, `got ${trial2.status}`);
check("...as trial_already_used", trial2.data?.error === "trial_already_used", trial2.data?.error);

// Moving to a paid plan must not wipe the stamp and re-open the trial.
await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "pro", billingPeriod: "monthly" },
});
const trial3 = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "trial", billingPeriod: "one_time" },
});
check(
  "upgrading then re-selecting the trial is still refused",
  trial3.status === 409,
  `got ${trial3.status}`,
);

/* ─────────────── 5. EXPIRY, AND WHAT A LAPSED CHAMBER MAY DO ─────────────── */
// Hole 5: currentPeriodEnd was written and read by nothing, so an expired plan
// stayed active forever. Time-travel is preview-only; see routes/preview.ts.
section("5. A lapsed plan reads everything and writes nothing");
const firmPut = await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "firm", billingPeriod: "yearly" },
});
check("firm plan selected", firmPut.status === 200, `got ${firmPut.status}`);

// Hole 1: selecting a chargeable plan used to set `active` outright, so
// `PUT {plan:"firm"}` bought unlimited seats and matters for nothing. Which
// status is correct depends entirely on whether this server can charge.
if (paymentsOn) {
  check(
    "a chargeable plan does NOT activate on selection when payments are on",
    firmPut.data.subscription.status === "pending_payment",
    firmPut.data.subscription.status,
  );
  const paidStatus = await payForPlan(BASE, {
    workspaceId: wsId,
    plan: "firm",
    billingPeriod: firmPut.data.subscription.billingPeriod,
    amountMinor: firmPut.data.subscription.amountMinor,
  });
  check("the signed webhook is accepted", paidStatus === 200, `got ${paidStatus}`);
} else {
  check(
    "with no provider configured the plan activates on selection",
    firmPut.data.subscription.status === "active",
    firmPut.data.subscription.status,
  );
}

const firmSet = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check(
  "the plan is now in force",
  firmSet.data.subscription.status === "active",
  firmSet.data.subscription.status,
);
check("...and is not lapsed while running", firmSet.data.subscription.lapsed === false);
check(
  "...with a positive day count",
  typeof firmSet.data.subscription.daysLeft === "number" && firmSet.data.subscription.daysLeft > 0,
  String(firmSet.data.subscription.daysLeft),
);

const travelled = await call("/preview/set-period-end", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { daysFromNow: -3 },
});
check("the period is moved into the past", travelled.status === 200, `got ${travelled.status}`);

const lapsedView = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check("the subscription now reads lapsed", lapsedView.data.subscription.lapsed === true);
check(
  "...with a negative day count",
  lapsedView.data.subscription.daysLeft < 0,
  String(lapsedView.data.subscription.daysLeft),
);
check(
  "...while the STORED status is untouched by the read",
  lapsedView.data.subscription.status === "active",
  lapsedView.data.subscription.status,
);

// Reads survive.
const readCases = await call("/cases", { token: as(owner), wsToken: ws });
check(
  "a lapsed chamber can still read its matters",
  readCases.status === 200,
  `got ${readCases.status}`,
);
const readUsage = await call("/workspace/usage", { token: as(owner), wsToken: ws });
check("...and its usage", readUsage.status === 200, `got ${readUsage.status}`);
check(
  "...which now reports the trial allowance, not Firm's",
  readUsage.data.matters.limit === 10,
  JSON.stringify(readUsage.data.matters),
);

// Writes do not.
const lapsedWrite = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Written while lapsed", filingRef: `CV-P-${suffix}-lapsed` },
});
check(
  "a lapsed chamber cannot file a matter (402)",
  lapsedWrite.status === 402,
  `got ${lapsedWrite.status}`,
);
check("...as plan_lapsed", lapsedWrite.data?.error === "plan_lapsed", lapsedWrite.data?.error);

// Billing stays reachable, or they could never pay their way out.
const stillBilling = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check(
  "...but billing is still readable",
  stillBilling.status === 200,
  `got ${stillBilling.status}`,
);

/* ─────────────── 6. RENEWAL RECOVERS ─────────────── */
section("6. Renewing restores the chamber");
const renewed = await activate("firm", "yearly");
check("the plan can be renewed while lapsed", renewed.status === 200, `got ${renewed.status}`);

const afterRenewView = await call("/workspace/subscription", { token: as(owner), wsToken: ws });
check("...and is no longer lapsed", afterRenewView.data.subscription.lapsed === false);

const afterRenew = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Written after renewal", filingRef: `CV-P-${suffix}-renewed` },
});
check("...and writes work again", afterRenew.status === 201, `got ${afterRenew.status}`);

/* ─────────────── 7. SEATS ARE NOT BYPASSABLE ─────────────── */
// Hole 2: the access list inserted an ACTIVE membership with no seat check, so
// a domain rule admitted an unbounded number of people. Over cap now lands in
// the approval queue instead of being refused outright — nobody is locked out.
section("7. The access-list path cannot mint seats past the cap");
const seatOwner = `seat.owner+${suffix}@seat.test`;
const seatWs = await call("/workspaces", {
  token: as(seatOwner, "Seat Owner"),
  method: "POST",
  body: { name: `Seat Chambers ${suffix}`, role: "admin" },
});
const sTok = seatWs.data.workspaceToken;

// Founder is seat 1. Admit a whole domain, then sign in six people through it.
await call("/workspace/access-list", {
  token: as(seatOwner),
  wsToken: sTok,
  method: "POST",
  body: { kind: "domain", value: `seatfirm${suffix}.test`, role: "junior_advocate" },
});

const statuses = [];
for (let i = 1; i <= 6; i++) {
  const r = await call("/session", {
    token: as(`member${i}+${suffix}@seatfirm${suffix}.test`, `M${i}`),
  });
  statuses.push(r.data?.accessStatus);
}
check(
  "the first four through the domain are admitted",
  statuses.slice(0, 4).every((s) => s === "active"),
  JSON.stringify(statuses),
);
check(
  "...and the ones past the cap land in the approval queue, not locked out",
  statuses.slice(4).every((s) => s === "pending_approval"),
  JSON.stringify(statuses),
);

const seatUsage = await call("/workspace/usage", { token: as(seatOwner), wsToken: sTok });
check(
  "active seats never exceed the plan",
  seatUsage.data.seats.used <= seatUsage.data.seats.limit,
  JSON.stringify(seatUsage.data.seats),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
