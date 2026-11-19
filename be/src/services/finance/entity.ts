/**
 * Which Entity a Money Event is filed under — be/CONTEXT.md § Entity.
 *
 * Read LIVE from the current catalogue: a row carries no frozen copy, so a
 * package moved to another Entity re-files every sale it ever made. "No entity"
 * (null) is a bucket of its own, not a hole: a workshop, a merch order and a
 * manual entry are in no line of practice, and neither is a sale whose package
 * names none or whose package is gone.
 *
 * Per Type:
 *   - package sale / its Add-On   → the source package's Entity (list.ts reads it
 *                                    off the join it already makes for the name)
 *   - Refund                      → the Entity of what its Purchase bought
 *                                    (`purchaseEntities` below)
 *   - corporate sale              → the corporate package's Entity (same lookup)
 *   - class pay                   → the class's Class Type's Entity
 *   - PT session pay              → the request's Class Type's Entity, else the
 *                                    paying package's (payroll/list.ts)
 *   - workshop, merch, manual     → none
 *
 * Finance has no corporate-session pay (neither corporate table has a pay
 * column), so a corporate package's Entity files its SALE and the sale's Refund
 * only.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { entities } from '../../db/schema/catalog'
import { clientPackages, classPackages, corporatePackages, ptPackages } from '../../db/schema/packages'
import { corporateRequests } from '../../db/schema/schedule'
import { purchases } from '../../db/schema/ledger'
import type { MoneyEvent } from './events'

/**
 * The Entity filter's "No entity" — the rows filed under none. Alongside an
 * Entity id, the way `UNATTRIBUTED` sits beside a Location id.
 */
export const NO_ENTITY = 'none'

/** Every Entity of the studio by id, archived ones too: history still names them. */
async function entityNames(tenantId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.tenantId, tenantId))
  return new Map(rows.map(r => [r.id, r.name]))
}

/**
 * Names the Entity on every event that has one. Done once over the union, from
 * one read of the studio's Entities, rather than joined into each query.
 */
export async function nameEntities(tenantId: string, events: MoneyEvent[]): Promise<MoneyEvent[]> {
  if (!events.some(e => e.entityId != null)) return events
  const names = await entityNames(tenantId)
  return events.map(e => (e.entityId == null ? e : { ...e, entityName: names.get(e.entityId) ?? null }))
}

/**
 * What a Purchase bought, as an Entity: the plan it granted, the corporate
 * package it paid for, or — for a standalone Cross-Location Add-On, which grants
 * nothing of its own — the plan its payment names.
 */
export interface PurchaseEntities {
  /** Null where the Purchase bought nothing an Entity files (a workshop, merch). */
  ofPurchase(purchaseId: string | null, planId?: string | null): string | null
}

export async function purchaseEntities(
  tenantId: string,
  purchaseIds: readonly string[],
  planIds: readonly string[],
): Promise<PurchaseEntities> {
  const wantedPurchases = [...new Set(purchaseIds)]
  const wantedPlans = [...new Set(planIds)]
  const byPurchase = new Map<string, string>()
  const byPlan = new Map<string, string>()

  if (wantedPurchases.length > 0 || wantedPlans.length > 0) {
    // The plans: one is matched through its OWN Purchase, never only through a
    // payment's `client_package_id` — a standalone Add-On's payment points at a
    // plan whose own Purchase is a different sale (services/billing/refunds.ts).
    const plans = await db
      .select({
        id: clientPackages.id,
        purchaseId: clientPackages.purchaseId,
        classEntityId: classPackages.entityId,
        ptEntityId: ptPackages.entityId,
      })
      .from(clientPackages)
      .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      .where(
        and(
          eq(clientPackages.tenantId, tenantId),
          wantedPurchases.length > 0 && wantedPlans.length > 0
            ? sql`(${inArray(clientPackages.purchaseId, wantedPurchases)} or ${inArray(clientPackages.id, wantedPlans)})`
            : wantedPurchases.length > 0
              ? inArray(clientPackages.purchaseId, wantedPurchases)
              : inArray(clientPackages.id, wantedPlans),
        ),
      )
    for (const p of plans) {
      const entityId = p.classEntityId ?? p.ptEntityId
      if (entityId == null) continue
      byPlan.set(p.id, entityId)
      if (p.purchaseId != null && !byPurchase.has(p.purchaseId)) byPurchase.set(p.purchaseId, entityId)
    }
  }

  if (wantedPurchases.length > 0) {
    // A corporate sale: the request names its Purchase ...
    const requests = await db
      .select({ purchaseId: corporateRequests.purchaseId, entityId: corporatePackages.entityId })
      .from(corporateRequests)
      .innerJoin(corporatePackages, eq(corporatePackages.id, corporateRequests.corporatePackageId))
      .where(and(eq(corporateRequests.tenantId, tenantId), inArray(corporateRequests.purchaseId, wantedPurchases)))
    for (const r of requests) {
      if (r.purchaseId != null && r.entityId != null && !byPurchase.has(r.purchaseId)) byPurchase.set(r.purchaseId, r.entityId)
    }

    // ... or, on a request made before that link existed, only the Purchase's own
    // metadata does: checkout wrote the corporate package's id into it.
    const legacy = await db
      .select({ purchaseId: purchases.id, entityId: corporatePackages.entityId })
      .from(purchases)
      .innerJoin(corporatePackages, sql`${corporatePackages.id}::text = ${purchases.metadata}->>'package_id'`)
      .where(
        and(
          eq(purchases.tenantId, tenantId),
          eq(purchases.kind, 'corporate_package'),
          inArray(purchases.id, wantedPurchases),
        ),
      )
    for (const r of legacy) {
      if (r.entityId != null && !byPurchase.has(r.purchaseId)) byPurchase.set(r.purchaseId, r.entityId)
    }
  }

  return {
    ofPurchase: (purchaseId, planId) =>
      (purchaseId != null ? byPurchase.get(purchaseId) : undefined) ?? (planId != null ? byPlan.get(planId) : undefined) ?? null,
  }
}
