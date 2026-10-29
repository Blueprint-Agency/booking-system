import { BadRequestError } from '../../shared/errors'

const BIO_MAX = 2000

/**
 * The one bio limit, on every path that writes a staff member's bio: the
 * Instructor's own Profile, the Admin's staff edit and the Instructor create.
 * A bio past it that is the one already stored passes, so a profile saved
 * with its bio unchanged is not refused for a bio written before the limit.
 */
export function assertBioWithin(bio: string | null | undefined, stored: string | null = null): void {
  if (bio == null || bio === stored || bio.length <= BIO_MAX) return
  throw new BadRequestError('invalid_request', { message: `A bio is at most ${BIO_MAX} characters.` })
}
