import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const consultationsTable = pgTable("consultations", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  title: text("title").notNull(),
  notes: text("notes"),
  audioUrl: text("audio_url"),
  transcriptPlaceholder: text("transcript_placeholder"),
  consentGiven: boolean("consent_given").notNull().default(false),
  status: text("status").notNull().default("scheduled"), // scheduled | recording | completed | cancelled
  category: text("category"), // legal_solution | regulatory_solution | business_consultation | procedural_compliance
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConsultationSchema = createInsertSchema(consultationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertConsultation = z.infer<typeof insertConsultationSchema>;
export type Consultation = typeof consultationsTable.$inferSelect;
