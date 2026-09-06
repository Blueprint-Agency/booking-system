/**
 * Origin patterns — the one allowlist the backend compares a browser's `Origin`
 * (and a Clerk token's `azp`) against.
 *
 * Every tenant is a subdomain: `{slug}.reservetoday.app` for the member app,
 * `{slug}.portal.reservetoday.app` for the staff one, with a `dev.` level in
 * staging and `.localhost:PORT` locally. A single-valued `PORTAL_ORIGIN` /
 * `CLIENT_ORIGIN` could not express that — and, being one value, named one
 * studio — so origins are configured as *patterns* with a leading `*` label and
 * matched here.
 *
 * The wildcard is deliberately **one label**, not "any depth". That is not a
 * simplification — it is the boundary the certificates already enforce
 * (RFC 6125: a wildcard certificate covers exactly one label), so
 * `a.b.reservetoday.app` is unserveable in production and must not be
 * allowlisted here either.
 *
 * The matched label *is* the tenant slug, which is what lets a public request's
 * `X-Tenant-Slug` be checked against the browser it came from.
 */

export type OriginPattern = {
  /** The pattern as configured, for logs and error messages. */
  raw: string
  protocol: string
  port: string
  /** Everything after the wildcard label — the host itself when not a wildcard. */
  suffix: string
  wildcard: boolean
}

/**
 * Parse one configured pattern. Returns null for anything unparseable, so a
 * typo in the environment drops that entry rather than widening the allowlist.
 */
export function parseOriginPattern(raw: string): OriginPattern | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const wildcard = trimmed.includes('://*.')
  // A `*` anywhere other than the leftmost label is a mistake we refuse to guess
  // at — `https://portal.*.example.com` is not a legal DNS record either.
  if (!wildcard && trimmed.includes('*')) return null

  let url: URL
  try {
    url = new URL(wildcard ? trimmed.replace('://*.', '://wildcard.') : trimmed)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  const suffix = wildcard ? host.replace(/^wildcard\./, '') : host
  if (!suffix || (wildcard && suffix === host)) return null

  return { raw: trimmed, protocol: url.protocol, port: url.port, suffix, wildcard }
}

/** Parse every comma-separated source into one flat, de-duplicated allowlist. */
export function parseOriginPatterns(...sources: Array<string | undefined | null>): OriginPattern[] {
  const seen = new Set<string>()
  const patterns: OriginPattern[] = []
  for (const source of sources) {
    for (const entry of (source ?? '').split(',')) {
      const pattern = parseOriginPattern(entry)
      if (!pattern || seen.has(pattern.raw)) continue
      seen.add(pattern.raw)
      patterns.push(pattern)
    }
  }
  return patterns
}

export type OriginMatch = {
  /** The wildcard label the origin filled in — the tenant slug — or null when
   *  the pattern is an exact origin and so names no tenant. */
  label: string | null
}

/** Match one origin against one pattern. Null means "no match". */
export function matchOriginPattern(origin: string, pattern: OriginPattern): OriginMatch | null {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.protocol !== pattern.protocol) return null
  if (url.port !== pattern.port) return null

  const hostname = url.hostname.toLowerCase()
  if (!pattern.wildcard) return hostname === pattern.suffix ? { label: null } : null

  if (!hostname.endsWith(`.${pattern.suffix}`)) return null
  const label = hostname.slice(0, -(pattern.suffix.length + 1))
  // Exactly one label, for the certificate reason in the file header.
  if (!label || label.includes('.')) return null
  return { label }
}

export function isAllowedOrigin(origin: string, patterns: OriginPattern[]): boolean {
  return patterns.some(pattern => matchOriginPattern(origin, pattern) !== null)
}

/**
 * The tenant slug an `Origin` header names, or null.
 *
 * Null carries two different meanings on purpose, and the caller must treat them
 * the same way: the origin is not allowlisted at all (CORS has already refused
 * it), or it is allowlisted but names no tenant — the bare root domain, or a
 * single-tenant local origin like `http://localhost:3000`. Neither is evidence
 * about which tenant the caller meant, so neither may refuse a slug.
 */
export function tenantSlugFromOrigin(origin: string, patterns: OriginPattern[]): string | null {
  for (const pattern of patterns) {
    const match = matchOriginPattern(origin, pattern)
    if (match?.label) return match.label
  }
  return null
}

/**
 * The inverse: a tenant slug and which app, back to the origin that serves it.
 *
 * The same allowlist read backwards, on purpose. "Creating a tenant needs no
 * deployment" is only true if the URL a new studio is handed is derived from the
 * wildcard that already resolves — a second, separately configured base URL
 * would be one deploy away from disagreeing with the origin CORS accepts, and
 * the super portal would hand out a link that 403s.
 *
 * The portal pattern is the wildcard whose suffix begins with the `portal.`
 * label (`*.portal.reservetoday.app`); the client pattern is the wildcard that
 * does not (`*.reservetoday.app`). Returns null when this environment has no
 * wildcard for that app — a single-origin local setup, where there is no
 * per-tenant URL to give.
 */
export function tenantOriginFor(
  app: 'client' | 'portal',
  slug: string,
  patterns: OriginPattern[],
): string | null {
  const wanted = app === 'portal'
  const pattern = patterns.find(
    candidate => candidate.wildcard && candidate.suffix.startsWith('portal.') === wanted,
  )
  if (!pattern) return null
  const port = pattern.port ? `:${pattern.port}` : ''
  return `${pattern.protocol}//${slug}.${pattern.suffix}${port}`
}
