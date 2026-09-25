import { Hono } from 'hono'
import { OFF_REQUEST_RETRY } from '../../lib/outbound'
import { verifyTenantDelivery } from '../../services/billing/webhook-verification'
import { resolveTenantBySlug } from '../../services/tenants/tenants'
import { handleStripeEvent } from '../../services/billing/webhook-handler'
import { ERROR_CODES } from '../../shared/error-codes'
import { logger, setLogContext } from '../../shared/logger'

/**
 * The payment provider's deliveries: one endpoint per studio,
 * `/stripe/:slug`, on that studio's own account. The platform account's shared
 * `/stripe` endpoint is gone (#293) along with the platform account itself.
 *
 * The slug is there because the signature check needs an answer *first*. Each
 * studio's account signs with its own secret, so "which studio is this?" has to
 * be settled before anything in the body can be trusted — and the body is
 * exactly what cannot be read yet. The URL is the only part of a delivery that
 * is fixed when the endpoint is registered on the studio's account, so the URL
 * carries the studio.
 *
 * That ordering is also what makes a cross-studio delivery impossible rather
 * than merely unlikely. One slug selects one secret; a delivery signed by
 * another studio's account fails the check and is refused. No secret is ever
 * tried second.
 */
const app = new Hono()
  /**
   * A studio's own account delivering to its own endpoint.
   *
   * Every refusal here is the same shape on purpose — an unknown slug, a studio
   * that has no account of its own, and a bad signature are all a flat 400 with
   * no detail. An endpoint that answered differently would let anyone with a
   * URL enumerate which studios exist and which of them take their own money.
   */
  .post('/stripe/:slug', async c => {
    setLogContext({ webhook: 'stripe' })
    const slug = c.req.param('slug')
    const body = await c.req.text()
    const sig = c.req.header('stripe-signature') ?? ''

    const resolved = await resolveTenantBySlug(slug)
    if (!resolved) return c.json({ error: ERROR_CODES.invalid_webhook_signature }, 400)
    const tenantId = resolved.tenant.id

    const delivery = await verifyTenantDelivery(tenantId, body, sig)
    if (!delivery) {
      logger.warn({ tenantId }, 'stripe-webhook: signature refused')
      return c.json({ error: ERROR_CODES.invalid_webhook_signature }, 400)
    }
    const event = delivery.event

    try {
      // The studio the URL named, carried through: the handler routes off the
      // signed body, and a body that routes anywhere else is a delivery this
      // endpoint has no business acting on.
      //
      // And the account that signed it (#97), which is the account the money is
      // on — stamped onto every payment this delivery writes, so a Refund years
      // later is issued there and not wherever the studio sells by then.
      //
      // Off the request path, so vendor calls made while handling it retry.
      await handleStripeEvent(event, tenantId, delivery.accountId, {
        retry: OFF_REQUEST_RETRY,
      })
    } catch (err) {
      logger.error(
        { err, tenantId, eventId: event?.id, eventType: event?.type },
        'stripe-webhook handler error',
      )
      return c.json({ error: ERROR_CODES.handler_failed }, 500)
    }

    return c.json({ received: true })
  })

export default app
