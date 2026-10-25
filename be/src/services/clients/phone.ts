import { BadRequestError } from '../../shared/errors'

const PHONE_MAX = 40
const PHONE_SHAPE = /^\+?[0-9()\- ]+$/

/**
 * A member's phone, as every path that writes one takes it: sign-up, Add
 * customer and both profile edits. Trimmed, required, at most 40 characters,
 * and written as people write one: an optional leading +, then digits grouped
 * by spaces, hyphens or brackets, 7 to 15 digits in all (E.164's most).
 * Looser than the country-aware check the sign-up and Add customer forms run in
 * the browser, so a number already on file in a local format still saves, but
 * text that is not a number at all is refused (#257).
 */
export function clientPhone(value: string): string {
  const phone = value.trim()
  if (!phone) throw new BadRequestError('phone_required', { message: 'A phone number is required.' })
  if (phone.length > PHONE_MAX) {
    throw new BadRequestError('invalid_request', { message: `A phone number is at most ${PHONE_MAX} characters.` })
  }
  const digits = phone.replace(/\D/g, '').length
  if (!PHONE_SHAPE.test(phone) || digits < 7 || digits > 15) {
    throw new BadRequestError('invalid_request', {
      message: 'A phone number is 7 to 15 digits, optionally starting with +.',
    })
  }
  return phone
}
