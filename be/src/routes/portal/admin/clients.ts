import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireRole } from '../../../middleware/require-role'
import { tenantId } from '../../../middleware/tenant'
import {
  listClients,
  createClientWithInvite,
  getClientById,
  listRecentAdjustments,
  softDeleteClient,
  restoreClient,
  type ClientRow,
  type ClientListRow,
  type ManualAdjustmentRow,
} from '../../../services/clients/manage'
import { listClientPackages, type ClientPackageWithSource } from '../../../services/packages/entitlements'
import {
  adjustBalance,
  setBalance,
  setCrossLocationAddOn,
  setHomeLocation,
  setPackageExpiry,
  type ClientPackageRow,
} from '../../../services/packages/adjust'
import {
  issueRefund,
  issueWorkshopRefund,
  listWorkshopPurchases,
  refundStatesFor,
  type RefundState,
  type WorkshopPurchase,
} from '../../../services/billing/refunds'

const idParam = z.object({ id: z.string().uuid() })
const idPkgParam = z.object({ id: z.string().uuid(), pid: z.string().uuid() })
const idBookingParam = z.object({ id: z.string().uuid(), bid: z.string().uuid() })

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  // Stringly-typed because Hono query params are strings; only "true" enables.
  include_deleted: z.enum(['true', 'false']).optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email(),
  phone: z.string().min(1).max(40),
})

const adjustSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).max(2000),
})
const balanceSchema = z.object({
  balance: z.number().int().min(0),
  reason: z.string().min(1).max(2000),
})
// Attach at an amount, or remove with null. Zero is a legitimate amount — a
// comped Add-On is recorded as $0, never as absent.
const crossLocationSchema = z.object({
  paid_sgd: z.number().min(0).max(99999).nullable(),
  reason: z.string().min(1).max(2000),
})
// A Refund is always the full amount, so there is deliberately no amount field.
// The reason is mandatory — it is the only record of why an admin refunded, and
// the only one that survives a purchase that was not Untouched.
const refundSchema = z.object({
  reason: z.string().min(1).max(2000),
})
// Moving a member's Home Location (§7). The reason is mandatory and there is no
// "clear it" — an Unlimited Plan always Covers exactly one Location.
const homeLocationSchema = z.object({
  location_id: z.string().uuid(),
  reason: z.string().min(1).max(2000),
})
const expirySchema = z.object({
  expires_at: z.string().datetime({ offset: true }).nullable(),
  reason: z.string().min(1).max(2000),
})

// The directory row carries the trial funnel with it (started / attended /
// converted) so the Customers page answers "how did trials do" from the list it
// already loads, rather than from a second read.
function clientListRow(c: ClientListRow) {
  return {
    ...clientRow(c),
    trial_started_at: c.trialStartedAt,
    attended: c.attended,
    converted: c.converted,
  }
}

function clientRow(c: ClientRow) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    status: c.status,
    joined_at: c.joinedAt,
    suspended_at: c.suspendedAt,
    deleted_at: c.deletedAt,
    deleted_by_staff_id: c.deletedByStaffId,
  }
}

function packageView(p: ClientPackageWithSource, refund?: RefundState) {
  return {
    // The Refund button and the notice above it (§14). `refund_notice` is null
    // when the purchase is **Untouched**; the portal renders the sentence and
    // works nothing out for itself.
    refundable: refund?.refundable ?? false,
    refund_notice: refund?.notice ?? null,
    id: p.id,
    kind: p.kind,
    source_package_id: p.sourcePackageId,
    package_name: p.packageName,
    credits_or_sessions_remaining: p.creditsOrSessionsRemaining,
    credits_or_sessions_total: p.creditsOrSessionsTotal,
    expires_at: p.expiresAt,
    purchased_at: p.purchasedAt,
    amount_paid_sgd: p.amountPaidSgd,
    // Frozen List Price (§15). The discount is derived on the client as list
    // minus paid — deliberately not stored and not sent as a third number.
    list_price_sgd: p.listPriceSgd,
    dormant: p.dormant,
    unlimited_location: p.location,
    duration_months: p.durationMonths,
    // The Cross-Location Add-On and what was paid for it (§5, §15) — null means
    // this plan Covers its Home Location only.
    cross_location_paid_sgd: p.crossLocationPaidSgd,
    // Which Promo Code the member typed, frozen at purchase (§11). The text is
    // read through the id, so a later relabelling of the code cannot restate it.
    promo_code: p.promoCode,
  }
}

// A workshop purchase's row on the client detail page, beside the package rows
// (§14 / issue #36). The booking IS the purchase, so there is no source-package
// id or expiry to show — only what the Refund button and its notice need.
function workshopPurchaseView(w: WorkshopPurchase) {
  return {
    booking_id: w.bookingId,
    workshop_name: w.workshopName,
    tier_name: w.tierName,
    amount_paid_sgd: w.amountPaidSgd,
    list_price_sgd: w.listPriceSgd,
    purchased_at: w.purchasedAt,
    refundable: w.refundable,
    refund_notice: w.refundNotice,
  }
}

function adjustmentView(a: ManualAdjustmentRow) {
  return {
    id: a.id,
    client_package_id: a.clientPackageId,
    delta: a.delta,
    reason: a.reason,
    acted_by_staff_id: a.actedByStaffId,
    created_at: a.createdAt,
  }
}

// A package edit returns the raw client_packages row — reshape to the same
// snake_case view the profile uses (total/name aren't on the row, so omit them;
// the client refetches the profile to repaint authoritative values).
function editedPackageView(p: ClientPackageRow) {
  return {
    id: p.id,
    kind: p.kind,
    credits_or_sessions_remaining: p.creditsOrSessionsRemaining,
    expires_at: p.expiresAt,
    cross_location_paid_sgd: p.crossLocationPaidSgd,
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    // Only superadmins can see the deleted view; non-superadmins silently get
    // the default filtered list regardless of the query param.
    const role = c.get('staffRow')?.role
    const includeDeleted = q.include_deleted === 'true' && role === 'superadmin'
    const rows = await listClients(tenantId(c), { q: q.q, status: q.status, includeDeleted })
    return c.json({ clients: rows.map(clientListRow) })
  })
  .post('/', zValidator('json', createSchema), async c => {
    const body = c.req.valid('json')
    const staffId = c.get('staffUserId')
    const row = await createClientWithInvite({
      tenantId: tenantId(c),
      name: body.name,
      email: body.email,
      phone: body.phone,
      invitedByStaffId: staffId,
    })
    c.set('auditTarget' as any, { table: 'clients', id: row.id })
    return c.json(clientRow(row), 201)
  })
  .get('/:id', zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const [client, packages, adjustments, refunds, workshopPurchases] = await Promise.all([
      getClientById(tenantId(c), id),
      listClientPackages(tenantId(c), id, true),
      listRecentAdjustments(tenantId(c), id),
      refundStatesFor(tenantId(c), id),
      listWorkshopPurchases(tenantId(c), id),
    ])
    return c.json({
      ...clientRow(client),
      packages: packages.map(p => packageView(p, refunds[p.id])),
      adjustments: adjustments.map(adjustmentView),
      workshop_purchases: workshopPurchases.map(workshopPurchaseView),
    })
  })
  // ---- package wallet edits (admin/superadmin) ----
  .post('/:id/packages/:pid/adjust', zValidator('param', idPkgParam), zValidator('json', adjustSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await adjustBalance({
      tenantId: tenantId(c),
      clientId: id,
      clientPackageId: pid,
      delta: body.delta,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  .post('/:id/packages/:pid/balance', zValidator('param', idPkgParam), zValidator('json', balanceSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await setBalance({
      tenantId: tenantId(c),
      clientId: id,
      clientPackageId: pid,
      balance: body.balance,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  .post('/:id/packages/:pid/expiry', zValidator('param', idPkgParam), zValidator('json', expirySchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await setPackageExpiry({
      tenantId: tenantId(c),
      clientId: id,
      clientPackageId: pid,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  .post('/:id/packages/:pid/cross-location', zValidator('param', idPkgParam), zValidator('json', crossLocationSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await setCrossLocationAddOn({
      tenantId: tenantId(c),
      clientId: id,
      clientPackageId: pid,
      paidSgd: body.paid_sgd === null ? null : body.paid_sgd.toFixed(2),
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  // Moving a member's Home Location (§7) — the correction for a Location picked
  // wrong at checkout. The service moves the Activated plan and any Dormant
  // renewal together and leaves every booking standing.
  .post('/:id/packages/:pid/location', zValidator('param', idPkgParam), zValidator('json', homeLocationSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const row = await setHomeLocation({
      tenantId: tenantId(c),
      clientId: id,
      clientPackageId: pid,
      locationId: body.location_id,
      reason: body.reason,
      actedByStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json(editedPackageView(row))
  })
  // A Refund (§14). The handler calls the payment provider and returns — the
  // `charge.refunded` webhook voids the purchase, cancels its future bookings
  // and hands the Promo Code back, so a refund issued from the provider's
  // dashboard produces the identical unwind.
  .post('/:id/packages/:pid/refund', zValidator('param', idPkgParam), zValidator('json', refundSchema), async c => {
    const { id, pid } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await issueRefund({
      tenantId: tenantId(c),
      clientId: id,
      clientPackageId: pid,
      reason: body.reason,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'client_packages', id: pid })
    return c.json({
      refunded: true,
      attended_count: result.attendedCount,
      override: result.override,
    })
  })
  // A Refund on a workshop purchase (§14, issue #36) — the same operation as
  // above, aimed at the booking that IS the purchase. `unwindRefund` is already
  // workshop-aware, so this reuses it unchanged.
  .post(
    '/:id/workshop-bookings/:bid/refund',
    zValidator('param', idBookingParam),
    zValidator('json', refundSchema),
    async c => {
      const { id, bid } = c.req.valid('param')
      const body = c.req.valid('json')
      const result = await issueWorkshopRefund({
        tenantId: tenantId(c),
        clientId: id,
        bookingId: bid,
        reason: body.reason,
        actorStaffId: c.get('staffUserId'),
      })
      c.set('auditTarget' as any, { table: 'bookings', id: bid })
      return c.json({
        refunded: true,
        attended_count: result.attendedCount,
        override: result.override,
      })
    },
  )
  // Blocking is DELETE /:id + POST /:id/restore below — there is deliberately no
  // separate suspend mechanism.
  .post('/:id/packages/issue', c => c.json({ todo: 'admin grants complimentary package' }, 501))
  // ---- soft delete + restore (superadmin-only) ----
  .delete('/:id', requireRole('superadmin'), zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await softDeleteClient({
      tenantId: tenantId(c),
      targetClientId: id,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'clients', id })
    return c.json(clientRow(row))
  })
  .post('/:id/restore', requireRole('superadmin'), zValidator('param', idParam), async c => {
    const { id } = c.req.valid('param')
    const row = await restoreClient({
      tenantId: tenantId(c),
      targetClientId: id,
      actorStaffId: c.get('staffUserId'),
    })
    c.set('auditTarget' as any, { table: 'clients', id })
    return c.json(clientRow(row))
  })

export default app
