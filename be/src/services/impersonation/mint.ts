import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { getClerkClientApp } from '../../lib/clerk'
import { env } from '../../env'
import { signGrant } from '../../lib/impersonation-grant'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export interface MintImpersonationInput {
  clientId: string
  superadminStaffId: string
}

export interface MintImpersonationResult {
  ticket: string
  grant: string
  feClientUrl: string
}

/**
 * Mint a one-shot Clerk sign-in ticket for the target client + a BE-signed
 * grant JWT. The ticket signs the browser in as the client; the grant proves
 * to BE middleware that the resulting /me/* calls are impersonations.
 *
 * Throws:
 *   - NotFoundError('client_not_found') if the row is missing
 *   - BadRequestError('client_not_provisioned') if the client has no clerk_user_id
 *     (invited but never finished signup)
 *   - BadRequestError('client_origin_not_configured') if CLIENT_ORIGIN is unset
 */
export async function mintClientImpersonation(
  input: MintImpersonationInput,
): Promise<MintImpersonationResult> {
  const [row] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1)
  if (!row) throw new NotFoundError('client_not_found')
  if (!row.clerkUserId) throw new BadRequestError('client_not_provisioned')

  const base = env.CLIENT_ORIGIN?.replace(/\/+$/, '')
  if (!base) throw new BadRequestError('client_origin_not_configured')

  const clerk = getClerkClientApp()
  const ticketRes = await clerk.signInTokens.createSignInToken({
    userId: row.clerkUserId,
    expiresInSeconds: 60,
  })

  const grant = signGrant({
    clientClerkUserId: row.clerkUserId,
    superadminStaffId: input.superadminStaffId,
  })

  const url = new URL('/__impersonate', base)
  url.searchParams.set('ticket', ticketRes.token)
  url.searchParams.set('grant', grant)

  return { ticket: ticketRes.token, grant, feClientUrl: url.toString() }
}
