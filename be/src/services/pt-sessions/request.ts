/**
 * Client submits a PT request. Service inserts pt_sessions (status='pending'),
 * pt_session_clients, and inbox_items (type='pt_request').
 */
export interface PtRequestInput {
  clientId: string
  instructorId: string
  startsAt: Date
  endsAt: Date
  sessionType: '1on1' | '2on1'
  message?: string
  clientPackageId: string
  coClientIds?: string[]
}

export async function submitPtRequest(_input: PtRequestInput): Promise<{ ptSessionId: string }> {
  throw new Error('not implemented')
}
