import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { stripeForTenant } from '../../lib/stripe'
import { outbound, VendorTimeoutError } from '../../lib/outbound'
import { AppError, NotFoundError } from '../../shared/errors'
import { ERROR_CODES } from '../../shared/error-codes'
import { quoteCrossLocationAddOn } from '../../services/packages/purchase'
import {
  beginCrossLocationCheckout,
  beginPackageCheckout,
} from '../../services/packages/checkout'
import { beginWorkshopCheckout } from '../../services/workshops/checkout'
import {
  beginMerchCheckout,
  listMerchOrders,
  serializeMerchOrder,
} from '../../services/catalog/merch-orders'
import { createCheckoutSession } from '../../services/billing/checkout-session'
import {
  listOpenPurchases,
  openPurchaseById,
  partPaymentEnabled,
  resumePurchaseCheckout,
  PART_PAYMENT_FLOOR_CENTS,
  type OpenPurchaseView,
} from '../../services/billing/open-purchases'
import { describeProduct, previewPromoCode } from '../../services/packages/promo-redemption'
import { requireTenantUrl } from '../../services/tenants/urls'
import { tenantId } from '../../middleware/tenant'

/**
 * Part Payment (#93): how much of the price to put on this card.
 *
 * Dollars on the wire because that is what the member typed, cents everywhere
 * behind it. Absent — the default and the shape of every sale before this —
 * charges the whole price. The number is **not** trusted: the service checks it
 * against the Balance it reads for itself, refuses anything larger, and ignores
 * it outright where the studio has Part Payment switched off.
 */
const partPaymentSgd = z
  .number({ message: 'Enter an amount to pay now.' })
  .positive('Enter an amount to pay now.')
  .max(999999)
  .optional()

/** Dollars as the member typed them, in cents, or null for the whole price. */
const requestedCents = (sgd: number | undefined): number | null =>
  sgd === undefined ? null : Math.round(sgd * 100)

/**
 * Where Stripe sends the member back to.
 *
 * A whole-price sale lands on its own confirmation — the plan it granted, the
 * workshop it booked. A part payment lands on the **balance** page instead: it
 * granted nothing, so "you're all set" would be a lie told at exactly the
 * moment the member is deciding whether they still have to do something. That
 * page reads the outstanding balance back from the server and offers the next
 * card. Note that a part payment intended to settle the whole thing still lands
 * there, and the page then says so — it asks the server rather than assuming.
 */
const balanceAware = (clientUrl: string, partSgd: number | undefined, query: string): string =>
  `${clientUrl}/booking/confirmation?${partSgd === undefined ? query : 'type=balance'}&session_id={CHECKOUT_SESSION_ID}`

const checkoutPackageSchema = z.object({
  package_kind: z.enum(['class', 'pt']),
  package_id: z.string().uuid(),
  promo_code: z.string().optional(),
  part_payment_sgd: partPaymentSgd,
  /** Home Location — required for an Unlimited Plan, refused for anything else (§1). */
  location_id: z.string().uuid().optional(),
  /** The instructor picked for an Instructor-Bound PT package — required for
   *  one, refused for anything else (#109). */
  instructor_id: z.string().uuid().optional(),
  /** Buy the Cross-Location Add-On with the plan — one session, two line items (§5). */
  cross_location_add_on: z.boolean().optional(),
})

const crossLocationSchema = z.object({
  /** The plan the Add-On attaches to. It belongs to one plan, never to a member. */
  client_package_id: z.string().uuid(),
})

// The product travels with the code (§11) — without it the endpoint cannot
// answer the scope case. Either a package or a workshop tier, never both.
const validatePromoSchema = z.intersection(
  z.object({ code: z.string().min(1) }),
  z.union([
    z.object({
      package_kind: z.enum(['class', 'pt']),
      package_id: z.string().uuid(),
    }),
    z.object({
      workshop_id: z.string().uuid(),
      workshop_tier_id: z.string().uuid(),
    }),
  ]),
)

const checkoutWorkshopSchema = z.object({
  workshop_id: z.string().uuid(),
  workshop_tier_id: z.string().uuid(),
  promo_code: z.string().optional(),
  part_payment_sgd: partPaymentSgd,
})

/** Resuming an unfinished Purchase. No amount pays whatever is still owed. */
const resumeSchema = z.object({ part_payment_sgd: partPaymentSgd })

const purchaseParam = z.object({ id: z.string().uuid() })

/** An open Purchase as the account page reads it. */
const serializeOpenPurchase = (p: OpenPurchaseView) => ({
  id: p.id,
  kind: p.kind,
  item_name: p.itemName,
  total_sgd: p.totalSgd,
  paid_sgd: p.paidSgd,
  outstanding_sgd: p.outstandingSgd,
  must_pay_in_full: p.mustPayInFull,
  part_paid_at: p.partPaidAt,
  created_at: p.createdAt,
})

const app = new Hono()
  // A preview, not a claim: the place is claimed when checkout starts. A refusal
  // is an answer rather than an error, so it comes back 200 with the member's
  // own sentence — the same sentence the checkout refusal carries.
  .post('/checkout/validate-promo', zValidator('json', validatePromoSchema), async c => {
    const clientId = c.get('clientId')
    const body = c.req.valid('json')
    const item = await describeProduct(
      tenantId(c),
      'package_id' in body
        ? { packageKind: body.package_kind, packageId: body.package_id }
        : { workshopId: body.workshop_id, workshopTierId: body.workshop_tier_id },
    )
    try {
      const applied = await previewPromoCode({
        tenantId: tenantId(c),
        codeText: body.code,
        clientId,
        product: item.product,
        productName: item.name,
        basePriceSgd: item.basePriceSgd,
      })
      return c.json({
        valid: true,
        promo_code_id: applied.promoCodeId,
        code: applied.code,
        label: applied.label,
        discount_sgd: applied.discountSgd,
        effective_price_sgd: applied.effectivePriceSgd,
      })
    } catch (err) {
      if (err instanceof AppError && err.code === 'promo_code_invalid') {
        return c.json({ valid: false, ...(err.details ?? {}) }, 200)
      }
      throw err
    }
  })
  .post('/checkout/package', zValidator('json', checkoutPackageSchema), async c => {
    const body = c.req.valid('json')
    const quote = await beginPackageCheckout({
      tenantId: tenantId(c),
      clientId: c.get('clientId'),
      packageKind: body.package_kind,
      packageId: body.package_id,
      promoCode: body.promo_code,
      locationId: body.location_id,
      instructorId: body.instructor_id,
      crossLocationAddOn: body.cross_location_add_on,
    })
    if (quote.outcome === 'granted') {
      return c.json({ outcome: 'granted', client_package_id: quote.clientPackageId, free: true }, 201)
    }
    // Where Stripe sends the member back to — this studio's app, not the
    // platform's one configured origin. A member of the second studio used to
    // finish paying and land on the first studio's confirmation page, signed
    // out, looking at somebody else's booking app.
    const clientUrl = await requireTenantUrl('client', tenantId(c))
    const url = await createCheckoutSession({
      tenantId: tenantId(c),
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: quote.expiresAt,
      metadata: quote.metadata,
      // A part payment lands on the balance page, not the "you're all set" one:
      // it has granted nothing, and a confirmation screen saying otherwise is
      // the single most misleading thing this flow could do (#93).
      successUrl: balanceAware(
        clientUrl,
        body.part_payment_sgd,
        `type=package&package_id=${body.package_id}&package_kind=${body.package_kind}`,
      ),
      cancelUrl: `${clientUrl}/checkout?package=${body.package_id}&kind=${body.package_kind}&cancelled=1`,
      requestedPartPaymentCents: requestedCents(body.part_payment_sgd),
    })
    return c.json({ url })
  })
  // The Add-On bought later against a plan the member already holds (§5). Its
  // own session, told apart by the `kind` metadata, which names the plan the
  // webhook must fill the column on. A quote first, so the member sees the
  // months-times-rate arithmetic before they are asked to pay it.
  .post('/checkout/cross-location/quote', zValidator('json', crossLocationSchema), async c => {
    const q = await quoteCrossLocationAddOn(
      tenantId(c),
      c.get('clientId'),
      c.req.valid('json').client_package_id,
    )
    return c.json({
      client_package_id: q.clientPackageId,
      months: q.months,
      rate_sgd: q.rateSgd,
      price_sgd: q.priceSgd,
    })
  })
  .post('/checkout/cross-location', zValidator('json', crossLocationSchema), async c => {
    const quote = await beginCrossLocationCheckout(
      tenantId(c),
      c.get('clientId'),
      c.req.valid('json').client_package_id,
    )
    const clientUrl = await requireTenantUrl('client', tenantId(c))
    const url = await createCheckoutSession({
      tenantId: tenantId(c),
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: null,
      metadata: quote.metadata,
      successUrl: `${clientUrl}/booking/confirmation?type=cross_location&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${clientUrl}/account?cancelled=1`,
    })
    return c.json({ url })
  })
  // Merch: one item, no Promo Code, no review page. Paid for online and handed
  // over at the studio, which is what the client app's notice says.
  .post('/checkout/merch', zValidator('json', z.object({ merch_id: z.string().uuid() })), async c => {
    const { merch_id } = c.req.valid('json')
    const quote = await beginMerchCheckout({
      tenantId: tenantId(c),
      clientId: c.get('clientId'),
      merchId: merch_id,
    })
    if (quote.outcome === 'granted') {
      return c.json({ outcome: 'granted', order_id: quote.orderId, free: true }, 201)
    }
    const clientUrl = await requireTenantUrl('client', tenantId(c))
    const url = await createCheckoutSession({
      tenantId: tenantId(c),
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: quote.expiresAt,
      metadata: quote.metadata,
      successUrl: `${clientUrl}/booking/confirmation?type=merch&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${clientUrl}/merch?cancelled=1`,
    })
    return c.json({ url })
  })
  // What this studio offers at checkout, before there is anything to buy.
  // Read on the checkout page so the Part Payment checkbox is absent — not
  // disabled — where the studio has not turned it on.
  .get('/checkout/options', async c => {
    return c.json({
      part_payment: {
        enabled: await partPaymentEnabled(tenantId(c)),
        floor_sgd: (PART_PAYMENT_FLOOR_CENTS / 100).toFixed(2),
      },
    })
  })
  // Unfinished purchases — a Balance the member left outstanding. They do not
  // expire, so this is a list the member can come back to whenever they like.
  .get('/purchases/open', async c => {
    const rows = await listOpenPurchases(tenantId(c), c.get('clientId'))
    return c.json({ purchases: rows.map(serializeOpenPurchase) })
  })
  // Pay more towards one. A fresh session for whatever is still owed, minted
  // from the Balance in the database — the body says how much of it to charge
  // and nothing else. The predecessor session dies before this one exists.
  .post(
    '/purchases/:id/resume',
    zValidator('param', purchaseParam),
    zValidator('json', resumeSchema),
    async c => {
      const result = await resumePurchaseCheckout({
        tenantId: tenantId(c),
        clientId: c.get('clientId'),
        email: c.get('clientRow').email,
        purchaseId: c.req.valid('param').id,
        requestedCents: requestedCents(c.req.valid('json').part_payment_sgd),
      })
      return c.json({
        url: result.url,
        charged_sgd: result.chargedSgd,
        outstanding_after_sgd: result.outstandingSgd,
      })
    },
  )
  // Purchase history: what the member bought and is collecting at the studio.
  .get('/merch-orders', async c => {
    const rows = await listMerchOrders(tenantId(c), c.get('clientId'))
    return c.json({ orders: rows.map(serializeMerchOrder) })
  })
  .post('/checkout/workshop', zValidator('json', checkoutWorkshopSchema), async c => {
    const body = c.req.valid('json')
    const quote = await beginWorkshopCheckout(tenantId(c), {
      clientId: c.get('clientId'),
      workshopId: body.workshop_id,
      workshopTierId: body.workshop_tier_id,
      promoCode: body.promo_code,
    })
    if (quote.outcome === 'granted') {
      return c.json({ outcome: 'granted', booking_id: quote.bookingId, free: true }, 201)
    }
    const clientUrl = await requireTenantUrl('client', tenantId(c))
    const url = await createCheckoutSession({
      tenantId: tenantId(c),
      email: c.get('clientRow').email,
      lines: quote.lines,
      expiresAt: quote.expiresAt,
      metadata: quote.metadata,
      successUrl: balanceAware(
        clientUrl,
        body.part_payment_sgd,
        `type=workshop&workshop_id=${body.workshop_id}&workshop_tier_id=${body.workshop_tier_id}`,
      ),
      cancelUrl: `${clientUrl}/checkout?workshop=${body.workshop_id}&tier=${body.workshop_tier_id}&cancelled=1`,
      requestedPartPaymentCents: requestedCents(body.part_payment_sgd),
    })
    return c.json({ url })
  })
  // Called by the confirmation page after Stripe redirects back.
  // Idempotent — safe to call multiple times. Handles the case where the webhook
  // hasn't fired yet (no Stripe CLI listener in local dev).
  .post('/checkout/sync-session', zValidator('json', z.object({ session_id: z.string() })), async c => {
    const { session_id } = c.req.valid('json')
    const clientId = c.get('clientId')

    const stripe = await stripeForTenant(tenantId(c))
    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>
    try {
      session = await outbound('stripe', 'checkout.sessions.retrieve', () =>
        stripe.checkout.sessions.retrieve(session_id),
      )
    } catch (err) {
      if (err instanceof VendorTimeoutError) throw err
      throw new NotFoundError('session_not_found')
    }

    if (session.metadata?.client_id !== clientId) {
      return c.json({ error: ERROR_CODES.forbidden }, 403)
    }

    if (session.payment_status !== 'paid') {
      return c.json({ status: 'pending' })
    }

    const { handleStripeEvent } = await import('../../services/billing/webhook-handler')
    await handleStripeEvent({
      type: 'checkout.session.completed',
      data: { object: session },
    } as any)

    // What this payment left behind (#93). The confirmation page cannot work it
    // out: a part payment may have cleared the Balance or may have left some of
    // it, and the member may hold a *different* unfinished purchase besides — so
    // "does this member owe anything" is the wrong question and this answers the
    // right one, about the Purchase this session was for. Null where the session
    // names no Purchase, or where it is settled: both mean nothing is owed here.
    const purchaseId = session.metadata?.purchase_id
    const purchase = purchaseId
      ? await openPurchaseById(tenantId(c), clientId, purchaseId)
      : null
    return c.json({
      status: 'granted',
      purchase: purchase ? serializeOpenPurchase(purchase) : null,
    })
  })

export default app
