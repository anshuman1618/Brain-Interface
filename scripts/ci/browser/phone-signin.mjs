/*
 * Signing in with a mobile number, through the real UI.
 *
 * The API suite (scripts/ci/suites/phone-identity.mjs) proves the server admits
 * a number. This proves a person can actually get there: that the option is
 * offered, that the field is a `tel` input so a handset shows its keypad, that
 * the flow is still passwordless, and that a phone-only founder lands on a
 * dashboard rather than the Access Denied screen the old email-keyed code would
 * have sent them to.
 *
 * Runs against a PREVIEW build, where no code is actually sent — the same
 * arrangement portal.mjs uses.
 *
 *   BASE_URL=http://localhost:5000 node scripts/ci/browser/phone-signin.mjs
 */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:5000";
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM ?? undefined;
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${d}`));
};

await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
const text = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

check("the mobile option is offered", /Continue with mobile/i.test(await text()));

await page.getByRole("button", { name: /Continue with mobile/i }).click();
await page.waitForTimeout(500);
check("the field asks for a mobile number", /Mobile number/i.test(await text()));
const tel = page.locator('input[type="tel"]');
check("the input is a tel field, so a phone shows the keypad", (await tel.count()) > 0);
check(
  "no password field appears on the mobile route",
  (await page.locator('input[type="password"]').count()) === 0,
);

const number = `98765${String(Date.now()).slice(-5)}`;
await tel.fill(number);
await page.locator("input").nth(1).fill("Mobile Founder");
await page.getByRole("button", { name: /^Continue$/ }).click();
await page.waitForTimeout(2000);

const after = await text();
check("signing in by number reaches the app", /chamber/i.test(after), after.slice(0, 200));

// Found a chamber, then confirm the number carried through as the identity.
const found = page.getByRole("button", { name: /create a chamber/i });
if (await found.count()) {
  await found.first().click();
  await page.waitForTimeout(700);
  await page.locator("#chamber-name").fill("Mobile Chambers");
  const admin = page.getByText(/Firm Admin/i).first();
  if (await admin.count()) await admin.click();
  await page
    .getByRole("button", { name: /create chamber/i })
    .last()
    .click();
  await page.waitForTimeout(2500);
  const gate = await text();
  if (/bar council|enrolment/i.test(gate)) {
    await page.locator("#bar-state").fill("Bar Council of Delhi");
    await page.locator("#bar-enrolment").fill("D/1234/2020");
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForTimeout(2500);
  }
}
const inApp =
  (await page.getByRole("button", { name: /Open navigation menu/i }).count()) > 0 ||
  (await page.getByRole("navigation", { name: /^Main$/i }).count()) > 0;
check("a phone-only founder reaches the dashboard", inApp, (await text()).slice(0, 200));

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("the signed-in app fits a 390px phone", overflow <= 1, `overflow ${overflow}px`);

console.log(`\nPage errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join("\n"));
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
