import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import type { ErrorCode } from '../../shared/error-codes'
import { AppError, BadRequestError, ForbiddenError } from '../../shared/errors'
import { requireTenantUrl } from '../tenants/urls'
import {
  mailMemberSetPasswordLink,
  memberHasPassword,
  memberLinkOwner,
  requestAddress,
  setMemberPasswordFromLink,
  type MemberAuthRefusal,
} from './better-auth'
import { spendSignInStepBudget } from './rate-limit'

/**
 * Member passwords (#173): the steps of the member sign-in form that are not
 * Better Auth's own endpoints. Signing in with a password and changing one are
 * (`/api/v1/auth/client/sign-in/email`, `/change-password`); these are the
 * email step, "forgot password", and following the mailed link.
 *
 * See docs/adr/0005-member-passwords.md.
 */

/** What the sign-in form shows after the email: a password box, or "check your email". */
export type SignInStep = { next: 'password' } | { next: 'link_sent' }

type FromCaller = { tenantId: string; email: string; from: Headers }

const tooManyRequests = () => new AppError(429, 'too_many_requests')

/**
 * The email step: an address with a password is asked for it; any other is
 * mailed a set-password link — if it is a member of this studio, which the
 * answer does not say. An imported member, or one who joined by code before
 * passwords, takes the link on their first sign-in.
 *
 * Budgeted per address and per email before either answer, since `password`
 * alone says an account exists and never reaches the pool's limiter.
 */
export async function nextSignInStep(input: FromCaller): Promise<SignInStep> {
  const { ip } = await requestAddress(input.from)
  if (!(await spendSignInStepBudget(input.tenantId, input.email, ip))) throw tooManyRequests()
  if (await memberHasPassword(input.email)) return { next: 'password' }
  return requestMemberPasswordLink(input)
}

/**
 * "Forgot password", and the email step's second answer: mail a set-password
 * link to this address if it is a member of this studio, and answer the same
 * whether or not it is.
 */
export async function requestMemberPasswordLink(input: FromCaller): Promise<{ next: 'link_sent' }> {
  await mailLinkOrThrow(input.from, input.email, input.tenantId)
  return { next: 'link_sent' }
}

/** Ask the pool for the link, landing on this studio's member app; 429 when a budget is spent. */
export async function mailLinkOrThrow(from: Headers, email: string, tenantId: string): Promise<void> {
  const requested = await mailMemberSetPasswordLink(from, email, await requireTenantUrl('client', tenantId))
  if (requested === 'rate_limited') throw tooManyRequests()
}

/**
 * Set a member's password from the mailed link, and sign them in to the studio
 * the page is on.
 *
 * A link is its studio's own (#231): another studio's is not found here at all.
 * Its owner must still be a member here, and not a blocked one, or setting the
 * password would lead to a session that reaches nothing. Checked before the
 * token is spent, so a refusal leaves the link usable.
 */
export async function setPasswordFromLink(input: {
  tenantId: string
  token: string
  password: string
  from: Headers
}): Promise<{ token: string }> {
  const owner = await memberLinkOwner(input.token)
  if (!owner) throw new BadRequestError('invalid_token')
  const [member] = await db
    .select({ deletedAt: clients.deletedAt })
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), eq(clients.authUserId, owner.id)))
    .limit(1)
  if (!member) throw new BadRequestError('invalid_token')
  if (member.deletedAt) throw new ForbiddenError('client_blocked')

  const result = await setMemberPasswordFromLink(input.from, input.token, input.password, owner.email)
  if (typeof result === 'string') throw new BadRequestError(result)
  if ('token' in result) return result
  throw memberAuthError(result)
}

/** A refusal from the member pool, as the error our routes answer with. */
export function memberAuthError(refused: MemberAuthRefusal): AppError {
  if (refused.status === 429) return tooManyRequests()
  // Relayed from Better Auth, not decided here: our own hooks refuse with
  // catalogued codes, and anything else it says passes through as it came.
  const message = ((refused.body as { message?: string } | null)?.message ??
    'sign_in_failed') as ErrorCode
  return refused.status === 403 ? new ForbiddenError(message) : new BadRequestError(message)
}
