import { Hono } from 'hono'
import * as classCatalog from '../../services/schedule/client-catalog'
import * as classTypesSvc from '../../services/catalog/class-types'
import * as classSvc from '../../services/packages/class-packages'
import * as ptSvc from '../../services/packages/pt-packages'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../../services/packages/promotions'
import * as workshopsSvc from '../../services/workshops/catalog'
import { listCorporatePackages } from '../../services/packages/corporate-packages'

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
  .get('/locations', async c => {
    const locations = await classCatalog.listActiveLocations()
    return c.json({ locations })
  })
  .get('/classes', async c => {
    const filters = classCatalog.parseClassFilters(c.req.query())
    const classes = await classCatalog.listClassCards(filters)
    return c.json({ classes })
  })
  .get('/classes/:id', async c => {
    const detail = await classCatalog.getClassDetail(c.req.param('id'))
    return c.json(detail)
  })
  .get('/workshops', async c => {
    const cards = await workshopsSvc.listActiveWorkshopCards()
    return c.json({ workshops: cards })
  })
  .get('/workshops/:id', async c => {
    const id = c.req.param('id')
    const detail = await workshopsSvc.getWorkshopDetailPayload(id)
    return c.json(detail)
  })
  .get('/instructors', async c => {
    const instructors = await classCatalog.listActiveInstructors()
    return c.json({ instructors })
  })
  // Active class types — used by the fe-client PT request form's class type dropdown.
  .get('/class-types', async c => {
    const rows = await classTypesSvc.listClassTypes({ includeArchived: false })
    return c.json({ class_types: rows.map(r => ({ id: r.id, name: r.name })) })
  })
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
  // Corporate catalogue for signed-out browsing (no promotions, no entitlements).
  .get('/corporate-packages', async c => {
    const rows = await listCorporatePackages({ status: 'active' })
    return c.json({
      corporate_packages: rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        price_sgd: r.priceSgd,
        status: r.status,
      })),
    })
  })

export default app
