import { originAllowed } from '../../lib/allowed-origins'

/**
 * Where a staff or member set-password link opened from an inbox hands over to
 * (#230): `callbackURL` with the link's token attached, or null when the
 * callback is not one of our frontends, and nothing may be redirected to.
 *
 * Better Auth's own GET for this link looks the token up first, and turns an
 * unknown one away. It cannot here: the link carries no studio, so the GET runs
 * outside any Tenant context, and once the auth tables are behind Row-Level
 * Security that lookup finds nothing and every link would read as invalid. So
 * nothing is looked up. The page the token lands on posts it back from inside
 * its studio's context, and that POST is where a used, expired or foreign token
 * is refused.
 *
 * The callback must be an absolute URL on an allowed origin — a relative one
 * would resolve against the API's own host, which serves no page.
 */
export function resetLinkRedirect(token: string, callbackURL: string | undefined): string | null {
  if (!callbackURL) return null
  let url: URL
  try {
    url = new URL(callbackURL)
  } catch {
    return null
  }
  if (!originAllowed(url.origin)) return null
  url.searchParams.set('token', token)
  return url.href
}
