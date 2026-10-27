import { tenantId } from '../../middleware/tenant'
import { ForbiddenError } from '../../shared/errors'
import { profilePictureRoutes } from '../profile-picture'

/**
 * `/api/v1/portal/profile/photo`: any staff member's own Profile picture, admin
 * or instructor. The row is the signed-in caller's (`staffUserId`). An admin
 * acting as a colleague (`x-impersonate-staff-id`) is refused rather than handed
 * either picture: the colleague's is theirs to choose, and changing the admin's
 * own while they act as somebody else is not what they asked for.
 */
export default profilePictureRoutes(c => {
  if (c.get('actingAs')) {
    throw new ForbiddenError('forbidden', { message: 'Only a staff member can change their own picture.' })
  }
  return { tenantId: tenantId(c), kind: 'staff', id: c.get('staffUserId') }
})
