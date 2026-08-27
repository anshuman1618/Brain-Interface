// normalisePhone, and the preview identity token that carries a number.
//
// Offline: pure functions, no server, no database. They are worth testing on
// their own because every phone comparison in the product is a plain equality
// check against whatever this produces — if the normaliser and the caller
// disagree by one character, an admitted number silently matches nothing and
// the person is told to ask their admin for access they already have.

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
};
const section = (t) => console.log(`\n== ${t}`);

// Loaded straight from source: this module has no relative imports, so Node
// strips the types and resolves it without help. preview-mode.ts is NOT tested
// here — it reaches @workspace/db, whose barrel drags in `pg`, and bundling
// that for a string test is more machinery than the test is worth. The token
// forms it parses are exercised against the running server in
// `phone-admission.mjs`, which proves the same thing about the real code path.
const { normalisePhone } = await import(
  new URL("../../../lib/db/src/schema/workspace_access_list.ts", import.meta.url).pathname
);

/* ─────────────── One number, many spellings ─────────────── */
section("Every readable form of one number collapses to one E.164 string");

const SAME = [
  "+919876543210",
  "+91 98765 43210",
  "+91-98765-43210",
  "(+91) 98765-43210",
  "098765 43210",
  "9876543210",
  "0091 98765 43210",
  "  +91 9876543210  ",
];
for (const form of SAME) {
  check(
    `${JSON.stringify(form)} -> +919876543210`,
    normalisePhone(form) === "+919876543210",
    normalisePhone(form),
  );
}

check(
  "a number that already carries another country code keeps it",
  normalisePhone("+1 415 555 2671") === "+14155552671",
  normalisePhone("+1 415 555 2671"),
);

/* ─────────────── What is refused ─────────────── */
section("Anything unusable comes back empty rather than half-parsed");

for (const [input, why] of [
  ["", "empty"],
  ["   ", "whitespace"],
  ["abc", "letters"],
  ["12345", "too short"],
  ["+0123456789", "E.164 forbids a leading zero after the +"],
  ["+9198765432109876", "too long"],
]) {
  check(`${JSON.stringify(input)} is refused (${why})`, normalisePhone(input) === "");
}

// The failure this guards: a partial parse that returns something plausible is
// far worse than "", because it gets stored and then matches nothing forever.
check("no input ever yields a bare +", normalisePhone("+") === "");

/* ─────────────── The default country code is configurable ─────────────── */
section("The assumed country code is configuration, not a hardcoded +91");

const before = process.env.DEFAULT_COUNTRY_CODE;
process.env.DEFAULT_COUNTRY_CODE = "+44";
check(
  "a bare national number takes the configured code",
  normalisePhone("7911123456") === "+447911123456",
  normalisePhone("7911123456"),
);
check(
  "...and a number with its own code is untouched by it",
  normalisePhone("+919876543210") === "+919876543210",
);
process.env.DEFAULT_COUNTRY_CODE = "91";
check(
  "a code given without the + still works",
  normalisePhone("9876543210") === "+919876543210",
  normalisePhone("9876543210"),
);
if (before === undefined) delete process.env.DEFAULT_COUNTRY_CODE;
else process.env.DEFAULT_COUNTRY_CODE = before;

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
