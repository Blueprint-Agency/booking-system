import { BadRequestError } from '../../shared/errors'

/**
 * Slugs that can never belong to a tenant, because something else already
 * answers on that hostname — the super portal (`admin`), the API (`api`), the
 * portal wildcard's own label (`portal`), the staging namespace (`dev`,
 * `staging`), and the usual infrastructure labels. A tenant that registered
 * `admin` would take over the super portal's hostname.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'portal',
  'www',
  'dev',
  'staging',
  'app',
  'mail',
  'clerk',
  'assets',
]

/** A slug is one DNS label, so the label rules are the slug rules. */
const MIN_LENGTH = 3
const MAX_LENGTH = 63
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export type SlugRejection = 'slug_too_short' | 'slug_too_long' | 'slug_malformed' | 'slug_reserved'

export type SlugCheck = { ok: true; slug: string } | { ok: false; reason: SlugRejection }

/** Trim + lowercase. Casing must not be able to smuggle a reserved slug through. */
export function normaliseSlug(input: string): string {
  return input.trim().toLowerCase()
}

/**
 * Pure slug gate — the single place that decides whether a string may become a
 * tenant's subdomain. Returns the normalised slug rather than the input, so
 * callers store what was validated.
 */
export function checkSlug(input: string): SlugCheck {
  const slug = normaliseSlug(input)

  if (slug.length < MIN_LENGTH) return { ok: false, reason: 'slug_too_short' }
  if (slug.length > MAX_LENGTH) return { ok: false, reason: 'slug_too_long' }
  if (!LABEL.test(slug)) return { ok: false, reason: 'slug_malformed' }
  // `xn--` is IDNA's encoded-label prefix; a literal one would resolve to a
  // different name than it reads as.
  if (slug.startsWith('xn--')) return { ok: false, reason: 'slug_malformed' }
  if (RESERVED_SLUGS.includes(slug)) return { ok: false, reason: 'slug_reserved' }

  return { ok: true, slug }
}

/** `checkSlug` for call sites that want the normalised slug or a 400. */
export function assertUsableSlug(input: string): string {
  const result = checkSlug(input)
  if (!result.ok) throw new BadRequestError(result.reason, { slug: normaliseSlug(input) })
  return result.slug
}
