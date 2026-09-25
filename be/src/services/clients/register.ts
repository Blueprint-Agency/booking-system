import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { isUniqueViolation } from '../../db/unique-violation'
import { clientGenderEnum } from '../../db/enums'
import { clients } from '../../db/schema/identity'
import { ensureAuthUser, setMemberPassword } from '../auth/auth-users'
import { checkMemberCode, signInMemberWithPassword, spendMemberCode } from '../auth/better-auth'
import { memberAuthError } from '../auth/member-passwords'
import { BadRequestError, ConflictError, ForbiddenError } from '../../shared/errors'

type ClientGender = (typeof clientGenderEnum.enumValues)[number]

export interface RegisterMemberInput {
  tenantId: string
  email: string
  otp: string
  firstName: string
  lastName: string
  phone: string
  /** The member's own answer; left unset when they gave none. */
  gender?: ClientGender
  password: string
  /** The member's own request headers — their `Origin` and address go with the sign-in. */
  headers: Headers
}

/**
 * A member joins a studio: the code mailed to their address proves it, and the
 * account is made with the password they chose (#117, #173).
 *
 * The `client` pool's auth user, its password and the studio's `clients` row
 * are written together with the session, so there is no moment at which a
 * member is signed in with nothing to be signed in to, and no account exists
 * before its email is proven. One person joining a second studio gets a second,
 * independent login there, with the password they choose there, beside a
 * second, independent row (#231); their login at the first studio is untouched.
 *
 * In order:
 *
 *   1. Already a member here — 409 `already_member`, before the code is looked
 *      at. Signing in is the way back, and it does not need this code spent.
 *   2. The code is checked. A wrong one counts against the address and writes
 *      nothing else.
 *   3. User, password, row and session, in one savepoint, then the code spent.
 *      If the sign-in is refused (the limiter said no) everything goes with it.
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
      const authUserId = await ensureAuthUser(tx, 'client', { tenantId: input.tenantId, email, name })
      await tx.insert(clients).values({
        tenantId: input.tenantId,
        authUserId,
        email,
        name,
        phone,
        gender: input.gender ?? null,
        status: 'active',
      })
      await setMemberPassword(tx, authUserId, input.password)

      const signedIn = await signInMemberWithPassword(input.headers, email, input.password)
      if (!('token' in signedIn)) throw memberAuthError(signedIn)
      // Spent only once the account is made: a refused sign-in rolls the rows
      // back and leaves the code usable for the retry.
      await spendMemberCode(email)
      return signedIn
    })
  } catch (err) {
    // Two registrations for one address racing past the check above: the
    // second meets the unique index, and its answer is the same as the check's.
    if (isUniqueViolation(err, 'clients_tenant_email_unique')) throw new ConflictError('already_member')
    throw err
  }
}
