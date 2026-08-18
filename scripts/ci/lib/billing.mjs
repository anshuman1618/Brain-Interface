import { createHmac } from "node:crypto";

/**
 * Paying for a plan from a test suite, without a Razorpay account.
 *
 * A deployment with a payment provider configured will NOT activate a
 * chargeable plan on selection — it writes `pending_payment` and waits for the
 * signed webhook. That is the whole point of the gate, and it means any suite
 * that upgrades a chamber as *setup* stops working the moment payments are
 * switched on, unless it pays.
 *
 * `verifyWebhook` is plain HMAC-SHA256 over the raw request body, so a valid
 * signature can be minted locally from the shared secret with no network call.
 * The alternative is a live merchant account in CI, which is not a thing worth
 * having.
 *
 * Shared by `plan`, `gov` and `subs` rather than copied into each, because a
 * copy that drifts is a copy that silently stops proving the gate works.
 */

/** Whether this server can charge. Needs a workspace-scoped caller. */
export async function paymentsConfigured(call, token, wsToken) {
  const cfg = await call("/billing/config", { token, wsToken });
  return cfg.data?.enabled === true;
}

/**
 * Mint and post the provider's `payment.captured` webhook for a plan.
 *
 * The order notes carry exactly what the real integration puts there, and the
 * amount must be the one the server itself quoted — the handler recomputes the
 * price from its own catalogue and rejects anything that disagrees, so passing
 * a wrong amount here fails the way a fraudulent payment would.
 */
export async function payForPlan(base, { workspaceId, plan, billingPeriod, amountMinor, tag }) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "fakewebhook";
  const unique = `${tag ?? plan}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: { entity: { id: `pay_${unique}`, amount: amountMinor } },
      order: {
        entity: {
          id: `order_${unique}`,
          amount: amountMinor,
          notes: { workspaceId: String(workspaceId), plan, billingPeriod },
        },
      },
    },
  });

  const res = await fetch(`${base}/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": createHmac("sha256", secret).update(body).digest("hex"),
      "x-razorpay-event-id": `evt_${unique}`,
    },
    body,
  });
  return res.status;
}

/**
 * Put a plan in force, whichever mode the server is in.
 *
 * With payments off the PUT is enough. With payments on the PUT only records
 * intent, so the signed webhook follows. Returns the PUT response so a caller
 * that wants to assert on the gate itself still can.
 */
export async function activatePlan(
  base,
  call,
  { token, wsToken, workspaceId, plan, billingPeriod, paymentsOn },
) {
  const put = await call("/workspace/subscription", {
    token,
    wsToken,
    method: "PUT",
    body: { plan, billingPeriod },
  });

  if (paymentsOn && put.status === 200 && put.data?.subscription?.amountMinor > 0) {
    await payForPlan(base, {
      workspaceId,
      plan,
      billingPeriod: put.data.subscription.billingPeriod,
      amountMinor: put.data.subscription.amountMinor,
    });
  }
  return put;
}
