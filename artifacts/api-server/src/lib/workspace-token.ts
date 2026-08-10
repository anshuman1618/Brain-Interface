import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Scoped workspace tokens.
 *
 * When the client asks to switch workspace, the backend verifies membership and
 * mints one of these. It is an HMAC-signed statement of "this subject was
 * verified into this workspace at this time" — the client cannot forge one, so
 * it cannot select a workspace it was never admitted to.
 *
 * It is deliberately NOT the whole authorization story. The guard still reads
 * the membership row from the database on every request, because a token is a
 * snapshot: if an admin revokes membership or demotes a role thirty seconds
 * after the token was minted, a token-only check would keep honouring the old
 * grant until expiry. The token establishes *which* workspace is being asked
 * for; the database decides whether that is still allowed.
 */

const TTL_SECONDS = 60 * 60 * 8;

// A per-process random secret when none is configured. Tokens then die with the
// process, which is correct for preview/dev: the client simply re-switches. In
// production WORKSPACE_TOKEN_SECRET should be set so tokens survive a restart
// and are consistent across replicas.
const secret =
  process.env.WORKSPACE_TOKEN_SECRET && process.env.WORKSPACE_TOKEN_SECRET.length >= 16
    ? process.env.WORKSPACE_TOKEN_SECRET
    : randomBytes(32).toString("hex");

export type WorkspaceTokenClaims = {
  /** Clerk user id the token was minted for. */
  sub: string;
  /** Workspace id the subject was verified into. */
  wsId: number;
  /** Role at mint time — informational; the DB is re-read on every request. */
  role: string;
  /** Unix seconds. */
  exp: number;
};

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintWorkspaceToken(claims: Omit<WorkspaceTokenClaims, "exp">): string {
  const full: WorkspaceTokenClaims = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the claims, or null if the token is malformed, forged or expired. */
export function verifyWorkspaceToken(token: string | undefined): WorkspaceTokenClaims | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as WorkspaceTokenClaims;
    if (typeof claims.sub !== "string" || typeof claims.wsId !== "number") return null;
    if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
