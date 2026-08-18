import { eq } from "drizzle-orm";
import { db, courtsTable, isPreviewDatabase } from "@workspace/db";
import { logger } from "../logger";

/**
 * Reference data for the courts registry.
 *
 * This repo deliberately ships NO seed data — the platform starts empty, and
 * sample matters were removed because they made it impossible to tell your
 * own data from the fixtures (see preview.ts). Courts are the exception, and
 * the distinction is real: a High Court is not somebody's data, it is a fact
 * about the world, in the same category as a currency code. A chamber cannot
 * usefully create one, and every chamber filing at Lucknow means the same
 * bench.
 *
 * Idempotent and run on every boot, in the same spirit as preview.ts's
 * migration block: it inserts what is missing by `code` and leaves everything
 * else alone, so an operator who corrects a court's name in the database
 * keeps that correction across the next deploy.
 */

type SeedCourt = {
  code: string;
  name: string;
  bench: string;
  jurisdiction: string;
  adapter: string;
  website: string;
};

/**
 * One court, two seats.
 *
 * The Allahabad High Court sits at Prayagraj (the principal seat) and at
 * Lucknow, and each publishes its own cause list. "Lucknow High Court" is the
 * common name for the second of those, not a separate court — which is why
 * `bench` is a field rather than these being two unrelated rows, and why
 * adding the principal seat later is a line here rather than a new adapter.
 *
 * Both name an adapter that is NOT registered yet, so both record `skipped`
 * on every sync. That is deliberate and honest: the court is selectable on a
 * matter immediately — which is what makes matters matchable the day an
 * adapter lands — while nothing pretends to be reading its list.
 */
const COURTS: SeedCourt[] = [
  {
    code: "allahabad-hc-lucknow",
    name: "High Court of Judicature at Allahabad",
    bench: "Lucknow",
    jurisdiction: "Uttar Pradesh",
    adapter: "allahabad-hc-lucknow",
    website: "https://www.allahabadhighcourt.in/",
  },
  {
    code: "allahabad-hc-prayagraj",
    name: "High Court of Judicature at Allahabad",
    bench: "Prayagraj",
    jurisdiction: "Uttar Pradesh",
    adapter: "allahabad-hc-prayagraj",
    website: "https://www.allahabadhighcourt.in/",
  },
];

/**
 * The fixture court, preview only.
 *
 * Guarded by the same check the adapter registry uses, so a production
 * database can never acquire it from this path. Its listings are deliberately
 * implausible (case 9001 of 2099), but that is a readability aid, not the
 * control — the control is this branch and the one in registry.ts.
 */
const PREVIEW_COURTS: SeedCourt[] = [
  {
    code: "fixture-court",
    name: "Fixture Court",
    bench: "",
    jurisdiction: "Preview",
    adapter: "fixture",
    website: "",
  },
  {
    code: "fixture-court-failing",
    name: "Fixture Court (always fails)",
    bench: "",
    jurisdiction: "Preview",
    adapter: "fixture-failing",
    website: "",
  },
];

export async function seedCourts(): Promise<void> {
  const wanted = isPreviewDatabase() ? [...COURTS, ...PREVIEW_COURTS] : COURTS;

  let added = 0;
  for (const court of wanted) {
    const [existing] = await db
      .select({ id: courtsTable.id })
      .from(courtsTable)
      .where(eq(courtsTable.code, court.code));
    // Never updated, only inserted when missing: an operator's correction to a
    // court's name or adapter must survive the next boot.
    if (existing) continue;
    await db.insert(courtsTable).values(court);
    added += 1;
  }

  if (added > 0) logger.info({ added }, "Seeded the courts registry");
}
