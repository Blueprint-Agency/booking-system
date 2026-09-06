import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { getClerkClientApp } from '../../lib/clerk'
import { tenantUrl } from '../tenants/urls'
import { signGrant } from '../../lib/impersonation-grant'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export interface MintImpersonationInput {
  /** The superadmin's own studio. Impersonating across studios is not a feature
   *  this has ever had, and the lookup is what makes that true. */
  tenantId: string
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
 *   - BadRequestError('client_origin_not_configured') if this environment can
 *     build no member-app origin for the studio (no client wildcard in
 *     TENANT_ORIGIN_PATTERNS)
 */
export async function mintClientImpersonation(
  input: MintImpersonationInput,
): Promise<MintImpersonationResult> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), eq(clients.id, input.clientId)))
    .limit(1)
  if (!row) throw new NotFoundError('client_not_found')
  if (!row.clerkUserId) throw new BadRequestError('client_not_provisioned')

  // This studio's own member app. It used to be the platform's single
  // `CLIENT_ORIGIN`, so impersonating a member of any studio but the first
  // opened a session ticket against a hostname that is not theirs — and the
  // `/me/*` calls that followed would carry the wrong studio's `Origin`.
  const base = await tenantUrl('client', input.tenantId)
  if (!base) throw new BadRequestError('client_origin_not_configured')

  const clerk = getClerkClientApp()
  const ticketRes = await clerk.signInTokens.createSignInToken({
    userId: row.clerkUserId,
    expiresInSeconds: 60,
  })

  const grant = signGrant({
    clientClerkUserId: row.clerkUserId,
    superadminStaffId: input.superadminStaffId,
    // Stamped into the grant so the studio it was minted in is the only studio
    // it works against — the lookup above is what makes it true here, and the
    // claim is what keeps it true on every request the grant is later presented
    // with.
    tenantId: input.tenantId,
  })

  const url = new URL('/impersonate', base)
  url.searchParams.set('ticket', ticketRes.token)
  url.searchParams.set('grant', grant)

  return { ticket: ticketRes.token, grant, feClientUrl: url.toString() }
}
