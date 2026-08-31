import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { env } from '../env'

/**
 * BE-signed grant JWT proving that a /api/v1/me/* call is being made by a
 * superadmin impersonating a specific client. Separate from the Clerk client
 * JWT (which carries the *target client's* identity) — we need our own
 * signature because Clerk client tokens have no notion of the staff actor.
 *
 *   sub — clerk_user_id of the impersonated client (matches Clerk JWT.sub)
 *   sas — superadmin staff_users.id (UUID) — the actor for audit
 *   tid — the tenant the grant was minted in, and the ONLY tenant it is good
 *         for. Without it a grant is a bearer token that says "somebody is
 *         impersonating somebody", and a caller could present it against another
 *         studio's requests; the middleware refuses a mismatch.
 *   jti — random — placeholder for a future revocation table
 *   exp — 1h after mint
 */
export interface ImpersonationGrant {
  sub: string
  sas: string
  tid: string
  jti: string
  iat: number
  exp: number
}

const TTL_SECONDS = 60 * 60 // 1h

export function signGrant(input: {
  clientClerkUserId: string
  superadminStaffId: string
  tenantId: string
}): string {
  const payload: Omit<ImpersonationGrant, 'iat' | 'exp'> = {
    sub: input.clientClerkUserId,
    sas: input.superadminStaffId,
    tid: input.tenantId,
    jti: randomUUID(),
  }
  return jwt.sign(payload, env.IMPERSONATION_SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
  })
}

/** Returns null on any failure (signature, exp, malformed). Never throws. */
export function verifyGrant(token: string): ImpersonationGrant | null {
  try {
    const decoded = jwt.verify(token, env.IMPERSONATION_SECRET, { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null) return null
    const g = decoded as Partial<ImpersonationGrant>
    // `tid` is required, so a grant minted before it existed is simply invalid
    // rather than tenant-less. They live an hour; none outlive the deploy.
    if (!g.sub || !g.sas || !g.tid || !g.jti || !g.exp || !g.iat) return null
    return g as ImpersonationGrant
  } catch {
    return null
  }
}
