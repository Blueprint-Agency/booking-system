import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
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
import { listCorporatePackages } from '../../services/packages/corporate-packages'
import {
  listCorporateRequestsForClient,
  submitCorporateRequest,
  type HydratedCorporateRequest,
} from '../../services/corporate/requests'

function serializeCorporateRequest(r: HydratedCorporateRequest) {
  return {
    id: r.id,
    status: r.status,
    package: r.package,
    created_at: r.createdAt.toISOString(),
    session: r.session
      ? {
          starts_at: r.session.startsAt.toISOString(),
          ends_at: r.session.endsAt.toISOString(),
          location_name: r.session.locationName,
          instructor_name: r.session.instructorName,
        }
      : null,
  }
}

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
    duration_months: r.durationMonths,
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
    const filters = classCatalog.parseClassFilters(c.req.query())
    const cards = await classCatalog.listClassCards(filters)
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
        trial_eligible: ent.trialEligible,
        has_active_unlimited: ent.hasActiveUnlimited,
        unlimited_location: ent.unlimitedLocation,
        // The schedule's blocked-class nudge offers the Add-On on the plan that
        // would pay, at the current rate — and stays quiet once it Covers both.
        unlimited_plan_id: ent.unlimitedPlanId,
        unlimited_covers_both: ent.unlimitedCoversBoth,
        cross_location_rate_sgd: ent.crossLocationRateSgd,
        dormant: ent.dormant,
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
  // Corporate catalogue — surfaced to signed-in members (no promotions).
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
  // The signed-in member's corporate requests (pending / scheduled / attended / cancelled).
  .get('/corporate-requests', async c => {
    const clientId = c.get('clientId')
    const rows = await listCorporateRequestsForClient(clientId)
    return c.json({ corporate_requests: rows.map(serializeCorporateRequest) })
  })
  // Submit a corporate request directly — no payment. Creates one pending request;
  // the studio arranges dates/location/instructor over WhatsApp, then schedules it.
  // `preferred_location` carries the member's chosen venue (studio name or own venue
  // address); `notes` is free text. Both optional.
  .post(
    '/corporate-requests',
    zValidator(
      'json',
      z.object({
        package_id: z.string().uuid(),
        preferred_location: z.string().trim().max(300).optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    ),
    async c => {
      const clientId = c.get('clientId')
      const { package_id, preferred_location, notes } = c.req.valid('json')
      const { corporateRequestId } = await submitCorporateRequest({
        clientId,
        corporatePackageId: package_id,
        preferredLocation: preferred_location || null,
        message: notes || null,
      })
      return c.json({ corporate_request_id: corporateRequestId }, 201)
    },
  )

export default app
