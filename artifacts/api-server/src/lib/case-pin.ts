import type { WorkspaceContext } from "../middlewares/requireAuth";
import { caseInWorkspace } from "./scope";

/**
 * The "restrict to these matters" rule, in one place for both admission doors.
 *
 * `POST /invites` and `POST /workspace/access-list` both create a client
 * membership and both have to apply the same rule. They already drifted once —
 * one validated the identifier's shape and the other did not, so garbage could
 * be written through one door and not the other — and that is the argument for
 * this function existing rather than the rule being written twice.
 *
 * The rule, unchanged from when it was a single `caseId`:
 *
 *  - Only a **client** may be pinned. Every other role reaches the whole
 *    workspace regardless, so a pin on one would sit on the row unread.
 *    Refused rather than ignored, so the mistake surfaces where it was made.
 *  - A client **must** be pinned. An unrestricted client sees every matter
 *    their `clientId` is attached to, which is rarely what an admin handing
 *    out one invitation intended.
 *  - Every matter named must be in the caller's workspace. `caseInWorkspace`
 *    and not `getVisibleCase`: an admin pinning a client to a matter is the
 *    only caller here (`access_control.manage`), and admins are not row
 *    scoped. A narrowable role can never reach this code.
 */
export type CasePinResult =
  { ok: true; caseIds: number[] } | { ok: false; status: number; error: string; message: string };

export async function resolveCasePin(
  c: WorkspaceContext,
  role: string,
  input: { caseId?: number | undefined; caseIds?: number[] | undefined },
): Promise<CasePinResult> {
  // `caseId` is the old single-matter field. Accepted so a client of this API
  // written before multi-matter pinning keeps working, and folded into the
  // list immediately so nothing downstream has two shapes to handle.
  if (input.caseId != null && input.caseIds != null && input.caseIds.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      message: "Give caseIds or the older caseId, not both.",
    };
  }
  const requested = input.caseIds?.length
    ? input.caseIds
    : input.caseId != null
      ? [input.caseId]
      : [];

  // Duplicates are a client-side slip, not an error worth a round trip.
  const caseIds = [...new Set(requested)];

  if (role !== "client") {
    if (caseIds.length > 0) {
      return {
        ok: false,
        status: 400,
        error: "invalid_request",
        message: "Restricting to matters only applies to the Client role.",
      };
    }
    return { ok: true, caseIds: [] };
  }

  if (caseIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      message: "A client must be restricted to at least one matter.",
    };
  }

  // Every one of them, not just the first. Checking one and trusting the rest
  // would let an admin pin a client to a matter in another chamber by putting
  // a real id first — which is the whole tenant boundary, on the one screen
  // whose job is to hand out access.
  for (const id of caseIds) {
    if (!(await caseInWorkspace(c, id))) {
      return {
        ok: false,
        status: 404,
        error: "not_found",
        message: `Matter ${id} was not found in this chamber.`,
      };
    }
  }

  return { ok: true, caseIds };
}
