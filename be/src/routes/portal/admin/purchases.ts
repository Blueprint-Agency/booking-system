import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { tenantId } from '../../../middleware/tenant'
import {
  listSilentPartPaidPurchases,
  type SilentPurchaseView,
} from '../../../services/billing/open-purchases'
import { issueOpenPurchaseRefund } from '../../../services/billing/refunds'
import { issuedRefundView } from './refund-view'
import { abandonedReturnLine, SILENT_AFTER_DAYS } from '../../../services/billing/refund-notice'

/**
 * Purchases that were part-paid and never granted (#95).
 *
 * A surface of its own rather than a tab on Finance, because these are not
 * Money Events: the studio is holding cash against a sale that never happened,
 * which is a thing to settle rather than a thing to report. Finance says so
 * explicitly — it deliberately exposes no endpoint that edits a purchase or a
 * Refund — and this list exists precisely to be acted on.
 *
 * Two routes and no third. There is no sweep, no reminder job and no "dismiss":
 * money moving back to a member without a person choosing it is not an
 * improvement on money sitting still, so the whole feature is a list and a
 * button. A studio that would rather keep the money and be generous grants a
 * comp package, which is a different action in a different place.
 */

const idParam = z.object({ id: z.string().uuid() })

// The reason is mandatory, exactly as it is on an ordinary Refund: it is the
// only record of why the studio gave this money back.
const refundSchema = z.object({ reason: z.string().min(1).max(2000) })

function silentView(p: SilentPurchaseView) {
  return {
    id: p.id,
    kind: p.kind,
    item_name: p.itemName,
    client_id: p.clientId,
    client_name: p.clientName,
    client_email: p.clientEmail,
    total_sgd: p.totalSgd,
    paid_sgd: p.paidSgd,
    outstanding_sgd: p.outstandingSgd,
    part_paid_at: p.partPaidAt,
    last_payment_at: p.lastPaymentAt,
    days_silent: p.daysSilent,
    // The sentence is composed on this side of the wire, like every other
    // notice in the billing surfaces — the portal derives no domain rule.
    silence_notice: p.silenceNotice,
    payment_count: p.paymentCount,
    refund_progress: p.refundProgress,
    created_at: p.createdAt,
    grants_nothing: true,
  }
}

const app = new Hono()
  // Everything the studio is holding against nothing granted, that nobody has
  // touched in a long time. Unpaginated on purpose: a studio with enough of
  // these to need pages has a problem this list is not the answer to.
  .get('/silent', async c => {
    const rows = await listSilentPartPaidPurchases(tenantId(c))
    return c.json({
      purchases: rows.map(silentView),
      // What "silent" means, so the portal can say it rather than guess it.
      silent_after_days: SILENT_AFTER_DAYS,
    })
  })
  // Give the money back. The handler calls the payment provider and returns —
  // the `charge.refunded` webhook closes the Purchase as abandoned and emails
  // the member, so a refund issued here and one issued from the provider's
  // dashboard produce the identical outcome.
  .post('/:id/refund', zValidator('param', idParam), zValidator('json', refundSchema), async c => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await issueOpenPurchaseRefund({
      tenantId: tenantId(c),
      purchaseId: id,
      reason: body.reason,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'purchases', id })
    const paymentCount = result.paymentIntentIds.length
    return c.json({
      refunded: true,
      payment_count: paymentCount,
      returned_sgd: result.returnedSgd,
      // What landed at the provider, in the terms the statement uses. One press
      // of the button becomes one return per payment, and an admin reconciling
      // the month should not have to work that out from the count alone.
      returned_line: abandonedReturnLine(paymentCount, result.returnedSgd),
      // `complete` false when the provider refused a payment after returning an
      // earlier one (#275): part of the money went back, and the admin must be told.
      ...issuedRefundView(result),
    })
  })

export default app
