import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay, over fetch rather than the SDK.
 *
 * Two calls are needed — create an order, and verify a webhook signature — and
 * both are a handful of lines. A payment SDK in the dependency tree is a large
 * surface for that, and the supply-chain guard in this workspace exists
 * precisely because dependencies near money deserve suspicion.
 *
 * Nothing here ever sees a card. The browser talks to Razorpay directly with an
 * order id; this server only creates that order and later hears, from a signed
 * webhook, that it was paid.
 */

const API = "https://api.razorpay.com/v1";

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string };

/**
 * Read on each call rather than captured at import — the same reason as the
 * encryption key. Returns null when payments are not configured, which is a
 * supported state: the app runs, it simply cannot charge.
 */
export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env["RAZORPAY_KEY_ID"]?.trim();
  const keySecret = process.env["RAZORPAY_KEY_SECRET"]?.trim();
  const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"]?.trim();
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}

export function paymentsEnabled(): boolean {
  return razorpayConfig() !== null;
}

export type CreatedOrder = { id: string; amountMinor: number; currency: string };

/**
 * Create an order for an amount this server computed.
 *
 * `notes` is echoed back on the webhook, which is how a payment is matched to a
 * workspace. It is NOT trusted as the price — the webhook recomputes the quote
 * from the plan catalogue and compares. A note is a label, not an instruction.
 */
export async function createOrder(input: {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<CreatedOrder> {
  const cfg = razorpayConfig();
  if (!cfg) throw new Error("Razorpay is not configured");

  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
      payment_capture: 1,
    }),
  });

  const body = (await res.json().catch(() => null)) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  } | null;

  if (!res.ok || !body?.id) {
    throw new Error(
      `Razorpay order creation failed (${res.status}): ${body?.error?.description ?? "no detail"}`,
    );
  }
  return { id: body.id, amountMinor: Number(body.amount), currency: String(body.currency) };
}

/**
 * Verify the webhook signature over the RAW body.
 *
 * The raw bytes matter: re-serialising parsed JSON changes key order and
 * whitespace, and the digest no longer matches. This is the single most common
 * way a webhook integration ends up verifying nothing — it fails open only if
 * you let it, so this returns false on every abnormal path.
 */
export function verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
  const cfg = razorpayConfig();
  if (!cfg || !signature) return false;

  const expected = createHmac("sha256", cfg.webhookSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which is itself an answer.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
