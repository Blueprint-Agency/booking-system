/**
 * Clerk user.* webhook → upsert clients or staff_users.
 * - Client app user.created: insert clients row (resolve referred_by from registration metadata)
 * - Staff app user.created: match by email against pending staff_invitations,
 *   set staff_users.clerk_user_id + status='active', mark invitation accepted
 * - user.updated: sync name + email
 */
export async function handleClerkEvent(_event: any, _app: 'client' | 'staff'): Promise<void> {
  throw new Error('not implemented')
}
