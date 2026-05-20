import { Hono } from 'hono'
import { z } from 'zod'
import * as classCatalog from '../../services/schedule/client-catalog'
import * as classSvc from '../../services/packages/class-packages'
import * as ptSvc from '../../services/packages/pt-packages'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../../services/packages/promotions'
import { getClientEntitlements } from '../../services/packages/entitlements'
import * as workshopsSvc from '../../services/workshops/catalog'
import { listMyWorkshopBookings } from '../../services/workshops/my-bookings'

const meClassesQuery = z.object({
  location_id: z.string().uuid().optional(),
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

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
  .get('/classes', async c => {
    const clientId = c.get('clientId')
    const q = meClassesQuery.parse(c.req.query())
    const cards = await classCatalog.listClassCards({
      locationId: q.location_id,
      instructorId: q.instructor_id,
      classTypeId: q.class_type_id,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    })
    const bookedIds = await classCatalog.myBookedClassIds(
      clientId,
      cards.map(card => card.id),
    )
    return c.json({
      classes: cards.map(card => ({ ...card, is_booked: bookedIds.has(card.id) })),
    })
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
  .get('/workshop-bookings', async c => {
    const clientId = c.get('clientId')
    const rows = await listMyWorkshopBookings(clientId)
    return c.json({ workshop_bookings: rows })
  })
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
  .get('/instructors/:id/availability', async c => {
    const slots = await classCatalog.listInstructorAvailability(c.req.param('id'))
    return c.json({ slots })
  })

export default app
