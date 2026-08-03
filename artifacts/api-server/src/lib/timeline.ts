import { db } from "@workspace/db";
import { timelineEventsTable } from "@workspace/db";

export async function addTimelineEvent(
  caseId: number,
  eventType: string,
  description: string,
  actorName?: string,
): Promise<void> {
  await db
    .insert(timelineEventsTable)
    .values({ caseId, eventType, description, actorName: actorName ?? null });
}
