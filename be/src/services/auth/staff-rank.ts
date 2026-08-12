/**
 * Staff rank rules — pure, no DB.
 *
 * Rank order: superadmin > admin > instructor
 * (spec-instructor-leave-pools.md § Permissions).
 *
 *   - Editing a staff member of HIGHER rank is refused. Equal rank is allowed,
 *     so an admin may edit instructors and other admins (and themselves).
 *   - `role` and `granted_location_ids` are privilege fields: superadmin only.
 *     Their presence in the patch refuses the whole request rather than being
 *     silently dropped — without this an admin promotes themselves in one PATCH.
 */
import type { StaffRole } from '../../db/enums'

const RANK: Record<StaffRole, number> = {
  superadmin: 3,
  admin: 2,
  instructor: 1,
}

export type StaffEditRefusal =
  | 'outranked_staff_edit_forbidden'
  | 'privilege_fields_superadmin_only'

/** Why this actor may not apply this staff-profile patch, or null when allowed. */
export function staffEditRefusal(args: {
  actorRole: StaffRole
  targetRole: StaffRole
  /** Patch carries `role` and/or `granted_location_ids`. */
  touchesPrivilegeFields: boolean
}): StaffEditRefusal | null {
  if (RANK[args.targetRole] > RANK[args.actorRole]) {
    return 'outranked_staff_edit_forbidden'
  }
  if (args.touchesPrivilegeFields && args.actorRole !== 'superadmin') {
    return 'privilege_fields_superadmin_only'
  }
  return null
}

export const STAFF_EDIT_REFUSAL_MESSAGE: Record<StaffEditRefusal, string> = {
  outranked_staff_edit_forbidden:
    'You cannot edit a staff member who outranks you.',
  privilege_fields_superadmin_only:
    'Only a superadmin can change a role or location grants.',
}
