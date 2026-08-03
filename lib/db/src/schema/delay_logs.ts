import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const delayLogsTable = pgTable("delay_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  reason: text("reason").notNull(), // client_unresponsive | court_delay | document_missing | resource_unavailable | other
  notes: text("notes"),
  proofFileName: text("proof_file_name"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDelayLogSchema = createInsertSchema(delayLogsTable).omit({
  id: true,
  submittedAt: true,
});
export type InsertDelayLog = z.infer<typeof insertDelayLogSchema>;
export type DelayLog = typeof delayLogsTable.$inferSelect;
