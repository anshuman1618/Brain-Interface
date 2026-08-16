/**
 * Money and quantity display.
 *
 * The API speaks in integer paise (`*Minor`) and thousandths (`*Milli`) and this
 * file is the only place either is turned into something a person reads. The
 * reverse direction lives here too, so a rupee figure typed into a form is
 * parsed by the same rules it was printed with — a second parser written beside
 * a form is how "₹4,500" becomes 4500 paise.
 */

/** 123456789 -> "₹12,34,567.89". Indian digit grouping, always two decimals. */
export function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = String(Math.floor(abs / 100));
  const paise = String(abs % 100).padStart(2, "0");
  // Last three digits, then pairs — 1234567 groups as 12,34,567.
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}₹${grouped}.${paise}`;
}

/** Same figure without the paise, for headline totals: 450000 -> "₹4,500". */
export function formatMinorShort(minor: number): string {
  return formatMinor(minor).replace(/\.00$/, "");
}

/**
 * "4,500.50" -> 45050 paise. Null when the text is not a usable amount.
 *
 * Rounds rather than truncates, and rejects more than two decimal places
 * outright: silently turning ₹1.005 into ₹1.00 loses half a paisa the person
 * typed on purpose.
 */
export function parseRupeesToMinor(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** 1500 -> "1.5". Trailing zeros dropped; thousandths are the stored unit. */
export function formatMilli(milli: number): string {
  const s = (milli / 1000).toFixed(3).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}

/** "1.5" -> 1500. Null when the text is not a usable quantity. */
export function parseQuantityToMilli(text: string): number | null {
  const cleaned = text.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 1000);
}

/** 135 -> "2h 15m". Minutes are the stored unit; hours are only ever display. */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
