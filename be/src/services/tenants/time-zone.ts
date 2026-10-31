import { BadRequestError } from '../../shared/errors'

/**
 * The IANA zone a studio is created on, or a 400 saying why not.
 *
 * A studio's zone is fixed at creation and decides when its jobs fire and
 * what its days are, so the super portal's create route takes none on trust:
 * a request that names no zone is `timezone_required` (no studio ever lands on
 * another's clock by omission), and one that names something the runtime does
 * not know as a zone is `timezone_invalid`.
 *
 * Validated against the runtime's own zone database rather than a list kept
 * here. `Intl` also accepts a fixed offset like `+08:00` as a zone, which is
 * not an IANA zone and has no daylight-saving rules, so offsets are refused.
 * The name is kept as given (trimmed), not rewritten to the runtime's
 * canonical spelling, which still maps `Asia/Kolkata` back to `Asia/Calcutta`.
 */
export function requireStudioTimeZone(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) throw new BadRequestError('timezone_required')
  if (/^[+-]/.test(name)) throw new BadRequestError('timezone_invalid')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return name
  } catch {
    throw new BadRequestError('timezone_invalid')
  }
}
