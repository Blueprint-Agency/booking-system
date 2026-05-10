/** Insert / mark read / resolve action on inbox_items. */
export type InboxItemType =
  | 'client_cancellation'
  | 'admin_cancel_class_pt'
  | 'admin_cancel_workshop'
  | 'pt_request'

export interface InsertInboxInput {
  type: InboxItemType
  payload: Record<string, unknown>
  sourcePtSessionId?: string
}

export async function insertInbox(_input: InsertInboxInput): Promise<{ id: string }> {
  throw new Error('not implemented')
}

export async function markRead(_inboxId: string, _staffId: string): Promise<void> {
  throw new Error('not implemented')
}
