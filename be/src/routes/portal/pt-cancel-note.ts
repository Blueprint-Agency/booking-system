import type { Context } from 'hono'
import { z } from 'zod'
import { BadRequestError } from '../../shared/errors'

const cancelBody = z.object({
  note: z.string().max(500).nullable().optional(),
})

/**
 * The staff reason on a PT cancel, from a body that may not be there at all.
 *
 * Read here rather than through `zValidator('json')`, which answers 400 to a
 * JSON Content-Type with an empty body — and a cancel has always been a bare
 * POST, so every caller that sends the header without one would be refused
 * before the cancel ran. No body, or no `note`, is no reason; a body that is
 * there must be the right shape. One copy for the admin and instructor routes.
 */
export async function ptCancelNote(c: Context): Promise<string | null> {
  const text = (await c.req.text()).trim()
  if (!text) return null
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new BadRequestError('invalid_request')
  }
  return cancelBody.parse(body).note ?? null
}
