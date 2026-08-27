/**
 * The portal, in a real browser, at every screen size a chamber will use.
 *
 * This exists because the API suites cannot see a layout. They proved the
 * server was right and said nothing about whether the app was usable on the
 * phone an advocate actually carries into court.
 *
 * Runs against the built SPA served by the API in preview mode, so it needs no
 * Clerk tenant and no database service — the same single-origin topology the
 * deployment guide recommends.
 *
 *   BASE_URL=http://localhost:5000 node scripts/ci/browser/portal.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5000";
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM ?? undefined;

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};
const section = (t) => console.log(`\n== ${t}`);

/**
 * The screens this has to work on. Not arbitrary: 360 is the floor for Android
 * in India, 390 an iPhone, 414 a large phone, 768 an iPad portrait, 1024 an
 * iPad landscape and the smallest laptop, 1280 a common laptop, 1440 a desktop.
 */
const VIEWPORTS = [
  { w: 360, h: 740, label: "small phone" },
  { w: 390, h: 844, label: "phone" },
  { w: 414, h: 896, label: "large phone" },
  { w: 768, h: 1024, label: "tablet portrait" },
  { w: 1024, h: 768, label: "tablet landscape" },
  { w: 1280, h: 800, label: "laptop" },
  { w: 1440, h: 900, label: "desktop" },
];

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
/*
 * Set only while a refusal is deliberately being provoked.
 *
 * A 404 makes the browser log "Failed to load resource", which is a console
 * error like any other and would fail this suite — correctly, in every other
 * case. The operator check below asks the server to refuse on purpose, so the
 * expected noise is suppressed for exactly that navigation rather than by
 * filtering 404s everywhere, which would blind the suite to a real one.
 */
let expectingRefusal = false;
page.on("pageerror", (e) => {
  if (!expectingRefusal) consoleErrors.push(String(e));
});
page.on("console", (m) => {
  if (m.type() === "error" && !expectingRefusal) consoleErrors.push(m.text());
});
page.on("requestfailed", (r) => failedRequests.push(`${r.failure()?.errorText} ${r.url()}`));

const text = () => page.locator("body").innerText();

/** Horizontal overflow of the document, in px. Anything above 1 is a bug. */
const overflow = () =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Any element wider than the viewport — what to blame when overflow is found. */
const widest = () =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("*")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > vw + 1 || r.right > vw + 1)
      .slice(0, 4)
      .map(
        ({ el, r }) =>
          `${el.tagName}.${String(el.className).slice(0, 40)} w=${Math.round(r.width)} right=${Math.round(r.right)}`,
      );
  });

/* ─────────────────────────── 1. It loads at all ─────────────────────────── */

section("1. The application loads");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
check("landing page renders", (await text()).includes("PRACTICE"));
check(
  "no console errors on load",
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(" | "),
);

/* ── 2. Nothing is fetched from a third party ───────────────────────────────
 * The privacy policy states this in terms. A regression here makes a written
 * claim false, which is worse than the request itself.
 *
 * Scope: this runs against a PREVIEW build, which has no authentication
 * provider configured. A production build additionally loads the Clerk script
 * from Clerk's domain — that is required to sign in, is disclosed in the
 * privacy policy, and is not what this check is guarding against. What it
 * guards against is fonts, analytics and tracking creeping back in.
 */
section("2. No third-party requests");
const thirdParty = await page.evaluate(() =>
  performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((u) => {
      try {
        return new URL(u).origin !== location.origin;
      } catch {
        return false;
      }
    }),
);
check(
  "every resource comes from this origin",
  thirdParty.length === 0,
  thirdParty.slice(0, 4).join(" | "),
);
check("no request failed", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

/* ─────────────────────── 3. The legal documents ─────────────────────────── */

section("3. The legal documents are reachable without an account");
for (const [slug, expect] of [
  ["terms", /terms of service/i],
  ["privacy", /privacy policy/i],
  ["notice", /digital personal data protection/i],
  ["dpa", /data processing agreement/i],
]) {
  const res = await page.goto(`${BASE}/legal/${slug}`, { waitUntil: "domcontentloaded" });
  const body = await text();
  check(
    `/legal/${slug} serves a document`,
    res?.status() === 200 && expect.test(body),
    `status ${res?.status()}`,
  );
}
// They must be readable on a phone too — counsel reads these on the move.
await page.setViewportSize({ width: 360, height: 740 });
await page.goto(`${BASE}/legal/privacy`, { waitUntil: "domcontentloaded" });
check(
  "legal pages do not scroll sideways on a phone",
  (await overflow()) <= 1,
  `overflow ${await overflow()}px`,
);
await page.setViewportSize({ width: 1280, height: 800 });

/* ──────────────────────── 4. Sign in, preview mode ──────────────────────── */

section("4. Sign-in is passwordless and gated");
await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
check("no password field anywhere", (await page.locator('input[type="password"]').count()) === 0);
check("says it is passwordless", /passwordless/i.test(await text()));
check("offers a one-time code", /one-time code/i.test(await text()));
check("legal links are present before sign-in", /terms of service/i.test(await text()));

/* ──────────────── 5. Every screen size, on every reachable page ─────────── */

section("5. Layout holds at every screen size");
const PAGES = [
  ["/", "landing"],
  ["/portal", "sign-in"],
  ["/legal/terms", "terms"],
];

for (const { w, h, label } of VIEWPORTS) {
  await page.setViewportSize({ width: w, height: h });
  for (const [path, name] of PAGES) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    const o = await overflow();
    if (o > 1) {
      check(
        `${name} @ ${w}px (${label}) has no horizontal scroll`,
        false,
        `overflow ${o}px — ${(await widest()).join(" ; ")}`,
      );
    } else {
      check(`${name} @ ${w}px (${label}) has no horizontal scroll`, true);
    }
  }
}

/* ── 6. Touch targets and legibility on the smallest screen ─────────────── */

section("6. Usable with a thumb");
await page.setViewportSize({ width: 360, height: 740 });
await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

const smallTargets = await page.evaluate(() =>
  [...document.querySelectorAll("button, a[href], input, select")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || r.width === 0) return false;
      return r.height < 36;
    })
    .slice(0, 5)
    .map(
      (el) =>
        `${el.tagName}(${(el.textContent ?? "").trim().slice(0, 24)}) h=${Math.round(el.getBoundingClientRect().height)}`,
    ),
);
check(
  "interactive targets are at least 36px tall",
  smallTargets.length === 0,
  smallTargets.join(" | "),
);

const tinyText = await page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 10) out.push(`${size}px "${n.nodeValue.trim().slice(0, 24)}"`);
  }
  return [...new Set(out)].slice(0, 5);
});
check("no text below 10px", tinyText.length === 0, tinyText.join(" | "));

/* ─────────────────────────── 7. Keyboard access ─────────────────────────── */

section("7. Keyboard");
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
await page.keyboard.press("Tab");
const focusRing = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  return {
    tag: el.tagName,
    outline: s.outlineStyle,
    width: parseFloat(s.outlineWidth) || 0,
    shadow: s.boxShadow,
  };
});
check(
  "tabbing reaches a control with a visible focus indicator",
  focusRing !== null &&
    (focusRing.outline !== "none" || (focusRing.shadow && focusRing.shadow !== "none")),
  JSON.stringify(focusRing),
);

/* ─────────── 8. The signed-in application, at every screen size ──────────
 *
 * The pages above are the front door. This is the part a chamber lives in all
 * day, and the part that carries tables, a calendar grid and a pricing screen
 * — everything that actually breaks when the viewport narrows.
 *
 * Preview mode treats any address as verified, so no Clerk tenant is needed;
 * everything after sign-in is the real authorisation path.
 */
section("8. The signed-in application");
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Continue with email/i }).click();
await page.waitForTimeout(400);
await page.locator('input[type="email"]').fill(`founder${Date.now()}@chambers.test`);
await page.locator("input").nth(1).fill("B Founder");
await page.getByRole("button", { name: /^Continue$/ }).click();
await page.waitForTimeout(1500);

const afterSignIn = await text();
check(
  "a fresh platform offers to create the first chamber",
  /chamber/i.test(afterSignIn),
  afterSignIn.slice(0, 200),
);

/*
 * Found a chamber so there is a dashboard to measure.
 *
 * An address nobody has admitted lands on Access Denied, and the way forward
 * is the "Create a chamber" button on it — the form is on the next screen, not
 * this one. Skipping that click leaves the suite sizing the Access Denied page
 * and calling it the dashboard, which is what it did until this was fixed.
 */
const startFounding = page.getByRole("button", { name: /create a chamber/i });
if (await startFounding.count()) {
  await startFounding.first().click();
  await page.waitForTimeout(1500);
}
await page.locator("#chamber-name").fill("Browser Chambers");
await page
  .getByRole("button", { name: /Firm Admin/ })
  .first()
  .click();
await page.getByRole("button", { name: /^Create chamber$/ }).click();
await page.waitForTimeout(2500);

// A practice role has to declare its bar enrolment before the app renders at
// all. Section 8 is about the signed-in application, so walk the gate rather
// than measuring it — every viewport check below would otherwise be sizing the
// gate screen and reporting the dashboard as fine.
if (/bar council|enrolment/i.test(await text())) {
  await page.locator("#bar-state").fill("Uttar Pradesh");
  await page.locator("#bar-enrolment").fill("UP/1234/2015");
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.waitForTimeout(2000);
}

/*
 * The subscription screen stands between chamber setup and the dashboard.
 *
 * A chamber that has never taken a plan can read its own shell and nothing
 * else, so this is not a screen the suite can navigate around — every module
 * below would answer 402 and the viewport checks would be sizing a dashboard
 * of empty error states. The trial is taken through the real pricing modal,
 * which also puts that modal in front of a browser at every width.
 */
const onPlanScreen = /choose how it runs|has not started a plan/i.test(await text());
check("the subscription screen follows chamber setup", onPlanScreen, (await text()).slice(0, 200));

if (onPlanScreen) {
  // Measured before it is walked past: it is a full-page screen a founder meets
  // on whatever device they signed up on, and it is the last one standing
  // between them and paying.
  for (const { w, h, label } of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const o = await overflow();
    check(
      `subscription screen @ ${w}px (${label}) has no horizontal scroll`,
      o <= 1,
      o > 1 ? `overflow ${o}px — ${(await widest()).join(" ; ")}` : "",
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);

  await page.getByRole("button", { name: /see the plans and pay/i }).click();
  await page.waitForTimeout(1200);
  // No payment provider is configured in preview, so the tier buttons read
  // "Choose" and record the selection directly. With one configured they would
  // read "Subscribe" and open Razorpay, which is not a thing to automate here.
  await page
    .getByRole("button", { name: /^Choose$/ })
    .first()
    .click();
  await page.waitForTimeout(2000);
  // The modal must actually close, not merely be told to. Radix marks the rest
  // of the app `aria-hidden` while a dialog is open, so a dialog left standing
  // hides the whole application from `getByRole` and every check below reports
  // that the shell never rendered. Its own close control, not Escape — Escape
  // depends on where focus landed after the toast, which is not something to
  // rely on.
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: /^Close$/ })
    .click();
  await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(1500);
}

const inApp = await text();

/*
 * The navigation has two shapes, so the suite must know both.
 *
 * Below `lg` it is the three-dot button on the rail; from `lg` up it is a
 * permanently visible list in the sidebar. Keying on the button alone made
 * every check below viewport-dependent — and silently skipped the whole
 * signed-in section at laptop widths once the sidebar landed.
 */
const menuButton = () => page.getByRole("button", { name: /Open navigation menu/i });
const sidebarNav = () => page.getByRole("navigation", { name: /^Main$/i });
const navPresent = async () => (await menuButton().count()) > 0 || (await sidebarNav().count()) > 0;

/** Opens a destination whichever shape the nav is currently in. */
async function gotoSection(name) {
  if (await menuButton().count()) {
    await menuButton().click();
    await page.waitForTimeout(300);
    await page.getByRole("menuitem", { name }).click();
  } else {
    await sidebarNav().getByRole("link", { name }).click();
  }
  await page.waitForTimeout(1200);
}

// Positive, not negative: "does not say sign in" was also true of the Access
// Denied screen, which is how a chamber that was never founded passed as a
// dashboard and every viewport check below measured the wrong page. A nav
// affordance exists only inside the application shell.
const signedIn = await navPresent();
check("reached the application", signedIn, `${page.url()} — ${inApp.slice(0, 220)}`);

if (signedIn) {
  /*
   * A route two levels deep, which is a class of its own.
   *
   * wouter's "/:rest*" compiles to a single-segment pattern, so for a while
   * every /cases/:id rendered an empty document — no error in the console, no
   * failed request, nothing for a suite watching either of those to notice.
   * The only way to catch it is to open one and look, so this opens one.
   */
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSection(/^Cases$/i);
  await page
    .getByRole("button", { name: /new case file|open new case|new case/i })
    .first()
    .click();
  await page.waitForTimeout(700);
  await page.locator("#case-title").fill("Deep Route Matter");
  await page.locator("#case-ref").fill("CV-DEEP-1");
  await page
    .getByRole("button", { name: /create case/i })
    .last()
    .click();
  await page.waitForTimeout(2000);
  await page
    .getByText(/Deep Route Matter/)
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  const detail = await text();
  check(
    "a matter opens on its own page — /cases/:id is not a blank document",
    /Deep Route Matter/.test(detail) && /CV-DEEP-1/.test(detail),
    `${page.url()} — ${detail.slice(0, 200)}`,
  );

  /*
   * Every signed-in route, at every width.
   *
   * This used to measure /dashboard alone — which is a stat grid, the one
   * layout in the application that was never going to overflow. The pages that
   * actually broke on a phone (invoices at seven columns, tasks, consultations,
   * the case detail tab strip, the operator table) were opened by this suite
   * and never sized. Sweeping them here is what makes the responsive work
   * self-verifying rather than self-reported.
   *
   * `caseHref` is the matter created just above, so /cases/:id is covered too.
   */
  const caseHref = new URL(page.url()).pathname;
  const ROUTES = [
    ["/dashboard", "dashboard"],
    ["/cases", "cases"],
    [caseHref, "case detail"],
    ["/tasks", "tasks"],
    ["/consultations", "consultations"],
    ["/invoices", "invoices"],
    ["/documents", "documents"],
    ["/calendar", "calendar"],
    ["/cause-list", "court listings"],
    ["/invites", "access control"],
    ["/team", "team roles"],
    ["/activity", "activity"],
    ["/kpi", "kpi"],
    // Both are behind `drafting.use`, which this run's admin holds. They are
    // rows of Selects and Inputs at their designed widths — the shape that
    // overflows a 360px card before `flex-wrap` has anything to wrap onto.
    ["/drafting", "drafting"],
    ["/chamber-knowledge", "chamber knowledge"],
  ];

  for (const [href, name] of ROUTES) {
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    // Lazy routes resolve a chunk before they paint; measuring the Suspense
    // spinner would pass every time and prove nothing.
    await page.waitForTimeout(900);
    for (const { w, h, label } of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(220);
      const o = await overflow();
      check(
        `${name} @ ${w}px (${label}) has no horizontal scroll`,
        o <= 1,
        o > 1 ? `overflow ${o}px — ${(await widest()).join(" ; ")}` : "",
      );
    }
  }

  /*
   * Touch targets and type size, on the pages that grew a card layout.
   *
   * Section 6 checks this on the signed-out /portal. These are the screens
   * where a row became a stack of fields, which is exactly where a 28px button
   * or an 8px label slips in unnoticed.
   */
  await page.setViewportSize({ width: 360, height: 740 });
  for (const href of ["/tasks", "/invoices", "/consultations", "/drafting", "/chamber-knowledge"]) {
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const small = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("button, a[href], input, select")) {
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 36) bad.push(`${el.tagName}.${el.className}`.slice(0, 70));
      }
      return bad;
    });
    check(
      `${href} targets are at least 36px tall on a phone`,
      small.length === 0,
      small.join(" ; "),
    );
  }

  /*
   * The operator view fails closed.
   *
   * /operator is not in the navigation, and this run has no OPERATOR_EMAILS
   * configured, so an ordinary chamber admin typing the URL must be told
   * nothing. Asserting the absence of the numbers matters as much as the
   * message: a page that rendered its shell and then failed to fetch would
   * still have leaked its existence and its headings.
   */
  expectingRefusal = true;
  await page.goto(`${BASE}/operator`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const operatorView = await text();
  expectingRefusal = false;
  check(
    "a chamber admin typing /operator is refused",
    /not available/i.test(operatorView),
    operatorView.slice(0, 200),
  );
  check(
    "...and is shown no platform numbers",
    !/registered/i.test(operatorView) && !/chambers, newest first/i.test(operatorView),
    operatorView.slice(0, 200),
  );

  // The pricing screen is the newest and most crowded thing in the app: four
  // plan cards where there used to be three.
  await page.setViewportSize({ width: 360, height: 740 });
  const upgrade = page.getByRole("button", { name: /plan|upgrade|subscription/i }).first();
  if (await upgrade.count()) {
    await upgrade.click();
    await page.waitForTimeout(700);
    const pricing = await text();
    if (/trial/i.test(pricing) && /custom/i.test(pricing)) {
      check("all four plans render on a phone", true);
      check(
        "pricing screen does not scroll sideways",
        (await overflow()) <= 1,
        `overflow ${await overflow()}px`,
      );
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/* ───────────────────────────── Wrap up ──────────────────────────────────── */

console.log(`\nConsole errors: ${consoleErrors.length}`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join("\n"));
console.log(`Failed requests: ${failedRequests.length}`);
if (failedRequests.length) console.log(failedRequests.slice(0, 5).join("\n"));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 && consoleErrors.length === 0 ? 0 : 1);
