import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  /** Tenant boundary. Every read of this table is filtered by the caller's verified workspace. */
  workspaceId: integer("workspace_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // open | in_progress | review | closed
  clientId: integer("client_id"),
  /** Who the matter is against. Free text because the other side is rarely a
   *  user of this system — and it is what the conflict check searches. */
  opposingParty: text("opposing_party"),
  /** Set when an advocate was shown a possible conflict and opened the matter
   *  anyway. The reason they gave is the record of that decision. */
  conflictAcknowledgedBy: text("conflict_acknowledged_by"),
  conflictNote: text("conflict_note"),
  filingRef: text("filing_ref"),
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;
