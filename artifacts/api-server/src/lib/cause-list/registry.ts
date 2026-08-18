import type { CourtAdapter } from "./types";
import { fixtureAdapter, failingFixtureAdapter } from "./adapters/fixture";
import { isPreviewDatabase } from "@workspace/db";

/**
 * Which adapters this build can actually run.
 *
 * A `courts` row names an adapter by id; this is where that id becomes code.
 * A court whose adapter is not here is not broken — the sync records
 * `skipped` for it and moves on. That is the honest state for a court whose
 * adapter has not been written yet, and it keeps the court selectable on a
 * matter (for the chamber's own records) long before anything can read its
 * list.
 *
 * The fixture adapters are registered ONLY against a preview database. They
 * are test scaffolding, and a production deployment that somehow acquired a
 * `courts` row pointing at "fixture" should skip it rather than write
 * invented listings next to real ones — the rows are deliberately
 * implausible (see fixture.ts), but "implausible" is not a control.
 *
 * `allahabadLucknowAdapter` is deliberately absent: it is a documented stub,
 * not an implementation. Adding it here before it is written would turn a
 * clean `skipped` into a `failed` on every sync, which is noise rather than
 * information. See adapters/allahabad-lucknow.ts.
 */
function buildRegistry(): Map<string, CourtAdapter> {
  const adapters: CourtAdapter[] = [];

  if (isPreviewDatabase()) {
    adapters.push(fixtureAdapter, failingFixtureAdapter);
  }

  return new Map(adapters.map((a) => [a.id, a]));
}

/**
 * Built on each call rather than captured at import, for the same reason the
 * Razorpay config is: `isPreviewDatabase()` is only meaningful after
 * `initDatabase()` has run, and a module-level constant would freeze the
 * answer from before that.
 */
export function adapterFor(id: string): CourtAdapter | null {
  return buildRegistry().get(id) ?? null;
}

/** Every adapter this build can run. For the sync-health screen. */
export function registeredAdapters(): CourtAdapter[] {
  return [...buildRegistry().values()];
}
