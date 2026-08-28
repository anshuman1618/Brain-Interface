/**
 * Puts a test chamber's plan in force.
 *
 * A chamber that has never paid can read its own shell and nothing else — see
 * `planState.neverPaid` in lib/quota.ts. That is the product behaving as
 * specified, and it means every suite that opens a matter has to get past it
 * first, the same way every suite with a practice role has to declare bar
 * enrolment first.
 *
 * Preview has no payment provider, so this calls the preview-only route that
 * activates a trial without one. The route 404s in production and cannot grant
 * anything but a trial — see routes/preview.ts.
 *
 * Deliberately NOT done automatically at chamber creation: the gate is only
 * worth having if it is exercised, and a suite that never sees it would not
 * notice the day it stopped working.
 */
export async function grantPreviewPlan(call, token, wsToken, plan = "trial") {
  return call("/preview/activate-plan", { token, wsToken, method: "POST", body: { plan } });
}
