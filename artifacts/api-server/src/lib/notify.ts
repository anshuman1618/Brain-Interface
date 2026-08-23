import { and, eq } from "drizzle-orm";
import { db, notificationsTable, usersTable, workspaceMembershipsTable } from "@workspace/db";
import { sendMail, type MailKind } from "./mailer";
import { sendPush } from "./push";
import { logger } from "./logger";

/**
 * One notifiable event, up to three channels.
 *
 * Before this, every notifiable event wrote a `notifications` row by hand —
 * eight raw inserts across the scheduler, document requests and documents — and
 * only two of them also sent an email. Adding push at each of those sites would
 * have meant eight chances to forget one, so they funnel through here instead.
 *
 * The three channels are deliberately not equivalent:
 *
 *   in-app  always. It is the record, and the thing the bell counts.
 *   email   when the recipient has a verified address. Somebody who signed up
 *           by SMS has none, which is exactly why push exists.
 *   push    when they have registered a device in THIS workspace.
 *
 * Never throws. A hearing reminder failing to reach one channel must not stop
 * the other two, and must never fail the scheduler tick that produced it.
 */

export type Notification = {
  /** Clerk id of the recipient — the key `notifications.user_id` uses. */
  clerkId: string;
  /**
   * The tenant boundary. Push selects devices registered in this workspace and
   * no other, so a matter from one chamber cannot surface on a lock screen
   * while its owner is working in a different one.
   */
  workspaceId: number;
  /** reminder | document_request | general — matches `notifications.type`. */
  type: string;
  /** The in-app line. Also the push body, and the first line of the email. */
  message: string;
  /** In-app path to open. */
  link?: string;
  /** Push and email subject. Falls back to a generic title. */
  title?: string;
  /** Extra prose for the email only — a lock screen should stay terse. */
  emailBody?: string;
  emailKind?: MailKind;
  pushKind?: string;
};

/**
 * The in-app row is what deduplicates.
 *
 * Kept from the original scheduler: if a notification with this exact text
 * already exists for this person, nothing is sent again — so a scheduler tick
 * overlapping a previous one cannot double-send. Note the consequence, which is
 * easy to trip over: changing the WORDING of a reminder makes it a new message,
 * and everyone gets it once more.
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
    if (await alreadyNotified(n.clerkId, n.message)) return false;

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
    // Either way there is nowhere to send — and for a phone-only user that is
    // the normal case, not a fault.
    if (user.email) {
      await sendMail({
        to: user.email,
        subject: title,
        body: n.emailBody ?? n.message,
        kind: n.emailKind ?? "reminder",
        workspaceId: n.workspaceId,
      });
    }

    // Membership is re-checked rather than assumed: a scheduler row can outlive
    // the membership that made it relevant, and pushing a matter to somebody
    // who has since been removed from the chamber is a leak.
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
      // Terse on purpose. This lands on a lock screen, where a matter title is
      // visible to anyone holding the phone.
      body: n.message,
      link: n.link ?? "",
      kind: n.pushKind ?? n.type,
      workspaceId: n.workspaceId,
    });

    return true;
  } catch (err) {
    logger.error({ err, clerkId: n.clerkId }, "Notification delivery failed");
    return false;
  }
}
