import { setRequestHeadersGetter } from "@workspace/api-client-react";

/**
 * The workspace the user is currently looking at.
 *
 * This is a *pointer*, not a permission. It is stored in sessionStorage so a
 * reload keeps you where you were, and it is sent on every request as
 * `X-Workspace-Id` plus the scoped `X-Workspace-Token` the backend minted when
 * it verified the switch.
 *
 * Editing either value in devtools does nothing useful: the API re-reads the
 * caller's membership rows and answers 403 for any workspace they are not an
 * active member of. The token is HMAC-signed, so it cannot be forged for a
 * different workspace either.
 */

const WORKSPACE_ID_KEY = "portal:activeWorkspaceId";
const WORKSPACE_TOKEN_KEY = "portal:workspaceToken";

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private browsing) — the in-memory copy still applies
    // for this tab, the selection just will not survive a reload.
  }
}

let activeWorkspaceId: number | null = (() => {
  const raw = read(WORKSPACE_ID_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
})();

let workspaceToken: string | null = read(WORKSPACE_TOKEN_KEY);

export function getActiveWorkspaceId(): number | null {
  return activeWorkspaceId;
}

export function setWorkspaceContext(id: number | null, token: string | null): void {
  activeWorkspaceId = id;
  workspaceToken = token;
  write(WORKSPACE_ID_KEY, id === null ? null : String(id));
  write(WORKSPACE_TOKEN_KEY, token);
}

export function clearWorkspaceContext(): void {
  setWorkspaceContext(null, null);
}

// Registered at module load, not from an effect: queries fire while the tree is
// still mounting, and a request that went out without the workspace header would
// 403 before the effect ever ran.
setRequestHeadersGetter(() => {
  const headers: Record<string, string> = {};
  if (activeWorkspaceId !== null) headers["X-Workspace-Id"] = String(activeWorkspaceId);
  if (workspaceToken) headers["X-Workspace-Token"] = workspaceToken;
  return headers;
});
