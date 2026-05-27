/**
 * Client submits a PT request. Service inserts pt_requests + pt_request_slots
 * and debits 1 (1on1) or 2 (2on1) sessions from the client's PT package.
 *
 * No approve/decline step in the new flow — admin negotiates on WhatsApp and
 * then directly schedules from the portal (see ./schedule.ts), which is the
 * implicit approval. See docs/md/be-client.md §PT for the full contract.
 */

export interface PtRequestSlotInput {
  /** YYYY-MM-DD (local Singapore date). */
  proposedDate: string
  /** HH:mm 24h, local. */
  startTime: string
  /** HH:mm 24h, local. Must be after startTime. */
  endTime: string
}

/** Identity for the 2on1 partner. Required when sessionType='2on1', omitted otherwise. */
export type PtRequestPartner =
  | { kind: 'existing'; coClientId: string }
  // Partner isn't a member yet — admin will create their account at scheduling time.
  | { kind: 'new'; name: string; email: string }

export interface PtRequestInput {
  clientId: string
  /** Class type the client wants the session focused on. FK to class_types. */
  classTypeId: string
  sessionType: '1on1' | '2on1'
  /** Source PT package the request is debited from. Must be the requester's. */
  clientPackageId: string
  /** 1..N proposed date/time-frame slots. Admin picks one (or negotiates a new one) when scheduling. */
  slots: PtRequestSlotInput[]
  /** Optional free-form note from the client (preferences, focus areas, injuries). */
  message?: string
  /** Required when sessionType='2on1'. */
  partner?: PtRequestPartner
}

export async function submitPtRequest(_input: PtRequestInput): Promise<{ ptRequestId: string }> {
  throw new Error('not implemented')
}
