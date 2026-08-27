import { pgTable, text, serial, integer, date, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending | in_progress | completed | overdue
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  assigneeId: text("assignee_id"), // Clerk user ID
  deadline: date("deadline", { mode: "string" }).notNull(),
  /**
   * May the assignee use AI drafting on this task's matter?
   *
   * The per-task grant. A junior advocate holds `drafting.use` but is not
   * trusted with the whole chamber's AI budget, so whoever assigns the work
   * decides, task by task, whether it comes with drafting. Admin and senior
   * advocate are chamber-wide and never consult this; a clerk never has
   * `drafting.use` at all, so ticking it for one changes nothing.
   *
   * Defaults false. AI is granted deliberately or not at all — a default of
   * true would make the checkbox a formality nobody reads.
   */
  aiAllowed: boolean("ai_allowed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
