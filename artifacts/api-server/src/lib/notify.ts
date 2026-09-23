import { and, eq } from "drizzle-orm";
import { db, notificationsTable, usersTable, workspaceMembershipsTable } from "@workspace/db";
import { sendMail } from "./mailer";
import { sendPush } from "./push";
import { logger } from "./logger";

/**
 * One notifiable event, up to three channels.
 *
 * Before this, every notifiable event wrote a `notifications` row by hand — six
 * raw inserts across the scheduler, document requests and documents — and only
 * two of them also sent an email. Adding push at each of those sites would have
 * been six chances to forget one, so they funnel through here instead.
 *
 * The three channels are deliberately not equivalent:
 *
 *   in-app  always. It is the record, and the thing the bell counts.
 *   email   when the recipient has a verified address. Somebody admitted by
 *           mobile number has none, which is exactly why push exists.
 *   push    when they have registered a device IN THIS WORKSPACE.
 *
 * Never throws. A hearing reminder failing on one channel must not stop the
 * other two, and must never fail the request or the scheduler tick that
 * produced it.
 */

export type Notification = {
  /** Clerk id of the recipient — the key `notifications.user_id` uses. */
  clerkId: string;
  /**
   * The tenant boundary. Push selects devices registered in THIS workspace and
   * no other, so a matter from one chamber cannot surface on a lock screen
   * while its reader is working in a different one.
   */
  workspaceId: number;
  /** reminder | document_request | general — matches `notifications.type`. */
  type: string;
  /** The in-app line. Also the push body, and the first line of the email. */
  message: string;
  /** In-app path to open. Must start with "/" — the client refuses anything else. */
  link?: string;
  /** Push and email subject. Falls back to a generic title. */
  title?: string;
  /** Extra prose for the email only — a lock screen stays terse. */
  emailBody?: string;
  /**
   * Whether an identical message already sent to this person suppresses this
   * one. Default true, which is what the scheduler needs: it sweeps every half
   * hour and would otherwise re-send the same T-24h reminder on each tick.
   *
   * Event-driven callers pass false. A document requested twice is two
   * requests, and the second being wording-identical to the first is the normal
   * case, not a duplicate tick — swallowing it would leave a client waiting for
   * a request they were never told about.
   */
  dedupe?: boolean;
};

/**
 * Has this exact text already gone to this person?
 *
 * Kept from the original scheduler, including its consequence, which is easy to
 * trip over: changing the WORDING of a reminder makes it a new message, and
 * everyone gets it once more.
 */
export async function alreadyNotified(clerkId: string, message: string): Promise<boolean> {
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, clerkId), eq(notificationsTable.message, message)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Deliver, on every channel available to this recipient.
 *
 * Returns false when the message was a duplicate and nothing was sent, so a
 * caller in a loop can tell "already handled" from "delivered".
 */
export async function notify(n: Notification): Promise<boolean> {
  try {
    if (n.dedupe !== false && (await alreadyNotified(n.clerkId, n.message))) return false;

    await db.insert(notificationsTable).values({
      userId: n.clerkId,
      type: n.type,
      message: n.message,
      link: n.link ?? null,
    });

    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, n.clerkId));
    if (!user) return true;

    const title = n.title ?? "LEX Practice";

    // An empty address means it was never verified, or was erased on request.
    // Either way there is nowhere to send.
    if (user.email) {
      await sendMail({
        to: user.email,
        subject: title,
        body: n.emailBody ?? n.message,
        kind: "reminder",
        workspaceId: n.workspaceId,
      });
    }

    /*
     * Membership is re-read rather than assumed.
     *
     * A scheduler row can outlive the membership that made it relevant — a task
     * assigned last week to somebody removed from the chamber yesterday. Pushing
     * that matter to them is a disclosure, and the notifications table has no
     * idea it happened. This is the same "ask the database every time" rule
     * `requireWorkspace` follows, applied to the one path that does not go
     * through it.
     */
    const [membership] = await db
      .select({ id: workspaceMembershipsTable.id })
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, n.workspaceId),
          eq(workspaceMembershipsTable.userId, user.id),
          eq(workspaceMembershipsTable.status, "active"),
        ),
      );
    if (!membership) return true;

    await sendPush(n.workspaceId, user.id, {
      title,
      // Terse on purpose. This lands on a lock screen, which is visible to
      // anyone holding the phone — so it names the event, not the matter's
      // contents, and links into the app for the rest.
      body: n.message,
      link: n.link ?? "",
      kind: n.type,
      workspaceId: n.workspaceId,
    });

    return true;
  } catch (err) {
    logger.error({ err, clerkId: n.clerkId }, "Notification delivery failed");
    return false;
  }
}
