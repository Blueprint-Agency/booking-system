/**
 * Staff rank rules — pure, no DB.
 *
 * Rank order: admin = superadmin > instructor. An admin can do on staff
 * everything a superadmin could, so the two share the top rank until the
 * superadmin role itself goes.
 *
 *   - Editing a staff member of HIGHER rank is refused. Equal rank is allowed,
 *     so an admin may edit anyone and an instructor may edit instructors.
 *   - `role` and `granted_location_ids` are privilege fields: top rank only.
 *     Their presence in the patch refuses the whole request rather than being
 *     silently dropped — without this an instructor promotes themselves in one
 *     PATCH.
 */
import type { StaffRole } from '../../db/enums'

const RANK: Record<StaffRole, number> = {
  superadmin: 2,
  admin: 2,
  instructor: 1,
}

const TOP_RANK = 2

/** Admin, or the superadmin it is replacing: the roles that manage staff. */
export const TOP_RANK_ROLES = (Object.keys(RANK) as StaffRole[]).filter(r => RANK[r] === TOP_RANK)

export const isTopRank = (role: StaffRole) => RANK[role] === TOP_RANK

export type StaffEditRefusal =
  | 'outranked_staff_edit_forbidden'
  | 'privilege_fields_admin_only'

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
  if (args.touchesPrivilegeFields && RANK[args.actorRole] < TOP_RANK) {
    return 'privilege_fields_admin_only'
  }
  return null
}

export const STAFF_EDIT_REFUSAL_MESSAGE: Record<StaffEditRefusal, string> = {
  outranked_staff_edit_forbidden:
    'You cannot edit a staff member who outranks you.',
  privilege_fields_admin_only:
    'Only an admin can change a role or location grants.',
}
