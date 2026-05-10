/**
 * Manual credit/session adjust by admin. Writes manual_adjustments + audit_log.
 * See be-portal.md §3d.
 */
export interface AdjustInput {
  clientId: string
  clientPackageId: string
  delta: number
  reason: string
  actedByStaffId: string
}

export async function adjustBalance(_input: AdjustInput): Promise<void> {
  throw new Error('not implemented')
}
