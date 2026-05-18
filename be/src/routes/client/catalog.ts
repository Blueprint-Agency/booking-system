import { Hono } from 'hono'
import * as classSvc from '../../services/packages/class-packages'
import * as ptSvc from '../../services/packages/pt-packages'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../../services/packages/promotions'
import { getClientEntitlements } from '../../services/packages/entitlements'

function serializeClassPackage(
  r: classSvc.ClassPackageRow,
  promos: ReturnType<typeof serializePromotion>[],
  effective: { effectivePriceSgd: string; appliedPromotionId: string | null },
) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    credits: r.credits,
    validity_days: r.validityDays,
    duration_days: r.durationDays,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
  }
}

function serializePtPackage(
  r: ptSvc.PtPackageRow,
  promos: ReturnType<typeof serializePromotion>[],
  effective: { effectivePriceSgd: string; appliedPromotionId: string | null },
) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    session_type: r.sessionType,
    num_sessions: r.numSessions,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
  }
}

const app = new Hono()
  .get('/classes', c => c.json({ todo: 'classes browse with auth (include_my_bookings)' }, 501))
  .get('/workshops', c => c.json({ todo: 'workshops browse' }, 501))
  .get('/workshops/:id', c => c.json({ todo: 'workshop detail' }, 501))
  .get('/class-packages', async c => {
    const clientId = c.get('clientId')
    const rows = await classSvc.listClassPackages({ status: 'active' })
    const promos = await listActivePromotionsFor(
      'class_package',
      rows.map(r => r.id),
    )
    const ent = await getClientEntitlements(clientId)
    return c.json({
      class_packages: rows.map(r => {
        const ps = promos[r.id] ?? []
        return serializeClassPackage(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
      entitlements: {
        trial_used: ent.trialUsed,
        has_active_unlimited: ent.hasActiveUnlimited,
        has_active_bundle_credits: ent.hasActiveBundleCredits,
      },
    })
  })
  .get('/pt-packages', async c => {
    const rows = await ptSvc.listPtPackages({ status: 'active' })
    const promos = await listActivePromotionsFor(
      'pt_package',
      rows.map(r => r.id),
    )
    return c.json({
      pt_packages: rows.map(r => {
        const ps = promos[r.id] ?? []
        return serializePtPackage(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
    })
  })
  .get('/instructors/:id/availability', c =>
    c.json({ todo: 'instructor availability slot enumeration for PT picker' }, 501),
  )

export default app
