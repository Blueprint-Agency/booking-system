/**
 * Approve a PT request: confirms session, decrements package balance,
 * creates booking(s) per client in pt_session_clients, generates QR/codes,
 * marks inbox row, sends email.
 * See be-portal.md §3c.
 */
export interface ApprovePtInput {
  ptSessionId: string
  locationId: string
  actorStaffId: string
}

export async function approvePtSession(_input: ApprovePtInput): Promise<void> {
  throw new Error('not implemented')
}
