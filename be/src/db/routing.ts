import { sql } from 'drizzle-orm'
import { db } from './index'
import { captureException } from '../instrument'
import { logger } from '../shared/logger'

/**
 * Tenant routing for callers that arrive without one.
 *
 * Everything else on this backend learns its tenant from the request — a header
 * the frontend proxy sets, resolved by `resolveTenant`. A payment provider's
 * webhook has neither: one endpoint, a hostname carrying no tenant, and a body
 * naming an intent and a client. The identifier IS the routing key, and looking
 * it up is a cross-tenant read — exactly what Row-Level Security refuses the
 * application role.
 *
 * So the lookup happens in an owner-owned `SECURITY DEFINER` function (migration
 * 0034) that returns a tenant id and nothing else. These two wrappers are the
 * only way into it. Everything the webhook then does runs inside `withTenant`
 * with the answer, so the routing is a single narrow step rather than a
 * standing exemption.
 */
export async function tenantForPaymentIntent(
  paymentIntentId: string,
  /**
   * The studio the provider's own object claims, when it carries one. Used
   * *only* to choose between tenants this database already returned — never to
   * name one on its own, so a metadata value cannot route money into a studio
   * that holds no row for the intent.
   */
  claimedTenantId?: string | null,
): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string }>(
    sql`SELECT public.tenants_for_payment_intent(${paymentIntentId}) AS tenant_id`,
  )
  const tenantIds = [...rows].map(row => row.tenant_id).filter(Boolean)
  if (tenantIds.length <= 1) return tenantIds[0] ?? null

  // An intent two studios both hold — an archive restored beside its source
  // (migration 0040 lets the same intent exist once per Tenant).
  if (claimedTenantId && tenantIds.includes(claimedTenantId)) return claimedTenantId

  // Nothing to choose with: the intent predates the metadata, or names a studio
  // that holds no row for it. Neither candidate is "the" answer and acting on
  // one would unwind a plan in a studio the money may not have come from — so
  // refuse, loudly, and let a human do it in the right studio.
  const err = new Error('payment intent is held by more than one tenant — routing refused')
  logger.error({ paymentIntentId, tenantIds, claimedTenantId }, err.message)
  captureException(err, {
    scope: 'stripe-webhook-routing',
    paymentIntentId,
    tenantIds,
    claimedTenantId,
  })
  return null
}

export async function tenantForClient(clientId: string): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string | null }>(
    sql`SELECT public.tenant_for_client(${clientId}::uuid) AS tenant_id`,
  )
  return rows[0]?.tenant_id ?? null
}
