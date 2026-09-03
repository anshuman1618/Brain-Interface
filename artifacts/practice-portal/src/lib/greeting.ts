/**
 * The salutation at the top of a dashboard.
 *
 * Two small decisions worth recording, because both are easy to get wrong in a
 * way nobody notices until a user points it out:
 *
 * **The hours are the reader's, not the server's.** `new Date()` in the browser
 * is already in their timezone, which is the only one that matters for whether
 * it is morning. A chamber in Lucknow and a client abroad should each be
 * greeted by their own clock.
 *
 * **The first word of the display name, not the whole thing.** "Good morning,
 * Anshuman Chauhan" reads like a summons; "Good morning, Anshuman" reads like a
 * greeting. Where the name is one word, or an email address because nothing
 * better was ever supplied, the salutation drops the name rather than greeting
 * somebody by their address.
 */

export function timeOfDayGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** First word of a display name, or null when there is nothing usable in it. */
export function firstName(displayName: string | undefined | null): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  if (!first) return null;
  // An address is what `displayName` falls back to when the provider gave no
  // name. Greeting someone as "priya@chambers.in" is worse than not greeting
  // them by name at all.
  if (first.includes("@")) return null;
  return first;
}

export function greet(displayName: string | undefined | null, now: Date = new Date()): string {
  const name = firstName(displayName);
  const salutation = timeOfDayGreeting(now);
  return name ? `${salutation}, ${name}` : salutation;
}

/** "Tuesday, 3 September" — no year, because the reader knows what year it is. */
export function todayLong(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
