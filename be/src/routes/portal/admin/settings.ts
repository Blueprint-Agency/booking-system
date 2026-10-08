import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { tenantId } from '../../../middleware/tenant'
import { readReceiptDetails, saveReceiptDetails } from '../../../services/receipts/details'
import { receiptDetailsBody, receiptDetailsInput, serializeReceiptDetails } from '../receipt-details'

/**
 * The studio's own settings. Today the receipt details (#391): the prefix its
 * Receipt numbers carry and the business details its Receipts print, with the
 * number the next Receipt will take. Saving them reaches only Receipts issued
 * afterwards.
 */
const app = new Hono()
  .get('/receipt-details', async c => c.json(serializeReceiptDetails(await readReceiptDetails(tenantId(c)))))
  .put('/receipt-details', zValidator('json', receiptDetailsBody), async c => {
    const view = await saveReceiptDetails(tenantId(c), receiptDetailsInput(c.req.valid('json')))
    return c.json(serializeReceiptDetails(view))
  })

export default app
