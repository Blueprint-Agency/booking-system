import { sql } from 'drizzle-orm'
import { db } from './index'

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
export async function tenantForPaymentIntent(paymentIntentId: string): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string | null }>(
    sql`SELECT public.tenant_for_payment_intent(${paymentIntentId}) AS tenant_id`,
  )
  return rows[0]?.tenant_id ?? null
}

export async function tenantForClient(clientId: string): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string | null }>(
    sql`SELECT public.tenant_for_client(${clientId}::uuid) AS tenant_id`,
  )
  return rows[0]?.tenant_id ?? null
}
