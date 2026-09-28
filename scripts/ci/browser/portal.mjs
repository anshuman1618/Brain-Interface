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
/*
 * A console error says only "Failed to load resource: 402" — not which one.
 * That is enough to fail the suite and not enough to fix it, which cost a
 * debugging round the first time a stray 402 appeared. Recording the URL and
 * status alongside makes the next one self-explaining.
 */
const refusedResponses = [];
page.on("response", (r) => {
  if (r.status() >= 400 && r.url().includes("/api/")) {
    refusedResponses.push(
      `${r.status()} ${r.url().replace(BASE, "")}${expectingRefusal ? "  (expected)" : ""}`,
    );
  }
});

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

/*
 * The tab icon, which was a plain #FF3C00 rounded square — Replit scaffolding
 * that survived every other cleanup because nothing in the product renders it.
 * Three things are worth pinning and none of them is how it looks:
 *
 *   - it PARSES. The first version of the replacement had a double hyphen
 *     inside its XML comment, which is illegal and made the whole file render
 *     as a missing image at every size. Nothing would have said so.
 *   - it is the LEX mark, not the scaffolding colour.
 *   - it is not drawn with currentColor, which resolves to black outside a
 *     document and is why public/logo.svg cannot serve as one.
 */
const faviconHref = await page.getAttribute('link[rel="icon"][type="image/svg+xml"]', "href");
const favicon = await page.request.get(new URL(faviconHref ?? "/favicon.svg", BASE).href);
const faviconSvg = await favicon.text();
check("the tab icon is served", favicon.status() === 200, `status ${favicon.status()}`);
check(
  "...and is valid XML, not a silently broken file",
  await page.evaluate(
    (s) =>
      !new DOMParser().parseFromString(s, "image/svg+xml").querySelector("parsererror") &&
      new DOMParser().parseFromString(s, "image/svg+xml").documentElement.tagName === "svg",
    faviconSvg,
  ),
);
check("...and carries the LEX mark", /<text[^>]*>\s*LEX\s*<\/text>/.test(faviconSvg));
// The DRAWING, not the prose. The file's header explains what it replaced and
// why logo.svg cannot serve as a favicon, so it names both #FF3C00 and
// currentColor in a comment — and the first version of this check read that
// explanation as the thing it was warning about.
const faviconDrawing = faviconSvg.replace(/<!--[\s\S]*?-->/g, "");
check(
  "...and none of the scaffolding is left in what it draws",
  !/FF3C00/i.test(faviconDrawing) && !/currentColor/.test(faviconDrawing),
  faviconDrawing.slice(0, 160),
);

/*
 * The rasters, because the SVG alone left the tab blank on a phone.
 *
 * Safari supports no SVG favicon — not on macOS, not on iOS — and the SVG was
 * the only icon declared. There was nothing to fall back to, and /favicon.ico
 * and /apple-touch-icon.png did not exist, so the SPA catch-all answered both
 * with index.html: 2.6 KB of markup, at status 200, to a request for an image.
 * A browser cannot report that as a failure, which is why it went unnoticed
 * through a deploy and a redeploy.
 */
for (const [href, type] of [
  ["/favicon.ico", /^image\/(vnd\.microsoft\.icon|x-icon)$/],
  ["/favicon-32.png", /^image\/png$/],
  ["/apple-touch-icon.png", /^image\/png$/],
]) {
  check(
    `${href} is declared in the document`,
    (await page.locator(`link[href="${href}"]`).count()) > 0,
  );
  const res = await page.request.get(new URL(href, BASE).href);
  const ctype = (res.headers()["content-type"] ?? "").split(";")[0].trim();
  check(
    `...and ${href} is served as an image, not as the SPA`,
    res.status() === 200 && type.test(ctype),
    `status ${res.status()}, content-type ${ctype}`,
  );
}

/*
 * A missing file must 404, not be answered with the application.
 *
 * This is the general form of the bug above: `express.static` misses, the
 * fallback runs, and every non-/api GET got index.html — so a typo'd asset
 * URL returned a success carrying the wrong content type rather than
 * something a browser or a log could act on.
 */
const missing = await page.request.get(new URL("/definitely-not-here.png", BASE).href);
check(
  "a missing asset 404s rather than returning the SPA",
  missing.status() === 404,
  `status ${missing.status()}, content-type ${missing.headers()["content-type"]}`,
);
check(
  "...while a client route still serves the application",
  (await page.request.get(new URL("/cases/12", BASE).href)).status() === 200,
);

/*
 * Cache headers, which are the reason a corrected icon can fail to ship.
 *
 * Every file in the build directory was served `immutable` for a year. That
 * is right for Vite's fingerprinted bundles, where a changed file is a changed
 * URL, and wrong for everything else here: favicon.svg keeps its name, so
 * `immutable` promised browsers the red square would never change and
 * entitled them to skip revalidating it. Replacing the file shipped something
 * nobody would fetch.
 */
const iconCache = (await page.request.get(new URL("/favicon.svg", BASE).href)).headers()[
  "cache-control"
];
check(
  "the unfingerprinted icon is revalidated, not immutable",
  !/immutable/.test(iconCache ?? ""),
  `cache-control: ${iconCache}`,
);
const bundleHref = await page.getAttribute('script[src*="/assets/"]', "src");
const bundleCache = (await page.request.get(new URL(bundleHref ?? "/", BASE).href)).headers()[
  "cache-control"
];
check(
  "...while a fingerprinted bundle still is immutable",
  /immutable/.test(bundleCache ?? ""),
  `cache-control: ${bundleCache}`,
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
  ["summary", /data usage summary/i],
  ["disclosure", /responsible disclosure policy/i],
]) {
  const res = await page.goto(`${BASE}/legal/${slug}`, { waitUntil: "domcontentloaded" });
  const body = await text();
  check(
    `/legal/${slug} serves a document`,
    res?.status() === 200 && expect.test(body),
    `status ${res?.status()}`,
  );

  /*
   * The deployment claims these pages make, checked against the deployment.
   *
   * Register item 0.5 is this coupling failing twice. The web service moved
   * off Render's free plan on 25 September 2026 and stopped sleeping when
   * idle; Terms §8, the Data Usage Summary and two passages in the legal
   * README went on saying it slept — including Terms §8 wording written that
   * same day, by someone holding the coupling list that named it.
   *
   * The register's own conclusion is that a lesson which has to be remembered
   * is not a control, so this is the control. It is deliberately a check on a
   * SERVED page rather than on the markdown: what a chamber reads is what
   * matters, and `LEGAL_DOCS_DIR` means the file on disk is not always it.
   *
   * If the service ever goes back on a sleeping plan, this is the assertion to
   * delete — along with the same sentence in the two documents.
   *
   * `routes/legal.ts` caches each rendered page in process for the lifetime of
   * the server, so a server started BEFORE a document was edited serves the
   * old text and this check passes against a file that no longer says what it
   * is reading. Restart between editing a legal document and running this.
   */
  // Affirmative claims only. Both documents now say what USED to be true —
  // "the application no longer sleeps", "it used to sleep when idle" — and a
  // pattern loose enough to catch a stale claim catches its own correction
  // too, which is how the first version of this check failed on the fix.
  const stillClaimsSleep = [
    /\bapplication sleeps\b/i,
    /\bsleeps when idle\b/i,
    /puts the application to sleep\b/i,
    /first request after an idle period takes\b/i,
  ].find((re) => re.test(body));
  check(
    `...and /legal/${slug} does not claim the application sleeps`,
    !stillClaimsSleep,
    stillClaimsSleep ? (body.match(stillClaimsSleep)?.[0] ?? "") : "",
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

// Terms §5 sends a security researcher to /legal/disclosure for the permission
// to look at all, so that page has to answer to somebody with no account. The
// footer is where they will look for it.
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
check(
  "the landing footer offers the disclosure policy",
  (await page.locator('a[href="/legal/disclosure"]').count()) > 0,
);
check(
  "...and the data usage summary",
  (await page.locator('a[href="/legal/summary"]').count()) > 0,
);

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
/*
 * The paid-gate window opens HERE, not at the plan screen below.
 *
 * A chamber exists from the moment it is founded and has no plan until the
 * trial is taken, and the application shell renders in between — the bar gate,
 * and briefly the dashboard behind it. Anything plan-gated that mounts in that
 * span answers 402 correctly, and `/api/ai/budget` does. Opening the window at
 * the plan screen left that one request outside it, which failed the suite with
 * "0 failed" and a console error naming no URL.
 */
expectingRefusal = true;

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
/*
 * (The suppression window opened earlier — see the note above the founding
 * block. Kept here for the explanation.)
 *
 * The 402s from here to the moment the trial is taken are the paid gate doing
 * its job, not a fault.
 *
 * A chamber with no plan gets 402 from every module endpoint, and the browser
 * logs each one as "Failed to load resource" — a console error like any other.
 * The suite exits non-zero on console errors, so it reported "0 failed" and
 * still exited 1, which is the shape of result that teaches people to stop
 * reading it. Suppressed for exactly this window, using the same flag the
 * operator check uses, rather than by filtering 402 everywhere — an
 * unexpected 402 after a plan is in force is a real bug and must still be seen.
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

// The plan is in force from here on, so any refusal after this point is real.
expectingRefusal = false;

const inApp = await text();
// Positive, not negative: "does not say sign in" was also true of the Access
// Denied screen, which is how a chamber that was never founded passed as a
// dashboard and every viewport check below measured the wrong page.
//
// The landmark is the main nav, not the menu button. Navigation used to be a
// dropdown behind "Open navigation menu" at every width; it is now a permanent
// labelled sidebar from lg up, and that button exists only below lg. Anchoring
// on the button therefore made this check pass or fail on viewport width — it
// failed here at 1280px against a perfectly working dashboard. `nav[aria-
// label="Main"]` is rendered by the sidebar and by the slide-over alike.
const signedIn =
  (await page.locator('nav[aria-label="Main"]').count()) > 0 ||
  (await page.getByRole("button", { name: /Open navigation menu/i }).count()) > 0;
check("reached the application", signedIn, `${page.url()} — ${inApp.slice(0, 220)}`);

/*
 * The salutation, which for a long time read "Good evening, User".
 *
 * `greet()` was never the bug — the stored name was the literal string "User",
 * written by `identityFromClerk` whenever the passwordless provider had no
 * first or last name, which with email one-time codes is almost everybody.
 * This session signed in as "B Founder", so the heading proves three things at
 * once: the name reaches the claim, the greeting uses it, and it uses only the
 * FIRST word of it.
 */
check(
  "the dashboard greets by first name",
  /Good (morning|afternoon|evening), B\b/.test(inApp),
  inApp.slice(0, 160),
);
check(
  "...and never by the placeholder that used to be stored",
  !/Good (morning|afternoon|evening), User\b/.test(inApp),
  "the name is a placeholder, not the person",
);
check(
  "...so nothing offers to add a name that is already there",
  !/add your name/i.test(inApp),
  inApp.slice(0, 160),
);

if (signedIn) {
  for (const { w, h, label } of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    const o = await overflow();
    if (o > 1) {
      check(
        `dashboard @ ${w}px (${label}) has no horizontal scroll`,
        false,
        `overflow ${o}px — ${(await widest()).join(" ; ")}`,
      );
    } else {
      check(`dashboard @ ${w}px (${label}) has no horizontal scroll`, true);
    }
  }

  /*
   * A route two levels deep, which is a class of its own.
   *
   * wouter's "/:rest*" compiles to a single-segment pattern, so for a while
   * every /cases/:id rendered an empty document — no error in the console, no
   * failed request, nothing for a suite watching either of those to notice.
   * The only way to catch it is to open one and look, so this opens one.
   */
  await page.setViewportSize({ width: 1280, height: 800 });
  // At 1280 the sidebar is on screen and its links are ordinary anchors, so
  // there is nothing to open first and no menuitem role to match. Scoped to the
  // nav so "Cases" here cannot accidentally match a heading or a card on the
  // dashboard behind it.
  await page
    .locator('nav[aria-label="Main"]')
    .getByRole("link", { name: /^Cases$/ })
    .click();
  await page.waitForTimeout(1200);
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
   * The vault files under the stages of the matter.
   *
   * The API suites prove the stage is stored and validated; none of them can
   * prove a heading appears, and a heading nobody sees is the whole feature.
   * So this walks it: open the vault, add a record under a stage, and read the
   * heading back off the page.
   *
   * "Deep Route Matter" was opened with no case type, so its forum group is
   * inferred as `general` and its list is the advisory one — "Filed papers",
   * not "Counter affidavit". Picking a stage the list actually offers is the
   * point; a writ heading here would fail for the right reason and read like
   * the wrong one.
   */
  await page.getByRole("tab", { name: /encrypted vault/i }).click();
  await page.waitForTimeout(600);
  await page
    .getByRole("button", { name: /^upload$/i })
    .first()
    .click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder(/Discovery_Motion/i).fill("Brief to counsel.pdf");
  // The stage select, by its label rather than its position: the dialog has two
  // controls and the other one is a plain text input.
  await page.getByRole("combobox").first().click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: /^Filed papers$/ }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole("button", { name: /add record/i })
    .last()
    .click();
  await page.waitForTimeout(1800);
  const vault = await text();
  check(
    "the vault files a paper under a stage of the matter",
    /Filed papers/.test(vault) && /Brief to counsel\.pdf/.test(vault),
    vault.slice(0, 400),
  );
  check(
    "...and does not show the stages nothing is filed under",
    !/Instructions and brief/.test(vault),
    "an eight-heading list with papers under one reads as a broken screen",
  );

  /*
   * The operator view fails closed.
   *
   * /operator is not in the navigation, and this run has no OPERATOR_EMAILS
   * configured, so an ordinary chamber admin typing the URL must be told
   * nothing. Asserting the absence of the numbers matters as much as the
   * message: a page that rendered its shell and then failed to fetch would
   * still have leaked its existence and its headings.
   */
  /*
   * AI drafting has to be reachable from inside the product.
   *
   * The whole feature shipped unreachable once: `drafting_enabled` defaults to
   * false, only an admin can flip it, and no screen called the endpoint. Every
   * API suite passed, because they all set the flag by calling the route
   * directly — which is exactly the thing a human cannot do. So this walks the
   * path a person walks: open Drafting, find it switched off, and get it on
   * without leaving the UI.
   */
  // The dashboard has to SAY that AI exists and is off. It shipped reachable
  // only through a tile called "Draft a Document" and two entries behind the
  // three-dot menu, and a chamber admin reasonably concluded it had not
  // shipped at all.
  //
  // The three notices now live behind a strip that opens on click, so this
  // opens it — the notice being one click away rather than always on screen is
  // the deliberate trade, and the assertion is that it is THERE, not that it is
  // unavoidable. What is still unavoidable is the sidebar's "Drafting" entry
  // and the "Draft with AI" tile, both checked below.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const strip = page.getByRole("button", { name: /things? needs? your attention/i });
  if (await strip.count()) {
    await strip.first().click();
    await page.waitForTimeout(400);
  }
  const dash = await text();
  check(
    "...and the Draft with AI tile is on the dashboard without opening anything",
    /draft with ai/i.test(dash),
    dash.slice(0, 160),
  );
  check(
    "the dashboard says AI drafting is available and switched off",
    /ai drafting is available/i.test(dash),
    dash.slice(0, 240),
  );

  await page.goto(`${BASE}/drafting`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const draftingOff = await text();
  check(
    "an admin who opens Drafting is told it is switched off",
    /not switched on/i.test(draftingOff),
    draftingOff.slice(0, 200),
  );

  const switchItOn = page.getByRole("button", { name: /switch it on/i });
  check("...and is offered a way to switch it on", (await switchItOn.count()) > 0);
  if (await switchItOn.count()) {
    await switchItOn.first().click();
    await page.waitForTimeout(1200);
    // The acknowledgement gates the button: it has to be read before the
    // chamber can start sending client material to a model.
    await page.getByRole("checkbox", { name: /read what is sent/i }).click();
    await page.getByRole("button", { name: /switch ai drafting on/i }).click();
    await page.waitForTimeout(2000);
    await page
      .locator('[role="dialog"]')
      .getByRole("button", { name: /^Close$/ })
      .click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 10_000 });
    await page.goto(`${BASE}/drafting`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const draftingOn = await text();
    check(
      "AI drafting is on, reached entirely through the UI",
      !/not switched on/i.test(draftingOn),
      draftingOn.slice(0, 200),
    );
  }

  /*
   * AI analysis has to be reachable FROM a matter.
   *
   * The brief was only on the Drafting page, behind a matter dropdown — so the
   * moment you actually want a matter analysed, while looking at it, there was
   * nothing to click. `/drafting/:caseId` accepted a matter in the URL the
   * whole time and nothing linked to it.
   */
  const firstCase = await page.goto(`${BASE}/cases`, { waitUntil: "networkidle" });
  void firstCase;
  await page.waitForTimeout(1200);
  const caseLink = page.locator('a[href^="/cases/"]').first();
  if (await caseLink.count()) {
    await caseLink.click();
    await page.waitForTimeout(1500);
    const analyse = page.getByRole("button", { name: /analyse this matter/i });
    check("a matter offers AI analysis of itself", (await analyse.count()) > 0, page.url());
    if (await analyse.count()) {
      await analyse.first().click();
      await page.waitForTimeout(1500);
      check(
        "...which opens the analysis with that matter already chosen",
        /\/drafting\/\d+/.test(page.url()),
        page.url(),
      );
    }
  }

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

/* ──────────────────── A finger has to be able to scroll ─────────────────── */

/*
 * The page must scroll when dragged, not only when the scrollbar is grabbed.
 *
 * It did not, and the cause was subtle enough to be worth a guard rather than a
 * fix and a hope. Two elements declared `overflow` and never scrolled: the main
 * content pane (the shell is `min-h-screen`, so it grows and the DOCUMENT
 * scrolls) and the wrapper around every table. `overflow: auto` makes an
 * element a scroll container whether or not there is anything to scroll, and a
 * blanket `overscroll-behavior: contain` in index.css then told both of them
 * to refuse to hand the gesture on. Chromium passes it through anyway; WebKit
 * and several Android WebViews do not — so the app scrolled fine on the machine
 * it was built on and not on the phone it was used on.
 *
 * The assertion is therefore STRUCTURAL, not behavioural: only Chromium is
 * installed here, and a Chromium swipe passed even while the bug was live. What
 * is checked is that nothing on the path from the finger to the page is a
 * scroll container with nothing to scroll AND a refusal to chain. A dead-end
 * container with `overscroll-behavior: auto` is fine and expected — the table
 * wrapper is one, because `overflow-x: auto` forces `overflow-y` to compute to
 * `auto` and it cannot be made horizontal-only.
 */
section("11. A finger scrolls the page, not just the scrollbar");

const touchCtx = await browser.newContext({
  viewport: { width: 412, height: 839 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const touchPage = await touchCtx.newPage();
const cdp = await touchCtx.newCDPSession(touchPage);

// Same session the rest of the suite built, so there is a chamber to look at.
await touchPage.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
await touchPage.getByRole("button", { name: /Continue with email/i }).click();
await touchPage.waitForTimeout(400);
await touchPage.locator('input[type="email"]').fill(`touch${Date.now()}@chambers.test`);
await touchPage.locator("input").nth(1).fill("Touch Tester");
await touchPage.getByRole("button", { name: /^Continue$/ }).click();
await touchPage.waitForTimeout(1800);

const startTouch = touchPage.getByRole("button", { name: /create a chamber/i });
if (await startTouch.count()) {
  await startTouch.first().click();
  await touchPage.waitForTimeout(1500);
}
if ((await touchPage.locator("#chamber-name").count()) > 0) {
  await touchPage.locator("#chamber-name").fill("Touch Chambers");
  await touchPage
    .getByRole("button", { name: /Firm Admin/ })
    .first()
    .click();
  await touchPage.getByRole("button", { name: /^Create chamber$/ }).click();
  await touchPage.waitForTimeout(2500);
}
if (/bar council|enrolment/i.test(await touchPage.innerText("body"))) {
  await touchPage.locator("#bar-state").fill("Uttar Pradesh");
  await touchPage.locator("#bar-enrolment").fill("UP/1234/2015");
  await touchPage.getByRole("button", { name: /^Continue$/ }).click();
  await touchPage.waitForTimeout(2000);
}
const touchPlans = touchPage.getByRole("button", { name: /see the plans and pay/i });
if (await touchPlans.count()) {
  await touchPlans.first().click();
  await touchPage.waitForTimeout(1200);
  const pick = touchPage.getByRole("button", { name: /^Choose$/ });
  if (await pick.count()) {
    await pick.first().click();
    await touchPage.waitForTimeout(2000);
  }
  const shut = touchPage.getByRole("button", { name: /^Close$/ });
  if (await shut.count()) {
    await shut.first().click();
    await touchPage.waitForTimeout(1000);
  }
}

/** Scroll containers between a point and <html>, and whether each can move. */
const scrollChainAt = (x, y) =>
  touchPage.evaluate(
    ([px, py]) => {
      const out = [];
      let el = document.elementFromPoint(px, py);
      while (el && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if (["auto", "scroll", "overlay"].includes(s.overflowY)) {
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: (typeof el.className === "string" ? el.className : "").slice(0, 50),
            canScroll: el.scrollHeight - el.clientHeight > 1,
            overscrollY: s.overscrollBehaviorY,
          });
        }
        el = el.parentElement;
      }
      return {
        chain: out,
        doc: Math.round(document.scrollingElement.scrollTop),
        docScrollable:
          document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      };
    },
    [x, y],
  );

/** A real touch drag. Playwright's touchscreen only taps, so this goes via CDP. */
async function fingerDrag(x, y, dy) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (dy * i) / 10 }],
    });
    await touchPage.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touchPage.waitForTimeout(700);
}

// A page that fits on screen proves nothing about scrolling it, so make the
// register overflow first. The matters table is also the element that carried
// the second barrier, which is why /cases is the page under test.
for (let i = 1; i <= 8; i++) {
  await touchPage.goto(`${BASE}/cases`, { waitUntil: "networkidle" });
  await touchPage.waitForTimeout(900);
  await touchPage
    .getByRole("button", { name: /new case file|open new case|new case/i })
    .first()
    .click();
  await touchPage.waitForTimeout(700);
  await touchPage.locator("#case-title").fill(`Scroll fodder matter ${i}`);
  await touchPage.locator("#case-ref").fill(`CV-SCROLL-${i}`);
  await touchPage
    .getByRole("button", { name: /create case/i })
    .last()
    .click();
  await touchPage.waitForTimeout(1400);
}

// /calendar is on this list because react-big-calendar's grid is its own
// overflow container, which is exactly the shape that carried the barrier.
for (const path of ["/dashboard", "/cases", "/invites", "/calendar"]) {
  await touchPage.goto(BASE + path, { waitUntil: "networkidle" });
  await touchPage.waitForTimeout(2200);
  const x = 206;
  const y = 587; // 70% down a 839px viewport — over content, clear of the header

  const before = await scrollChainAt(x, y);
  const barriers = before.chain.filter((n) => !n.canScroll && n.overscrollY === "contain");
  check(
    `${path}: nothing between the finger and the page refuses to hand the gesture on`,
    barriers.length === 0,
    barriers.map((n) => `${n.tag}.${n.cls}`).join(" | "),
  );

  if (before.docScrollable > 40) {
    await fingerDrag(x, y, -280);
    const after = await scrollChainAt(x, y);
    check(
      `${path}: a finger-drag scrolls it (${before.docScrollable}px of page)`,
      after.doc > before.doc,
      `scrollTop ${before.doc} -> ${after.doc}`,
    );
  }
}

await touchCtx.close();

/* ──────────── A failed load must not read as an empty chamber ──────────── */

/*
 * The bug this proves absent: TanStack Query returns errors rather than
 * throwing, so `ErrorBoundary` never sees them and a page falls through to its
 * empty state. A chamber whose request failed was told "No matters yet" — that
 * its files were gone.
 *
 * Forced rather than waited for: the request is aborted at the network layer,
 * which is the one way to make a real failure happen on demand. Asserting BOTH
 * halves matters — that the error appears, and that the empty state does not,
 * because the bug was never a missing error message but an empty state
 * standing in for one.
 */
section("12. A failed request says so, and does not claim the chamber is empty");

// Counted, not just aborted. The retry policy is the other half of this
// section: a network fault is the one failure worth asking again about, and a
// refusal is not — see the QueryClient in App.tsx.
let listAttempts = 0;
const isCaseList = (route) => new URL(route.request().url()).pathname === "/api/cases";

await page.route("**/api/cases**", (route) => {
  if (isCaseList(route)) listAttempts++;
  return route.abort("failed");
});
await page.goto(`${BASE}/cases`, { waitUntil: "domcontentloaded" });
// A network fault retries twice with exponential backoff, so `isError` does
// not settle for a few seconds. Waiting less than that tests the loading
// state, not the error one.
await page.waitForTimeout(9000);
const failedText = await text();

check(
  "a failed matter list renders the failure",
  /could not load/i.test(failedText) && /try again/i.test(failedText),
  failedText.slice(0, 200),
);
check(
  "...and does NOT fall through to the empty state",
  !/no matters yet/i.test(failedText),
  "an empty state over a failed request tells a chamber its files are gone",
);
check(
  "a network fault is retried, and bounded at three attempts",
  listAttempts === 3,
  `attempts: ${listAttempts}`,
);

await page.unroute("**/api/cases**");

/*
 * A refusal is a final answer, and asking again does not change it.
 *
 * The default was three retries on everything, so a 403 took four round trips
 * and several seconds of backoff before the user was told they lack access —
 * and on 429 the retries pushed the limiter's reset further out, because the
 * limiters count refused requests too.
 */
let refusedAttempts = 0;
await page.route("**/api/cases**", (route) => {
  if (!isCaseList(route)) return route.continue();
  refusedAttempts++;
  return route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ error: "forbidden", message: "You do not have access to that." }),
  });
});
expectingRefusal = true;
await page.goto(`${BASE}/cases`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
check(
  "a refused matter list is asked for exactly once",
  refusedAttempts === 1,
  `attempts: ${refusedAttempts}`,
);
check(
  "...and the refusal is what the page shows",
  /could not load|do not have access/i.test(await text()),
  (await text()).slice(0, 200),
);
expectingRefusal = false;

await page.unroute("**/api/cases**");

/* ─────────── 13. The Cause List tab inside the Master Calendar ─────────── */

section("13. Cause List is a tab on the calendar, and the old URL still works");

await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const scheduleTab = page.getByRole("tab", { name: /^schedule$/i });
const listingsTab = page.getByRole("tab", { name: /cause list/i });
check(
  "the calendar shows both tabs",
  (await scheduleTab.count()) === 1 && (await listingsTab.count()) === 1,
);
check(
  "Schedule is the one selected on arrival",
  (await scheduleTab.getAttribute("aria-selected")) === "true",
);
// Radix unmounts inactive content, so the queue is genuinely absent until the
// tab is opened — that is the behaviour keeping it off the calendar's first
// paint, and it is worth pinning rather than assuming.
check("...and the listings queue has not loaded yet", !/awaiting a decision/i.test(await text()));

await listingsTab.click();
await page.waitForTimeout(1200);
const listingsText = await text();
check("opening the tab renders the proposals queue", /awaiting a decision/i.test(listingsText));
check(
  "...and says a proposal is not yet on the calendar",
  /until somebody accepts it/i.test(listingsText),
);
check(
  "...with no second page heading competing with Master Calendar",
  (await page.locator("h2", { hasText: /^(Court Listings|Cause List)$/ }).count()) === 0,
);

// The nav entry is gone, so a bookmark is the only way back — it has to land.
await page.goto(`${BASE}/cause-list`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
check(
  "/cause-list redirects to the calendar",
  new URL(page.url()).pathname === "/calendar",
  page.url(),
);
check(
  "the sidebar no longer offers a separate listings entry",
  (await page.locator('nav[aria-label="Main"] a[href="/cause-list"]').count()) === 0,
);

/* ──────────── 14. Every signed-in screen, at the narrowest phone ────────── */

/*
 * The sweep above measures the dashboard at every viewport. This measures every
 * page at the one viewport that actually breaks things.
 *
 * A one-off audit of all twenty-one screens at 360px found exactly two
 * offenders: the case page's tab strip, which had no overflow container in the
 * file at all and so dragged the whole document sideways, and the
 * Consultations header, which was the one page not using the app's
 * `flex-col sm:flex-row … gap-4` header pattern and pushed its "New
 * Consultation" button 63px past the edge. Both are fixed. This is the guard
 * that keeps them fixed, and catches the next page that forgets the pattern.
 *
 * 360px and not 375: it is the narrowest width in common use, and a layout that
 * holds there holds everywhere above it.
 */
section("14. No page scrolls sideways on a 360px phone");

await page.setViewportSize({ width: 360, height: 740 });
for (const path of [
  "/dashboard",
  "/cases",
  "/tasks",
  "/calendar",
  "/documents",
  "/invoices",
  "/time",
  "/consultations",
  "/team",
  "/invites",
  "/activity",
  "/governance",
]) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const o = await overflow();
  check(
    `${path} @ 360px has no horizontal scroll`,
    o <= 1,
    o > 1 ? `overflow ${o}px — ${(await widest()).join(" ; ")}` : "",
  );
}
await page.setViewportSize({ width: 1280, height: 800 });

/* ───────────────────────────── Wrap up ──────────────────────────────────── */

console.log(`\nConsole errors: ${consoleErrors.length}`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join("\n"));
console.log(`Failed requests: ${failedRequests.length}`);
if (failedRequests.length) console.log(failedRequests.slice(0, 5).join("\n"));
console.log(`Refused API responses: ${refusedResponses.length}`);
if (refusedResponses.length) console.log(refusedResponses.slice(0, 10).join("\n"));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 && consoleErrors.length === 0 ? 0 : 1);
