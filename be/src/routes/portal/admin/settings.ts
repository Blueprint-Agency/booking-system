import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { tenantId } from '../../../middleware/tenant'
import { readBusinessDetails, saveBusinessDetails } from '../../../services/tenants/business-details'
import { businessDetailsBody, businessDetailsInput, serializeBusinessDetails } from '../../business-details'

/**
 * The studio's own settings. Today its Business details (#391, #398): the
 * Business name it trades under, what its Receipts print beside it and the
 * prefix their numbers carry, with the number the next Receipt will take.
 * Saving them reaches only Receipts issued afterwards.
 */
const app = new Hono()
  .get('/business-details', async c => c.json(serializeBusinessDetails(await readBusinessDetails(tenantId(c)))))
  .put('/business-details', zValidator('json', businessDetailsBody), async c => {
    const view = await saveBusinessDetails(tenantId(c), businessDetailsInput(c.req.valid('json')))
    return c.json(serializeBusinessDetails(view))
  })

export default app
