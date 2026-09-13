import type { AuthEventKind } from '../../db/enums'

/** Where a one-time code is checked: the member's sign-in code, or a second factor. */
const CODE_CHECKS = new Set([
  '/sign-in/email-otp',
  '/email-otp/check-verification-otp',
  '/email-otp/verify-email',
  '/two-factor/verify-otp',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
])

/** Where a one-time code is mailed. */
const CODE_REQUESTS = new Set(['/email-otp/send-verification-otp', '/two-factor/send-otp'])

/**
 * Which event, if any, a finished auth request was — read off its path and how
 * it ended, relative to the pool's base path.
 *
 * A **sign-in** is a request that arrived holding no session and ends holding a
 * new one, on a path whose job is signing in: the last step of it, whichever
 * that was. A correct password that still owes a second factor ends holding
 * nothing (the two-factor plugin deletes the half-made session first), so it is
 * not one yet; the factor that finishes it is. A session rotated for someone
 * already in is not a sign-in — confirming a new authenticator app on
 * `/two-factor/verify-totp` does that, as does enabling two-factor.
 *
 * A refused **password** is a failed sign-in; a refused **code**, of either
 * kind, is a failed code. A code request that was refused sent nothing.
 *
 * Sign-out is not decided here: by the end of the request the session, and so
 * who signed out, is gone. `authAudit` catches it as the session row is deleted.
 */
export function authEventKind(step: {
  path: string
  failed: boolean
  /** Did the request end holding a session made during it? */
  newSession: boolean
  /** Did it arrive holding one? */
  hadSession: boolean
}): AuthEventKind | null {
  const { path, failed, newSession, hadSession } = step
  if (newSession) {
    const signingIn = path.startsWith('/sign-in/') || path.startsWith('/two-factor/verify-')
    return signingIn && !hadSession ? 'sign_in' : null
  }
  if (failed) {
    if (path === '/sign-in/email') return 'sign_in_failed'
    return CODE_CHECKS.has(path) ? 'code_failed' : null
  }
  return CODE_REQUESTS.has(path) ? 'code_sent' : null
}
