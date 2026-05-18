import { Hono } from 'hono'
import * as classSvc from '../../services/packages/class-packages'
import * as ptSvc from '../../services/packages/pt-packages'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../../services/packages/promotions'

function serializeClassPackage(
  r: classSvc.ClassPackageRow,
  promos: ReturnType<typeof serializePromotion>[] = [],
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
  promos: ReturnType<typeof serializePromotion>[] = [],
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
  .get('/locations', c => c.json({ todo: 'list active locations' }, 501))
  .get('/classes', c => c.json({ todo: 'list classes (filter location/date/instructor/type)' }, 501))
  .get('/classes/:id', c => c.json({ todo: 'class detail' }, 501))
  .get('/workshops', c => c.json({ todo: 'list workshops (filter location/date)' }, 501))
  .get('/workshops/:id', c =>
    c.json({ todo: 'workshop detail incl. tiers + images + instructors' }, 501),
  )
  .get('/packages', async c => {
    const [classRows, ptRows] = await Promise.all([
      classSvc.listClassPackages({ status: 'active' }),
      ptSvc.listPtPackages({ status: 'active' }),
    ])

    const [classPromos, ptPromos] = await Promise.all([
      listActivePromotionsFor(
        'class_package',
        classRows.map(r => r.id),
      ),
      listActivePromotionsFor(
        'pt_package',
        ptRows.map(r => r.id),
      ),
    ])

    return c.json({
      class_packages: classRows.map(r => {
        const ps = classPromos[r.id] ?? []
        return serializeClassPackage(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
      pt_packages: ptRows.map(r => {
        const ps = ptPromos[r.id] ?? []
        return serializePtPackage(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps))
      }),
    })
  })

export default app
