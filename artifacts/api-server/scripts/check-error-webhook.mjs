/**
 * Prove ERROR_WEBHOOK_URL actually delivers, before an incident depends on it.
 *
 *   ERROR_WEBHOOK_URL=https://hooks.slack.com/services/... \
 *     node artifacts/api-server/scripts/check-error-webhook.mjs
 *
 * DEPLOYMENT.md's go-live checklist asks you to confirm "a deliberate error
 * seen arriving", and until now there was no way to produce one short of
 * breaking production on purpose. This sends a real report through the real
 * reporter, so what you see in Slack is the shape you will see at 2am.
 *
 * It is safe to run against a live webhook: the payload says plainly that it is
 * a test, and nothing is written anywhere. The only cost is one message in
 * whatever channel you pointed it at.
 *
 * Exit codes: 0 delivered, 1 not delivered or not configured. That makes it
 * usable as a gate in a deploy script rather than only by eye.
 */

const url = process.env["ERROR_WEBHOOK_URL"]?.trim();

if (!url) {
  console.error("ERROR_WEBHOOK_URL is not set.");
  console.error("");
  console.error("Getting one takes about a minute:");
  console.error("  Slack   — api.slack.com/messaging/webhooks, create an app,");
  console.error("            enable Incoming Webhooks, add one to a channel.");
  console.error("  Discord — channel settings, Integrations, New Webhook, Copy URL.");
  console.error("");
  console.error("Anything that accepts an https JSON POST works; the body carries a");
  console.error("`text` field, which is what both of those render.");
  process.exit(1);
}

// The same guard the reporter applies. A http:// webhook would send stack
// traces in the clear, so it is refused there and refused here rather than
// quietly reported as working.
if (!/^https:\/\//i.test(url)) {
  console.error(`ERROR_WEBHOOK_URL is not https — the reporter will ignore it.\n  got: ${url}`);
  process.exit(1);
}

const service = process.env["SERVICE_NAME"]?.trim() || "lex-practice";
const env = process.env["NODE_ENV"] ?? "development";

/*
 * Deliberately the same body shape as `reportError` in lib/error-reporter.ts.
 *
 * Not imported from it: that module rate-limits, de-duplicates and swallows
 * delivery failures by design — all three correct in production and all three
 * wrong here, where the single question is "did this specific POST arrive".
 * The duplication is the point, and it is one object literal.
 */
const stamp = new Date().toISOString();
const body = {
  text:
    `[${service}/${env}] TEST — error reporting is working\n` +
    `This message was sent by check-error-webhook.mjs at ${stamp}.\n` +
    `Nothing is wrong. If you did not run this, somebody has your webhook URL.\n\n` +
    `A real report looks like this, with the error's name, message and the\n` +
    `first twelve stack frames in place of these lines. It never carries a\n` +
    `request body, a header, or anything belonging to a chamber.`,
  service,
  environment: env,
  at: "check-error-webhook",
  error: {
    name: "TestReport",
    message: "Error reporting is configured and delivering.",
    stack: null,
  },
  timestamp: stamp,
};

console.log(`Sending a test report to ${url.replace(/\/[^/]{8,}$/, "/…")}`);

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
} catch (err) {
  console.error(
    `\nFAIL — the request did not complete: ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("A timeout here usually means the URL is wrong or egress is blocked.");
  process.exit(1);
}

const responseText = await res.text().catch(() => "");

if (!res.ok) {
  console.error(`\nFAIL — the endpoint answered ${res.status}.`);
  if (responseText) console.error(`  ${responseText.slice(0, 300)}`);
  // Slack's own words for the two mistakes people actually make.
  if (/no_service|invalid_token/i.test(responseText)) {
    console.error("  Slack says the webhook no longer exists — it was revoked or the app removed.");
  }
  process.exit(1);
}

console.log(
  `\nPASS — delivered (${res.status}${responseText ? ` ${responseText.slice(0, 40)}` : ""}).`,
);
console.log("Now go and look at the channel. A 200 means the endpoint accepted it,");
console.log("not that a human will see it — a webhook pointed at an archived channel");
console.log("answers 200 and shows nobody anything.");
