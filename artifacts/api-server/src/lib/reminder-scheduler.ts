import cron from "node-cron";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  tasksTable,
  consultationsTable,
  casesTable,
  calendarEntriesTable,
  usersTable,
  workspaceMembershipsTable,
  audienceIncludes,
} from "@workspace/db";
import { logger } from "./logger";
import { drainOutbox } from "./mailer";
import { notify } from "./notify";
import { drainPushOutbox } from "./push";

/**
 * Reminders reach people, not just the log.
 *
 * Each reminder writes an in-app notification AND emails the assignee. The
 * in-app record is what deduplicates: if a notification with this exact text
 * already exists for this person, neither is sent again, so a scheduler tick
 * that overlaps a previous one cannot double-send.
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
      // The same minute, the same mutex. Push and mail fail independently and
      // retry on the same ladder, so there is no reason for a second timer.
      await drainPushOutbox();
      if (r.attempted > 0) logger.info(r, "Drained the mail outbox");
    } catch (err) {
      logger.error({ err }, "Mail outbox drain failed");
    } finally {
      draining = false;
    }
  });

  logger.info("Reminder scheduler started (every 30 min), mail retry every minute");
}

/**
 * Run one sweep now, and drain what it queued.
 *
 * Exists for `POST /preview/run-reminders` — a preview-only seam, because the
 * sweep is otherwise a cron job nothing can trigger and therefore nothing can
 * assert on. It takes the same in-process mutex as the timer, so calling it
 * mid-tick cannot race the dedup check.
 *
 * The drain is part of it deliberately. `notify()` only QUEUES a push; without
 * draining, a suite would see an outbox row and never the outcome — which is
 * the half of this path most worth proving.
 */
export async function runRemindersNow(): Promise<{ drained: number }> {
  if (running) return { drained: 0 };
  running = true;
  try {
    await emitReminders();
    const push = await drainPushOutbox();
    await drainOutbox();
    return { drained: push.attempted };
  } finally {
    running = false;
  }
}

async function emitReminders(): Promise<void> {
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
      const [matter] = await db.select().from(casesTable).where(eq(casesTable.id, task.caseId));
      // The matter carries the tenant. Without it push has no idea which
      // chamber's devices to reach, and a reminder cannot be sent at all.
      if (!matter) continue;
      await notify({
        clerkId: task.assigneeId,
        workspaceId: matter.workspaceId,
        type: "reminder",
        message,
        link: "/tasks",
        title: `Deadline ${w.label === "T-2h" ? "in 2 hours" : "tomorrow"}: ${task.title}`,
        emailBody: `${message}\n\nMatter: ${matter.title}\n\nOpen LEX Practice to complete or reschedule it.`,
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
    const [consultCase] = await db
      .select()
      .from(casesTable)
      .where(eq(casesTable.id, consult.caseId));
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
        if (!consultCase) continue;
        await notify({
          clerkId: recipient,
          workspaceId: consultCase.workspaceId,
          type: "reminder",
          message,
          link: "/consultations",
          title: `Consultation ${w.label === "T-2h" ? "in 2 hours" : "tomorrow"}: ${consult.title}`,
        });
      }
    }
  }

  await emitCalendarReminders(now);
}

/**
 * Hearings, filings and meetings — the reminders that did not exist.
 *
 * `calendar_entries` was not read by this scheduler at all. Task deadlines and
 * consultations were covered only because those tables happen to carry an
 * assignee, so the single most important thing in an advocate's week — the date
 * they have to be in court — was the one event nobody was ever reminded about.
 *
 * ── Who hears about it ──────────────────────────────────────────────────────
 *
 * The entry's own `audience` decides, through `audienceIncludes()` — the same
 * function routes/calendar.ts already filters reads with. So a hearing addressed
 * to `role:admin` reaches the admins and nobody else, and a client never learns
 * of a `staff` note. Reusing that function rather than re-deriving the rule is
 * what stops the calendar and its reminders disagreeing about who an entry is
 * for, which would be a disclosure rather than a bug.
 *
 * ── Date-only, so the windows are days ──────────────────────────────────────
 *
 * `entryDate` is a day and `entryTime` is optional wall-clock text, so there is
 * no instant to measure T-2h against. Today and tomorrow are the two windows
 * that mean something for a day grid, and the message says which.
 */
async function emitCalendarReminders(now: Date): Promise<void> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const entries = await db
    .select()
    .from(calendarEntriesTable)
    .where(inArray(calendarEntriesTable.entryDate, [today, tomorrow]));
  if (entries.length === 0) return;

  // One read per workspace rather than one per entry per member: a chamber with
  // a busy week would otherwise re-read its whole membership list dozens of
  // times on every tick.
  const byWorkspace = new Map<number, { clerkId: string; role: string }[]>();
  for (const entry of entries) {
    if (byWorkspace.has(entry.workspaceId)) continue;
    const members = await db
      .select({
        clerkId: usersTable.clerkId,
        role: workspaceMembershipsTable.role,
      })
      .from(workspaceMembershipsTable)
      .innerJoin(usersTable, eq(usersTable.id, workspaceMembershipsTable.userId))
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, entry.workspaceId),
          eq(workspaceMembershipsTable.status, "active"),
        ),
      );
    byWorkspace.set(entry.workspaceId, members);
  }

  for (const entry of entries) {
    const when = entry.entryDate === today ? "today" : "tomorrow";
    const at = entry.entryTime ? ` at ${entry.entryTime}` : "";
    const label =
      entry.kind === "note" ? "Note" : entry.kind[0]!.toUpperCase() + entry.kind.slice(1);
    const message = `${label} ${when}${at}: ${entry.title}`;

    for (const member of byWorkspace.get(entry.workspaceId) ?? []) {
      if (!audienceIncludes(entry.audience, member.role, member.clerkId)) continue;
      await notify({
        clerkId: member.clerkId,
        workspaceId: entry.workspaceId,
        type: "reminder",
        message,
        link: "/calendar",
        title: `${label} ${when}: ${entry.title}`,
        emailBody: entry.notes ? `${message}\n\n${entry.notes}` : message,
      });
    }
  }
}
