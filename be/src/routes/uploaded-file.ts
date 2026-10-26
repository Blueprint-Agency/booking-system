import type { Context } from 'hono'
import { BadRequestError } from '../shared/errors'
import type { ErrorCode } from '../shared/error-codes'

const MULTIPART = /^multipart\/form-data\s*(;|$)/i

/**
 * Headroom over a file limit for the multipart framing around the file. A
 * route's `bodyLimit` is its file limit plus this: the body is always larger
 * than the file it carries, so a cap at the file limit exactly would refuse a
 * file just under it. The exact byte rule stays the service's.
 */
export const MULTIPART_ENVELOPE_BYTES = 16 * 1024

/**
 * The file an upload route was sent, as the multipart field `file`.
 *
 * One copy for every upload route (merch photo, Supporting Document, Profile
 * picture), so they
 * refuse a bad request the same way, before any service runs and with nothing
 * written:
 *
 *  - a body that is not `multipart/form-data`, or that does not parse as it, is
 *    400 `invalid_request`, the code a malformed body gets everywhere else.
 *    `c.req.formData()` throws a TypeError on either, which would otherwise
 *    reach the error handler as an unhandled 500;
 *  - a form with no file in `file` is 400 with the route's own `missing` code.
 *
 * `bodyLimit` has already read the whole body by the time this runs, so the only
 * error parsing can raise here is the body not being a form.
 */
export async function uploadedFile(c: Context, missing: { code: ErrorCode; message: string }): Promise<File> {
  const notAForm = () =>
    new BadRequestError('invalid_request', { message: 'Send the file as multipart/form-data, in the field `file`.' })
  if (!MULTIPART.test(c.req.header('Content-Type') ?? '')) throw notAForm()
  let form: FormData
  try {
    form = await c.req.formData()
  } catch (err) {
    if (err instanceof TypeError) throw notAForm()
    throw err
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw new BadRequestError(missing.code, { message: missing.message })
  return file
}
