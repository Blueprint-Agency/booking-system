import type { SessionAtStudio } from '../../services/auth/auth-users'

/**
 * A session on a member's or staff member's detail view (#119). No token: the
 * portal names a session to show it, never to use it.
 */
export function sessionView(s: SessionAtStudio) {
  return {
    id: s.id,
    signed_in_at: s.signedInAt,
    last_seen_at: s.lastSeenAt,
    expires_at: s.expiresAt,
    ip: s.ip,
    user_agent: s.userAgent,
    impersonated: s.impersonated,
  }
}
