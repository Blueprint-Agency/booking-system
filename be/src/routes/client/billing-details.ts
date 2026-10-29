import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { tenantId } from '../../middleware/tenant'
import {
  addBillingDetails,
  deleteBillingDetails,
  editBillingDetails,
  listBillingDetails,
  makeDefaultBillingDetails,
  ownBillingDetails,
  type BillingDetails,
} from '../../services/billing-details/billing-details'
import { explainInvalid } from '../explain-invalid'

/**
 * The member's Billing details: `GET`, `POST /me/billing-details`,
 * `PATCH`, `DELETE /me/billing-details/:id` and
 * `POST /me/billing-details/:id/default`. Only ever the member's own, at this
 * studio; anything else is `404 billing_details_not_found`.
 *
 * The body is checked for shape here; what each field may hold — required,
 * how long, which countries — is the service's, so a checkout adding a set
 * cannot drift from this page.
 */

const view = (row: BillingDetails) => ({
  id: row.id,
  name: row.name,
  line1: row.line1,
  line2: row.line2,
  city: row.city,
  state: row.state,
  postcode: row.postcode,
  country: row.country,
  is_default: row.isDefault,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
})

/** A body of the wrong shape answers with a sentence a member can read, as a bad field does. */
const SHAPE_MESSAGE = 'Billing details are a name and an address, each written as text.'
const text = z.string({ message: SHAPE_MESSAGE })

const bodySchema = z.object(
  {
    name: text.optional(),
    line1: text.optional(),
    line2: text.nullable().optional(),
    city: text.optional(),
    state: text.nullable().optional(),
    postcode: text.optional(),
    country: text.optional(),
  },
  { message: SHAPE_MESSAGE },
)

const explainShape = explainInvalid(SHAPE_MESSAGE)

const idParam = z.object({ id: z.string().uuid() })

const app = new Hono()
  .get('/', async c => {
    const rows = await listBillingDetails(tenantId(c), c.get('clientId'))
    return c.json({ billing_details: rows.map(view) })
  })
  .post('/', zValidator('json', bodySchema, explainShape), async c => {
    const row = await addBillingDetails(tenantId(c), c.get('clientId'), c.req.valid('json'))
    return c.json({ billing_details: view(row) }, 201)
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const row = await ownBillingDetails(tenantId(c), c.get('clientId'), c.req.valid('param').id)
    return c.json({ billing_details: view(row) })
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', bodySchema, explainShape), async c => {
    const row = await editBillingDetails(tenantId(c), c.get('clientId'), c.req.valid('param').id, c.req.valid('json'))
    return c.json({ billing_details: view(row) })
  })
  .delete('/:id', zValidator('param', idParam), async c => {
    await deleteBillingDetails(tenantId(c), c.get('clientId'), c.req.valid('param').id)
    return c.json({ deleted: true })
  })
  .post('/:id/default', zValidator('param', idParam), async c => {
    const row = await makeDefaultBillingDetails(tenantId(c), c.get('clientId'), c.req.valid('param').id)
    return c.json({ billing_details: view(row) })
  })

export default app
