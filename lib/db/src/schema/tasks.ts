import { pgTable, text, serial, integer, date, timestamp } from "drizzle-orm/pg-core";
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
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
