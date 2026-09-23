import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { staffInvitations, staffUsers } from '../../db/schema/identity'
import { AppError } from '../../shared/errors'
import { requireTenantUrl } from '../tenants/urls'
import { isPlaceholderEmail } from './account-access'
import { hasStaffPassword } from './auth-users'
import { mailStaffSetPasswordLink, requestAddress, staffHasPassword } from './better-auth'
import { spendSignInStepBudget, spendStaffLinkBudget } from './rate-limit'

/**
 * The studio portal's email step: the sign-in form asks for the email first,
 * as the super portal's does (`platform-first-sign-in.ts`), and decides the
 * next screen from it.
 *
 *   - `link_sent` — a set-password link was mailed, if the address is staff at
 *     this studio who cannot sign in with a password yet: active with no
 *     password, or still pending here with a live invitation. Following
 *     the link sets the password, and the reset accepts the pending invitation
 *     (`acceptInvitationOnPasswordReset`). Any address without a staff password
 *     gets this answer too, and nothing is mailed to it.
 *   - `password` — everyone else: ask for the password and sign in.
 *
 * "Has a password" means at this studio: logins are per studio (#231), so a
 * password at another studio is not asked for here. The pending case is kept
 * apart all the same, so an invitee is always sent the link that accepts their
 * invitation, never asked for a password that signs in to "this account isn't
 * active here".
 *
 * What an answer reveals is the member form's accepted cost (ADR 0005): that an
 * address has a staff password at this studio. Pending here and unknown here
 * answer alike.
 *
 * Budgeted per address and per email before either answer, as the member step
 * is; the link is budgeted per email on top, so the step cannot flood an inbox —
 * and a spent link budget still answers `link_sent` (`mailQuietly`).
 */

export type StaffSignInStep = { next: 'password' } | { next: 'link_sent' }

const tooManyRequests = () => new AppError(429, 'too_many_requests')

export async function staffSignInStep(input: {
  tenantId: string
  email: string
  from: Headers
}): Promise<StaffSignInStep> {
  const email = input.email.trim().toLowerCase()
  const { ip } = await requestAddress(input.from)
  if (!(await spendSignInStepBudget(input.tenantId, email, ip))) throw tooManyRequests()

  const [staff] = await db
    .select({ id: staffUsers.id, status: staffUsers.status, authUserId: staffUsers.authUserId })
    .from(staffUsers)
    .where(
      and(
        eq(staffUsers.tenantId, input.tenantId),
        sql`lower(${staffUsers.email}) = ${email}`,
        isNull(staffUsers.deletedAt),
      ),
    )
    .limit(1)

  // Pending with an invitation the reset can still accept. Pending with an
  // expired one is not: the link would set a password and leave them pending,
  // and the next visit would mail another — so they are treated as not arrived,
  // and an admin resends the invitation.
  const [invitation] =
    staff?.status === 'pending'
      ? await db
          .select({ id: staffInvitations.id })
          .from(staffInvitations)
          .where(
            and(
              eq(staffInvitations.tenantId, input.tenantId),
              eq(staffInvitations.staffUserId, staff.id),
              eq(staffInvitations.status, 'pending'),
              gt(staffInvitations.expiresAt, new Date()),
            ),
          )
          .limit(1)
      : []
  const invitedHere = Boolean(invitation)
  if (!invitedHere && (await staffHasPassword(email))) return { next: 'password' }

  // An address under `.invalid` is a placeholder for staff imported with no
  // email of their own: nothing sent there reaches anyone.
  const owedLink =
    staff?.authUserId &&
    !isPlaceholderEmail(email) &&
    (invitedHere || (staff.status === 'active' && !(await hasStaffPassword(db, staff.authUserId))))
  if (owedLink) await mailQuietly(input.from, email, input.tenantId)
  return { next: 'link_sent' }
}

/**
 * Mail the link unless a budget is spent — and answer `link_sent` either way. A
 * refusal only an owed address could meet would tell a caller which addresses
 * are staff here, which the uniform answer exists to hide. The per-address step
 * budget above is what a caller meets instead.
 */
async function mailQuietly(from: Headers, email: string, tenantId: string): Promise<void> {
  if (!(await spendStaffLinkBudget(tenantId, email))) return
  try {
    await mailStaffSetPasswordLink(from, email, await requireTenantUrl('portal', tenantId))
  } catch (err) {
    if (err instanceof AppError && err.code === 'password_link_refused') return
    throw err
  }
}
