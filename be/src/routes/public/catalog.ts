import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import * as classCatalog from '../../services/schedule/client-catalog'
import * as classTypesSvc from '../../services/catalog/class-types'
import * as classSvc from '../../services/packages/class-packages'
import * as ptSvc from '../../services/packages/pt-packages'
import {
  bestPrice,
  listActivePromotionsFor,
  serializePromotion,
} from '../../services/packages/promotions'
import * as merchSvc from '../../services/catalog/merch'
import { listPublicEntities } from '../../services/catalog/entities-public'
import { listCorporatePackages } from '../../services/packages/corporate-packages'
import { readCancellationPolicy } from '../../services/policy/evaluate-cancellation'
import { readPtBookingWindow } from '../../services/pt-sessions/request'
import { tenantId } from '../../middleware/tenant'
import { entityQuery, explainEntityQuery } from '../entity-fields'
import { entityFieldsFor, type EntityFields } from '../../services/catalog/entities'
import { takesOnlinePayments } from '../../lib/stripe'

function serializeClassPackage(
  r: classSvc.ClassPackageRow,
  promos: ReturnType<typeof serializePromotion>[] = [],
  effective: { effectivePriceSgd: string; appliedPromotionId: string | null },
  entity: EntityFields,
) {
  return {
    id: r.id,
    ...entity,
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
  promos: ReturnType<typeof serializePromotion>[] = [],
  effective: { effectivePriceSgd: string; appliedPromotionId: string | null },
  entity: EntityFields,
) {
  return {
    id: r.id,
    ...entity,
    name: r.name,
    description: r.description,
    session_type: r.sessionType,
    num_sessions: r.numSessions,
    validity_days: r.validityDays,
    // Instructor-Bound — checkout asks for an instructor on a true, and
    // for nothing at all on a false.
    instructor_bound: r.instructorBound,
    price_sgd: r.priceSgd,
    effective_price_sgd: effective.effectivePriceSgd,
    applied_promotion_id: effective.appliedPromotionId,
    promotions: promos,
  }
}

const app = new Hono()
  .get('/locations', async c => {
    const locations = await classCatalog.listActiveLocations(tenantId(c))
    return c.json({ locations })
  })
  // The studio's live Entities in its order, each with its slug and whether it has a
  // package on sale: what the schedule draws its buttons and the Packages menu from.
  .get('/entities', async c => {
    return c.json({ entities: await listPublicEntities(tenantId(c)) })
  })
  .get('/classes', async c => {
    const filters = classCatalog.parseClassFilters(c.req.query())
    const classes = await classCatalog.listClassCards(tenantId(c), filters)
    return c.json({ classes })
  })
  .get('/classes/:id', async c => {
    const detail = await classCatalog.getClassDetail(tenantId(c), c.req.param('id'))
    return c.json(detail)
  })
  // No workshops here: a studio's workshops — what, when, who teaches, what it
  // costs — are shown to members only, so they can't be lifted without an
  // account. Signed-in members read them from /me/workshops.
  // Merch is browse-only and priced the same for everyone — no signed-in variant.
  .get('/merch', async c => {
    const rows = await merchSvc.listMerch(tenantId(c), { includeArchived: false })
    return c.json({ merch: rows.map(merchSvc.serializeMerch) })
  })
  .get('/instructors', async c => {
    const instructors = await classCatalog.listActiveInstructors(tenantId(c))
    return c.json({ instructors })
  })
  // Active class types — used by the fe-client PT request form's class type dropdown.
  .get('/class-types', async c => {
    const rows = await classTypesSvc.listClassTypes(tenantId(c), { includeArchived: false })
    return c.json({ class_types: rows.map(r => ({ id: r.id, name: r.name, entity_id: r.entityId ?? null })) })
  })
  // `?entity=<slug>` narrows to one Entity; a slug naming no live Entity of the
  // studio answers with empty lists.
  .get('/packages', zValidator('query', entityQuery, explainEntityQuery), async c => {
    const entitySlug = c.req.valid('query').entity
    const [classRows, ptRows] = await Promise.all([
      classSvc.listClassPackages(tenantId(c), { status: 'active', entitySlug }),
      ptSvc.listPtPackages(tenantId(c), { status: 'active', entitySlug }),
    ])

    const [classPromos, ptPromos] = await Promise.all([
      listActivePromotionsFor(
        tenantId(c),
        'class_package',
        classRows.map(r => r.id),
      ),
      listActivePromotionsFor(
        tenantId(c),
        'pt_package',
        ptRows.map(r => r.id),
      ),
    ])

    const [classEntities, ptEntities] = await Promise.all([
      entityFieldsFor(tenantId(c), classRows),
      entityFieldsFor(tenantId(c), ptRows),
    ])

    return c.json({
      class_packages: classRows.map((r, i) => {
        const ps = classPromos[r.id] ?? []
        return serializeClassPackage(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps), classEntities[i]!)
      }),
      pt_packages: ptRows.map((r, i) => {
        const ps = ptPromos[r.id] ?? []
        return serializePtPackage(r, ps.map(serializePromotion), bestPrice(r.priceSgd, ps), ptEntities[i]!)
      }),
    })
  })
  // The studio's cancellation rules, stated to a member before they book and
  // when they cancel. Public because the schedule is: the rules are part of
  // what a member is agreeing to, signed in or not. Not cached — an admin who
  // changes the window should see members told the new one straight away.
  .get('/cancellation-policy', async c => {
    const p = await readCancellationPolicy(tenantId(c))
    return c.json({
      class_window_hours: p.classWindowHours,
      pt_window_hours: p.ptWindowHours,
      cancel_cap_enabled: p.cancelCapEnabled,
      cancel_cap_count: p.cancelCapCount,
      cancel_cap_cycle_days: p.cancelCapCycleDays,
    })
  })
  // How far ahead a member may propose a private session, so the request form
  // can say so and cap its date picker before the server refuses. Not cached,
  // for the same reason as the cancellation policy above.
  .get('/pt-booking-config', async c => {
    const window = await readPtBookingWindow(tenantId(c))
    return c.json({
      min_book_in_advance_days: window.minDays,
      book_in_advance_days: window.maxDays,
    })
  })
  // Whether this studio takes card payments online at all — false until
  // it has supplied its own payment account. Read before a buy button is shown,
  // so a member is told plainly rather than handed a button that fails. Public
  // because the catalogue is. Not cached: a studio whose credentials have just
  // been entered should be able to sell on the next page load.
  .get('/online-payments', async c => {
    return c.json({ online_payments: await takesOnlinePayments(tenantId(c)) })
  })
  // Corporate catalogue for signed-out browsing (no promotions, no entitlements).
  .get('/corporate-packages', zValidator('query', entityQuery, explainEntityQuery), async c => {
    const rows = await listCorporatePackages(tenantId(c), { status: 'active', entitySlug: c.req.valid('query').entity })
    const entities = await entityFieldsFor(tenantId(c), rows)
    return c.json({
      corporate_packages: rows.map((r, i) => ({
        id: r.id,
        ...entities[i]!,
        name: r.name,
        description: r.description,
        price_sgd: r.priceSgd,
        status: r.status,
      })),
    })
  })

export default app
