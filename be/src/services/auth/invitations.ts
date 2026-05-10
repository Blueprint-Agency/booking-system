/**
 * Issue a staff invitation: create staff_users (status=pending) + staff_invitations
 * row + Clerk invitation API call. See be-portal.md §3a.
 */
export interface InviteInput {
  email: string
  role: 'admin' | 'instructor'
  invitedByStaffId: string
}

export async function inviteStaff(_input: InviteInput): Promise<{ invitationId: string }> {
  throw new Error('not implemented')
}
