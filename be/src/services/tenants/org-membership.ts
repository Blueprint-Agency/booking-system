/**
 * Putting a staff member into their studio's Clerk Organization.
 *
 * Provisioning invites the *first* admin into the organization
 * (`provision.ts`). Everyone after them is invited by the studio itself, from
 * inside the portal, with an email this platform sends and a `staff_users` row
 * this platform writes — and nothing in that path spoke to Clerk. The person
 * signed up fine, their row linked fine, and every portal request was then
 * refused with `organization_required`, because the token they carried was
 * signed into no organization and never could be: they were not a member of
 * one.
 *
 * So membership is granted at the moment a staff row is **linked** to a Clerk
 * user, which is the first moment both halves exist — the row (which says which
 * studio) and the user (which Clerk needs an id for). That moment is
 * `syncStaffFromClerk`, reached from the webhook and from the middleware's
 * auto-link fallback alike, so the grant happens whichever door the person
 * came through.
 *
 * Idempotent by construction: Clerk refuses a second membership with
 * `already_a_member_in_organization`, and that refusal is the success case
 * here — the first admin, invited by provisioning, already holds one.
 */
import type { StaffRole } from '../../db/enums'
import { clerkStaffApp } from '../../lib/clerk'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'
import { loadTenantById } from './tenants'

/**
 * Clerk's own organization roles, which are separate from `staff_users.role`.
 * The first says who may administer the organization *in Clerk* (its members,
 * its settings); the second says what they may do in the product. Only the
 * product role is load-bearing — nothing on this backend reads the Clerk one —
 * so the mapping only has to be sensible: those who run the studio may also
 * manage its organization, and instructors are members.
 */
export function orgRoleFor(role: StaffRole): 'org:admin' | 'org:member' {
  return role === 'instructor' ? 'org:member' : 'org:admin'
}

/** The one Clerk error that means "done", not "failed". */
export function isAlreadyMemberError(err: unknown): boolean {
  const errors = (err as { errors?: Array<{ code?: string }> } | null)?.errors
  return Array.isArray(errors) && errors.some(e => e?.code === 'already_a_member_in_organization')
}

export interface OrgMembershipPort {
  createMembership(input: {
    organizationId: string
    userId: string
    role: 'org:admin' | 'org:member'
  }): Promise<void>
}

export const clerkMembershipPort: OrgMembershipPort = {
  async createMembership({ organizationId, userId, role }) {
    await clerkStaffApp.organizations.createOrganizationMembership({
      organizationId,
      userId,
      role,
    })
  },
}

export type MembershipOutcome = 'granted' | 'already_member' | 'no_organization' | 'failed'

/**
 * Make sure this Clerk user is a member of the Tenant's portal organization.
 *
 * Best-effort and reported, never thrown: the caller has just linked a staff
 * row, and unlinking it again because Clerk was briefly unreachable would
 * leave the person worse off than a membership that arrives on the next
 * sign-in — `syncStaffFromClerk` calls this again on every `idempotent` pass,
 * so a failure here heals itself the next time the person shows up.
 */
export async function ensureStaffOrgMembership(
  input: { tenantId: string; clerkUserId: string; role: StaffRole },
  clerk: OrgMembershipPort = clerkMembershipPort,
): Promise<MembershipOutcome> {
  const tenant = await loadTenantById(input.tenantId)
  // A studio provisioned before organizations existed. The rollout seam in
  // `org-claim.ts` lets its tokens through without a claim, so there is nothing
  // to join yet.
  if (!tenant?.clerkPortalOrgId) return 'no_organization'

  try {
    await clerk.createMembership({
      organizationId: tenant.clerkPortalOrgId,
      userId: input.clerkUserId,
      role: orgRoleFor(input.role),
    })
    logger.info(
      { tenantId: input.tenantId, clerkUserId: input.clerkUserId, role: input.role },
      'clerk: staff member added to the studio organization',
    )
    return 'granted'
  } catch (err) {
    if (isAlreadyMemberError(err)) return 'already_member'
    logger.error(
      { err, tenantId: input.tenantId, clerkUserId: input.clerkUserId },
      'clerk: failed to add staff member to the studio organization',
    )
    captureException(err, { scope: 'clerk-org-membership', tenantId: input.tenantId })
    return 'failed'
  }
}
