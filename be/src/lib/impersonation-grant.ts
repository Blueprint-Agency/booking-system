import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { env } from '../env'

/**
 * BE-signed grant JWT proving that a /api/v1/me/* call is being made by a
 * superadmin impersonating a specific client. Separate from the member's session
 * (which carries the *target client's* identity): the grant is the proof that a
 * superadmin is behind it, and names them for the audit log (#118).
 *
 *   sub — the impersonated client's `client` pool auth user id (the session's user)
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

/** 1h — and the impersonation session it goes with lives exactly as long. */
export const GRANT_TTL_SECONDS = 60 * 60

export function signGrant(input: {
  clientAuthUserId: string
  superadminStaffId: string
  tenantId: string
}): string {
  const payload: Omit<ImpersonationGrant, 'iat' | 'exp'> = {
    sub: input.clientAuthUserId,
    sas: input.superadminStaffId,
    tid: input.tenantId,
    jti: randomUUID(),
  }
  return jwt.sign(payload, env.IMPERSONATION_SECRET, {
    algorithm: 'HS256',
    expiresIn: GRANT_TTL_SECONDS,
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
