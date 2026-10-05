/**
 * The payment provider's checkout script, loaded on demand.
 *
 * Shared by the plan modal and the drafting top-up packs. It lived inside
 * `pricing-modal.tsx` while plans were the only thing for sale; a second
 * buyer made that the wrong home, and two copies of a script loader is two
 * chances to load the script twice.
 */
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("checkout script failed to load")));
      return;
    }
    const el = document.createElement("script");
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("checkout script failed to load"));
    document.head.appendChild(el);
  });
}
