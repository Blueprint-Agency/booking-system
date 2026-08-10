/** Insert / mark read on inbox_items. */
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { inboxItems } from '../db/schema/inbox'

// Mirrors inboxItemTypeEnum (the `pt_request` value was removed per §4l — PT triage
// moved to /admin/pt-requests).
export type InboxItemType =
  | 'client_cancellation'
  | 'admin_cancel_class_pt'
  | 'admin_cancel_workshop'
  | 'instructor_cancel_class'

export interface InsertInboxInput {
  type: InboxItemType
  payload: Record<string, unknown>
}

export async function insertInbox(input: InsertInboxInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(inboxItems)
    .values({ type: input.type, payload: input.payload })
    .returning({ id: inboxItems.id })
  return { id: row!.id }
}

export async function markRead(inboxId: string, staffId: string): Promise<void> {
  await db
    .update(inboxItems)
    .set({ readAt: new Date(), readByStaffId: staffId })
    .where(eq(inboxItems.id, inboxId))
}
