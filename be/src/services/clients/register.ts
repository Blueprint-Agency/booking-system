import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { isUniqueViolation } from '../../db/unique-violation'
import { clients } from '../../db/schema/identity'
import { ensureAuthUser } from '../auth/auth-users'
import { checkMemberCode, signInMemberByCode } from '../auth/better-auth'
import { BadRequestError, ConflictError, ForbiddenError } from '../../shared/errors'

export interface RegisterMemberInput {
  tenantId: string
  email: string
  otp: string
  firstName: string
  lastName: string
  phone: string
  /** The member's own request headers — their `Origin` and address go with the sign-in. */
  headers: Headers
}

/**
 * A member joins a studio: the code mailed to their address, spent on an
 * account there (#117).
 *
 * The `client` pool's auth user and the studio's `clients` row are written
 * together with the session, so there is no moment at which a member is signed
 * in with nothing to be signed in to — the gap the Clerk path closed by
 * provisioning a row on the member's first request. One person joining a second
 * studio reuses their auth user and gets a second, independent row.
 *
 * In order:
 *
 *   1. Already a member here — 409 `already_member`, before the code is looked
 *      at. Signing in is the way back, and it does not need this code spent.
 *   2. The code is checked, not spent. A wrong one counts against the address
 *      and writes nothing else.
 *   3. User, row and session, in one savepoint. If the sign-in is refused (a
 *      race spent the code, the limiter said no) the user and row go with it.
 */
export async function registerMember(input: RegisterMemberInput): Promise<{ token: string }> {
  const email = input.email.trim().toLowerCase()
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim()
  const phone = input.phone.trim()

  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), sql`lower(${clients.email}) = ${email}`))
    .limit(1)
  if (existing) throw new ConflictError('already_member')

  const refusal = await checkMemberCode(email, input.otp)
  if (refusal === 'TOO_MANY_ATTEMPTS') throw new ForbiddenError('too_many_attempts')
  if (refusal) throw new BadRequestError(refusal === 'OTP_EXPIRED' ? 'otp_expired' : 'invalid_otp')

  try {
    return await db.transaction(async tx => {
      const authUserId = await ensureAuthUser(tx, 'client', { email, name })
      await tx.insert(clients).values({
        tenantId: input.tenantId,
        authUserId,
        email,
        name,
        phone,
        status: 'active',
      })

      const signedIn = await signInMemberByCode(input.headers, email, input.otp)
      if ('token' in signedIn) return signedIn
      const message = (signedIn.body as { message?: string } | null)?.message ?? 'sign_in_failed'
      throw signedIn.status === 403 ? new ForbiddenError(message) : new BadRequestError(message)
    })
  } catch (err) {
    // Two registrations for one address racing past the check above: the
    // second meets the unique index, and its answer is the same as the check's.
    if (isUniqueViolation(err, 'clients_tenant_email_unique')) throw new ConflictError('already_member')
    throw err
  }
}
