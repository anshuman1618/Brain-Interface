import cron from "node-cron";
import { eq, and, ne } from "drizzle-orm";
import { db, tasksTable, consultationsTable, notificationsTable } from "@workspace/db";
import { logger } from "./logger";

// Runs every 30 minutes; inserts T-24h and T-2h reminders for tasks and consultations.
// Email trigger is stubbed — logged only (real SMTP integration is future work).
let running = false;

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
  logger.info("Reminder scheduler started (every 30 min)");
}

async function alreadyNotified(userId: string, message: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.message, message)))
    .limit(1);
  return rows.length > 0;
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
      if (await alreadyNotified(task.assigneeId, message)) continue;
      await db.insert(notificationsTable).values({
        userId: task.assigneeId,
        type: "reminder",
        message,
        link: "/tasks",
      });
      logger.info(
        { taskId: task.id, window: w.label },
        "EMAIL STUB: deadline reminder would be emailed to assignee",
      );
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
        if (await alreadyNotified(recipient, message)) continue;
        await db.insert(notificationsTable).values({
          userId: recipient,
          type: "reminder",
          message,
          link: "/consultations",
        });
        logger.info(
          { consultId: consult.id, window: w.label },
          "EMAIL STUB: consultation reminder would be emailed",
        );
      }
    }
  }
}
