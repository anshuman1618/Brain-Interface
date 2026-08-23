import type { Response, NextFunction } from "express";
import { normaliseEmail, normalisePhone } from "@workspace/db";
import type { AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "./jit";

/**
 * Who may see the whole platform rather than one chamber.
 *
 * Everything else in this server answers "what may this member of this chamber
 * reach", and `requireWorkspace` is the gate that makes tenant isolation true.
 * The operator view is the one thing that deliberately looks *across* tenants,
 * so it cannot ride on that machinery at all — there is no capability for it,
 * and adding one would be a mistake: capabilities are granted per membership by
 * chamber admins, and a chamber admin must never be able to grant themselves a
 * view of everybody else's chamber. `access_control.manage` is one invite away
 * for anyone who founds a chamber, which is exactly why it is not the answer.
 *
 * So the allowlist is an environment variable. It is set by whoever can deploy,
 * which is the correct definition of "runs the service", and it cannot be
 * escalated into from inside the product.
 *
 * **Unset means off.** Not "off for now" — the route does not exist. A default
 * that fell open, or that treated the first registered user as the operator,
 * would hand the whole platform to whoever signed up first.
 */

/** Normalised on read, once per process — the same normalise-on-write rule the access list uses. */
let cached: { raw: string; emails: Set<string> } | null = null;
let cachedPhones: { raw: string; phones: Set<string> } | null = null;

export function operatorEmails(): Set<string> {
  const raw = process.env["OPERATOR_EMAILS"] ?? "";
  if (cached && cached.raw === raw) return cached.emails;
  const emails = new Set(
    raw
      .split(",")
      .map((e) => normaliseEmail(e.trim()))
      .filter((e) => e.length > 0),
  );
  cached = { raw, emails };
  return emails;
}

/**
 * The same allowlist, for operators who sign in by SMS.
 *
 * Separate variable rather than a mixed one, so a malformed entry cannot be
 * mistaken for the other kind: anything that fails to normalise is dropped
 * here, exactly as an empty string is dropped above.
 */
export function operatorPhones(): Set<string> {
  const raw = process.env["OPERATOR_PHONES"] ?? "";
  if (cachedPhones && cachedPhones.raw === raw) return cachedPhones.phones;
  const phones = new Set(
    raw
      .split(",")
      .map((p) => normalisePhone(p.trim()))
      .filter((p) => p.length > 0),
  );
  cachedPhones = { raw, phones };
  return phones;
}

export function operatorViewEnabled(): boolean {
  return operatorEmails().size > 0 || operatorPhones().size > 0;
}

export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return operatorEmails().has(normaliseEmail(email));
}

export function isOperatorPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const normalised = normalisePhone(phone);
  return normalised.length > 0 && operatorPhones().has(normalised);
}

/** Either identifier admits an operator — they are one allowlist in two forms. */
export function isOperator(user: { email?: string | null; phone?: string | null }): boolean {
  return isOperatorEmail(user.email) || isOperatorPhone(user.phone);
}

/**
 * Identity, then the allowlist. Runs after `requireAuth`.
 *
 * **Refuses with 404, not 403.** A 403 confirms the endpoint exists and that
 * the caller merely lacks permission, which tells anyone probing that there is
 * a cross-tenant surface here worth attacking. There is nothing to gain from
 * that admission: an operator knows the URL, and to everyone else the route is
 * indistinguishable from a typo. The same reason a proposal belonging to
 * another chamber 404s rather than 403s.
 *
 * The email is read from the application's own user row, never from the token
 * or a header — the same rule as everywhere else in this server. Clerk
 * establishes an address; the database decides what it means.
 */
export async function requireOperator(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!operatorViewEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const user = await getOrCreateUser(req);
  if (!user || !isOperator(user)) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  next();
}
