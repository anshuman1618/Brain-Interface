import { useEffect, useRef } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { isCrossOriginApi } from "@/lib/api-config";
import { isPreviewMode } from "@/lib/preview";

/**
 * Attaches Clerk's session JWT to API calls when the API is cross-origin, where
 * `fetch` defaults to `credentials: "same-origin"` and the session cookie is
 * therefore never sent. `clerkMiddleware` accepts either transport.
 *
 * Same-origin Clerk deployments register nothing — the browser sends the cookie.
 * Preview mode registers its token in lib/api-config at module load instead, so
 * it is in place before the first query fires.
 *
 * Takes `getToken` as an argument rather than calling the Clerk hook itself, so
 * this module never imports Clerk and stays loadable in preview mode.
 */
export function useClerkApiAuthBridge(getToken: () => Promise<string | null>): void {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    if (isPreviewMode || !isCrossOriginApi) return;

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
