import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { isCrossOriginApi } from "@/lib/api-config";

/**
 * Bridges Clerk auth into the generated API client for cross-origin deployments.
 *
 * Same-origin (Replit): the browser sends the Clerk session cookie with every
 * `/api/...` request, so nothing is registered here and cookie auth is used.
 *
 * Cross-origin (static frontend + separately hosted API): `fetch` defaults to
 * `credentials: "same-origin"`, so the session cookie is never sent and every
 * request would 401. Clerk's short-lived session JWT is attached as an
 * `Authorization: Bearer` header instead — `clerkMiddleware` on the API server
 * accepts either transport.
 */
export function useApiAuthBridge(): void {
  const { getToken } = useAuth();

  // Keep the latest getToken in a ref so the registered getter never closes
  // over a stale Clerk session after sign-in/sign-out.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    if (!isCrossOriginApi) return;

    setAuthTokenGetter(async () => {
      try {
        return await getTokenRef.current();
      } catch {
        // Signed out, or the token could not be refreshed — send the request
        // unauthenticated and let the API return 401.
        return null;
      }
    });

    return () => setAuthTokenGetter(null);
  }, []);
}
