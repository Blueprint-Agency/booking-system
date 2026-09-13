import type { BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { parseSetCookieHeader, setRequestCookie } from 'better-auth/cookies'

/** The two-factor plugin's own cookie name, before the pool's prefix. */
const TWO_FACTOR_COOKIE = 'two_factor'

/** Where a password sign-in that still owes a second factor hands the challenge back. */
export const TWO_FACTOR_CHALLENGE_RESPONSE_HEADER = 'set-two-factor-challenge'

/** Where the portal sends it with the factor. */
export const TWO_FACTOR_CHALLENGE_REQUEST_HEADER = 'x-two-factor-challenge'

/**
 * The two-factor challenge as a header, the way `bearer()` makes the session one.
 *
 * A password that is right but owes a second factor ends in a signed cookie
 * naming the half-signed-in user, and `/two-factor/verify-*` reads it back. The
 * portal is on another host than the API, and its calls carry no cookies — so
 * that a stray session cookie on the API's host can never answer for a studio
 * the browser is not signed into (`readPoolSession`). Without this, a staff
 * member with 2FA enrolled could not finish signing in at all.
 *
 * So the challenge is copied out of `Set-Cookie` into a header the portal can
 * read, and copied back into the request's cookies when the portal presents it.
 * Nothing about it is weakened: it is the same signed, short-lived value, and it
 * proves only that a password was right a few minutes ago.
 */
export function twoFactorChallengeHeader() {
  return {
    id: 'two-factor-challenge-header',
    hooks: {
      before: [
        {
          // Only for a caller holding no session, which is what someone owing a
          // second factor is. Both this and `bearer()` answer by writing the
          // request's `Cookie` header, and the later hook's write replaces the
          // earlier's — so a challenge beside a bearer token would erase the
          // session the token names.
          matcher: context => {
            const headers = context.request?.headers ?? context.headers
            return Boolean(headers?.get(TWO_FACTOR_CHALLENGE_REQUEST_HEADER) && !headers.get('authorization'))
          },
          handler: createAuthMiddleware(async ctx => {
            const incoming = ctx.request?.headers ?? ctx.headers
            const challenge = incoming?.get(TWO_FACTOR_CHALLENGE_REQUEST_HEADER)
            if (!incoming || !challenge) return
            const headers = new Headers(incoming)
            setRequestCookie(headers, ctx.context.createAuthCookie(TWO_FACTOR_COOKIE).name, challenge)
            return { context: { headers } }
          }),
        },
      ],
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async ctx => {
            const setCookie = ctx.context.responseHeaders?.get('set-cookie')
            if (!setCookie) return
            const cookie = parseSetCookieHeader(setCookie).get(ctx.context.createAuthCookie(TWO_FACTOR_COOKIE).name)
            if (!cookie?.value || cookie['max-age'] === 0) return
            ctx.setHeader(TWO_FACTOR_CHALLENGE_RESPONSE_HEADER, cookie.value)
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
