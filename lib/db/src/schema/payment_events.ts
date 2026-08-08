import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Every payment webhook this server has already acted on.
 *
 * Payment providers retry. They retry on a timeout, on a 500, and sometimes
 * because a network blipped after we answered — so the same "this order was
 * paid" event can arrive several times. Without a record of what has been
 * handled, a retry extends a subscription period twice.
 *
 * The unique constraint on `eventId` is the whole mechanism: the handler
 * inserts first and treats a duplicate-key violation as "already done, stop".
 * That makes the check atomic, which a SELECT-then-INSERT would not be when two
 * retries land on two replicas at the same moment.
 */
export const paymentEventsTable = pgTable(
  "payment_events",
  {
    id: serial("id").primaryKey(),
    /** The provider's own event id — `x-razorpay-event-id`. */
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    /** Null when the event could not be matched to a workspace. */
    workspaceId: integer("workspace_id"),
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    amountMinor: integer("amount_minor"),
    /** What we did: applied | ignored | rejected. */
    outcome: text("outcome").notNull().default("applied"),
    detail: text("detail"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("payment_events_event_key").on(t.eventId)],
);

export type PaymentEvent = typeof paymentEventsTable.$inferSelect;
