import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { tenantUrl } from '../tenants/urls'
import { signGrant } from '../../lib/impersonation-grant'
import { openImpersonationSession } from '../auth/better-auth'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export interface MintImpersonationInput {
  /** The superadmin's own studio. Impersonating across studios is not a feature
   *  this has ever had, and the lookup is what makes that true. */
  tenantId: string
  clientId: string
  /** The superadmin's `staff_users` row: its id goes in the grant, its auth user
   *  on the session and in the sign-in log. */
  superadmin: { id: string; authUserId: string }
  /** The superadmin's request headers, for the sign-in log. */
  from: Headers
}

export interface MintImpersonationResult {
  token: string
  grant: string
  feClientUrl: string
}

/**
 * Open a real `client` pool session for the target member + a BE-signed grant
 * JWT (#118). The session signs the member app in as the member; the grant
 * proves to BE middleware that the resulting /me/* calls are impersonations,
 * and by whom.
 *
 * Throws:
 *   - NotFoundError('client_not_found') if the row is missing
 *   - BadRequestError('client_origin_not_configured') if this environment can
 *     build no member-app origin for the studio (no client wildcard in
 *     TENANT_ORIGIN_PATTERNS)
 *   - BadRequestError('client_blocked') for a member the studio has blocked —
 *     the pool's session hook refuses them, as it does their own sign-in
 */
export async function mintClientImpersonation(
  input: MintImpersonationInput,
): Promise<MintImpersonationResult> {
  // The session and the log name the superadmin's staff auth user.
  const staffAuthUserId = input.superadmin.authUserId

  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, input.tenantId), eq(clients.id, input.clientId)))
    .limit(1)
  if (!row) throw new NotFoundError('client_not_found')

  // This studio's own member app. It used to be the platform's single
  // `CLIENT_ORIGIN`, so impersonating a member of any studio but the first
  // opened a session against a hostname that is not theirs — and the `/me/*`
  // calls that followed would carry the wrong studio's `Origin`.
  const base = await tenantUrl('client', input.tenantId)
  if (!base) throw new BadRequestError('client_origin_not_configured')

  // In the request's transaction, so the session and its `impersonation_started`
  // row are written together or not at all.
  const { token } = await openImpersonationSession({
    memberAuthUserId: row.authUserId,
    staffAuthUserId,
    from: input.from,
  })

  const grant = signGrant({
    clientAuthUserId: row.authUserId,
    superadminStaffId: input.superadmin.id,
    // Stamped into the grant so the studio it was minted in is the only studio
    // it works against — the lookup above is what makes it true here, and the
    // claim is what keeps it true on every request the grant is later presented
    // with.
    tenantId: input.tenantId,
  })

  // In the fragment, not the query: a fragment never leaves the browser, so the
  // session token reaches no server log, proxy or `Referer`.
  const url = new URL('/impersonate', base)
  url.hash = new URLSearchParams({ token, grant }).toString()

  return { token, grant, feClientUrl: url.toString() }
}
