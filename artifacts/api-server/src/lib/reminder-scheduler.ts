import cron from "node-cron";
import { eq, and, ne, inArray } from "drizzle-orm";
import {
  db,
  calendarEntriesTable,
  workspaceMembershipsTable,
  audienceIncludes,
  tasksTable,
  consultationsTable,
  casesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { drainOutbox } from "./mailer";
import { drainPushOutbox } from "./push";
import { notify } from "./notify";

/**
 * Reminders reach people, not just the log.
 *
 * Each reminder writes an in-app notification, emails the recipient where they
 * have a verified address, and pushes to any device they have registered in
 * that chamber. All three go through `notify()` — see lib/notify.ts for why
 * that is one call rather than three at every site, and for the dedup rule
 * that makes an overlapping tick harmless.
 */

// Runs every 30 minutes; inserts T-24h and T-2h reminders for tasks and consultations,
// and emails each recipient through the mailer (see lib/mailer.ts).
let running = false;
let draining = false;

export function startReminderScheduler(): void {
  cron.schedule("*/30 * * * *", async () => {
    if (running) return; // in-process mutex: prevent overlapping ticks racing the dedup check
    running = true;
    try {
      await emitReminders();
    } catch (err) {
      logger.error({ err }, "Reminder scheduler failed");
    } finally {
      running = false;
    }
  });
  // Separate and more frequent: a retry schedule that starts at one minute is
  // pointless if nothing looks for due messages until the half hour.
  cron.schedule("* * * * *", async () => {
    if (draining) return;
    draining = true;
    try {
      const r = await drainOutbox();
      if (r.attempted > 0) logger.info(r, "Drained the mail outbox");
      // Same schedule, same reasoning: a retry that starts at one minute is
      // pointless if nothing looks for due messages until the half hour.
      await drainPushOutbox();
    } catch (err) {
      logger.error({ err }, "Outbox drain failed");
    } finally {
      draining = false;
    }
  });

  logger.info("Reminder scheduler started (every 30 min), mail retry every minute");
}

export async function emitReminders(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Task deadlines (date-only columns)
  const tasks = await db.select().from(tasksTable).where(ne(tasksTable.status, "completed"));
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    const deadline = new Date(task.deadline + "T23:59:59Z");

    const windows: { label: string; inWindow: boolean }[] = [
      { label: "T-24h", inWindow: deadline > now && deadline <= in24h && deadline > in2h },
      { label: "T-2h", inWindow: deadline > now && deadline <= in2h },
    ];
    for (const w of windows) {
      if (!w.inWindow) continue;
      const message = `Reminder (${w.label}): task "${task.title}" is due ${task.deadline}.`;
      // A task is scoped through its matter, not directly — `tasks` has no
      // workspace column. The matter is also what the email names, so it is
      // one lookup, not two.
      const [matter] = await db.select().from(casesTable).where(eq(casesTable.id, task.caseId));
      if (!matter) continue;
      await notify({
        clerkId: task.assigneeId,
        workspaceId: matter.workspaceId,
        type: "reminder",
        title: `Deadline ${w.label === "T-2h" ? "in 2 hours" : "tomorrow"}: ${task.title}`,
        message,
        link: "/tasks",
        emailBody: `${message}\n\nMatter: ${matter?.title ?? "-"}\n\nOpen LEX Practice to complete or reschedule it.`,
      });
    }
  }

  // Upcoming consultations
  const consults = await db
    .select()
    .from(consultationsTable)
    .where(eq(consultationsTable.status, "scheduled"));
  for (const consult of consults) {
    if (!consult.scheduledAt) continue;
    const scheduled = new Date(consult.scheduledAt);
    const windows: { label: string; inWindow: boolean }[] = [
      { label: "T-24h", inWindow: scheduled > now && scheduled <= in24h && scheduled > in2h },
      { label: "T-2h", inWindow: scheduled > now && scheduled <= in2h },
    ];
    // Broadcast to all staff assignees — we store consultation reminders per-case; notify via a wildcard is not
    // supported, so consultations notify task assignees of the same case when present.
    // Same reason as tasks: a consultation is scoped through its matter.
    const [consultMatter] = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, consult.caseId));
    if (!consultMatter) continue;

    const relatedTasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.caseId, consult.caseId));
    const recipients = Array.from(
      new Set(relatedTasks.map((t) => t.assigneeId).filter((x): x is string => !!x)),
    );
    for (const recipient of recipients) {
      for (const w of windows) {
        if (!w.inWindow) continue;
        const message = `Reminder (${w.label}): consultation "${consult.title}" at ${scheduled.toISOString()}.`;
        await notify({
          clerkId: recipient,
          workspaceId: consultMatter.workspaceId,
          type: "reminder",
          title: `Consultation ${w.label === "T-2h" ? "in 2 hours" : "tomorrow"}: ${consult.title}`,
          message,
          link: "/consultations",
        });
      }
    }
  }

  /*
   * Hearings, filings and meetings from the master calendar.
   *
   * This table was not read here at all, which meant the single most important
   * thing in an advocate's week — a hearing tomorrow — was the one event the
   * chamber was never reminded about. Task deadlines and consultations were,
   * because they happen to have an assignee column.
   *
   * Recipients come from the entry's own `audience`, which already models
   * exactly this: "all", "staff", "role:<role>", "user:<clerkId>". So the fan-out
   * is a membership query and the resolver that routes/calendar.ts already uses
   * — not a new notion of who should hear about what.
   */
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const entries = await db
    .select()
    .from(calendarEntriesTable)
    .where(inArray(calendarEntriesTable.entryDate, [today, tomorrow]));

  for (const entry of entries) {
    // A note is a note. Reminding somebody of one at 6am is how an app teaches
    // people to switch its notifications off.
    if (entry.kind === "note") continue;

    const when = entry.entryDate === today ? "today" : "tomorrow";
    const at = entry.entryTime ? ` at ${entry.entryTime}` : "";
    const label =
      entry.kind === "hearing" ? "Hearing" : entry.kind === "filing" ? "Filing" : "Meeting";
    const message = `${label} ${when}${at}: ${entry.title}`;

    const members = await db
      .select()
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, entry.workspaceId),
          eq(workspaceMembershipsTable.status, "active"),
        ),
      );

    for (const member of members) {
      if (!audienceIncludes(entry.audience, member.role, member.clerkId)) continue;
      await notify({
        clerkId: member.clerkId,
        workspaceId: entry.workspaceId,
        type: "reminder",
        title: `${label} ${when}: ${entry.title}`,
        message,
        link: "/calendar",
        emailBody: entry.notes ? `${message}\n\n${entry.notes}` : message,
      });
    }
  }
}
