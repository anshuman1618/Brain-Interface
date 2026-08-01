import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { getPreviewRole, isPreviewMode, previewToken } from "@/lib/preview";

/**
 * Absolute origin of the API server, e.g. `https://api.example.com`.
 *
 * Leave unset when the frontend and API are served from the same origin (the
 * Replit deployment router does this): requests then stay relative (`/api/...`)
 * and the browser attaches the Clerk session cookie automatically.
 *
 * Set it when the two are hosted separately (e.g. static frontend on Netlify +
 * API on a Node host). Requests become absolute and cross-origin, which means
 * cookies are NOT sent — auth switches to bearer tokens instead, see
 * `useApiAuthBridge`.
 */
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

/** True when the API lives on a different origin than this bundle. */
export const isCrossOriginApi = apiBaseUrl !== "";

if (isCrossOriginApi) {
  setBaseUrl(apiBaseUrl);
}

// Registered at module load, not from a React effect: queries fire while the
// tree is still mounting, so an effect-based registration lets the first request
// go out unauthenticated and 401. The role is read from storage on each call, so
// switching role in the preview bar takes effect without re-registering.
if (isPreviewMode) {
  setAuthTokenGetter(() => {
    const role = getPreviewRole();
    return role ? previewToken(role) : null;
  });
}
