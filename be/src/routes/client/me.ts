import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import {
  getClientEntitlements,
  listClientPackages,
} from '../../services/packages/entitlements'
import {
  listSavedCards,
  removeSavedCard,
  type SavedCard,
} from '../../services/billing/payment-customers'
import { tenantId } from '../../middleware/tenant'

/**
 * A payment method id as the provider writes it (`pm_…`). Not a uuid, so it is
 * length-bounded and character-bounded instead — enough that a path segment
 * cannot become a wild string on its way to a provider call, while the real
 * check of whether it is *this member's* card stays in the service, where the
 * Customer it must belong to is known.
 */
const cardParam = z.object({ id: z.string().min(3).max(255).regex(/^[A-Za-z0-9_]+$/) })

/** What a member may be told about a card of theirs. Never a number. */
const serializeCard = (card: SavedCard) => ({
  id: card.id,
  brand: card.brand,
  last4: card.last4,
  exp_month: card.expMonth,
  exp_year: card.expYear,
})

function serializeProfile(row: typeof clients.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    joined_at: row.joinedAt,
  }
}

function serializeClientPackage(r: Awaited<ReturnType<typeof listClientPackages>>[number]) {
  return {
    id: r.id,
    kind: r.kind,
    source_package_id: r.sourcePackageId,
    package_name: r.packageName,
    credits_or_sessions_remaining: r.creditsOrSessionsRemaining,
    expires_at: r.expiresAt,
    purchased_at: r.purchasedAt,
    amount_paid_sgd: r.amountPaidSgd,
    list_price_sgd: r.listPriceSgd,
    active: r.active,
    dormant: r.dormant,
    unlimited_location: r.location,
    duration_months: r.durationMonths,
    // How long a Dormant package will run once its first booking starts it —
    // the member surface prints the promise, the backend keeps the number.
    validity_days: r.validityDays,
    // What this plan paid for the Cross-Location Add-On (§5). Null means it
    // Covers its Home Location only — the member surface reads the null, never
    // re-derives coverage.
    cross_location_paid_sgd: r.crossLocationPaidSgd,
    session_type: r.sessionType,
    // Who this PT package's sessions are with (#109). Null means open to any
    // instructor — the member surface reads the null and never re-derives it.
    bound_instructor: r.boundInstructor,
  }
}

// Editable profile fields. The row is the source of truth for a member's name at
// this studio; the email is the account's sign-in address and is read-only here.
const patchSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    phone: z.string().min(1).max(40).optional(),
  })
  .refine(b => b.name !== undefined || b.phone !== undefined, {
    message: 'at least one of name/phone is required',
  })

const app = new Hono()
  .get('/', c => {
    // clientRow is attached by clientAuth — middleware already loaded it.
    return c.json(serializeProfile(c.get('clientRow')))
  })
  .patch('/', zValidator('json', patchSchema), async c => {
    const clientId = c.get('clientId')
    const body = c.req.valid('json')
    const [updated] = await db
      .update(clients)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.phone !== undefined ? { phone: body.phone.trim() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId))
      .returning()
    return c.json(serializeProfile(updated!))
  })
  .get('/dashboard', c => c.json({ todo: 'next-up + balances' }, 501))
  .get('/packages', async c => {
    const clientId = c.get('clientId')
    const onlyActive = c.req.query('only_active') === '1'
    const [packages, ent] = await Promise.all([
      listClientPackages(tenantId(c), clientId, onlyActive),
      getClientEntitlements(tenantId(c), clientId),
    ])
    return c.json({
      client_packages: packages.map(serializeClientPackage),
      entitlements: {
        trial_used: ent.trialUsed,
        has_active_unlimited: ent.hasActiveUnlimited,
        unlimited_location: ent.unlimitedLocation,
        // The plan a Cross-Location Add-On would attach to, whether it already
        // carries one, and the rate it prices at (§5).
        unlimited_plan_id: ent.unlimitedPlanId,
        unlimited_covers_both: ent.unlimitedCoversBoth,
        cross_location_rate_sgd: ent.crossLocationRateSgd,
        dormant: ent.dormant,
        // One package per family runs at a time (§3); these say whether one is.
        class_family_running: ent.classFamilyRunning,
        pt_family_running: ent.ptFamilyRunning,
        has_active_bundle_credits: ent.hasActiveBundleCredits,
        pt_1on1_remaining: ent.pt1on1Remaining,
        pt_2on1_remaining: ent.pt2on1Remaining,
      },
    })
  })
  // ---- saved cards (#185) ----
  // The member's own cards, and only ever the brand, the last four digits and
  // the expiry — read live from the provider, because a local copy of a card is
  // a copy that goes stale in the exact way that makes a member pick one that
  // no longer works. A member who has saved none gets an empty list, which is
  // the honest answer and not an error.
  .get('/cards', async c => {
    const cards = await listSavedCards(tenantId(c), c.get('clientId'))
    return c.json({ cards: cards.map(serializeCard) })
  })
  // Remove one. The id in the path is a string the browser chose, so the
  // service checks it against *this* member's Customer at the provider before
  // detaching anything — without that, this route would let any signed-in
  // member detach any card at any studio.
  .delete('/cards/:id', zValidator('param', cardParam), async c => {
    await removeSavedCard({
      tenantId: tenantId(c),
      clientId: c.get('clientId'),
      paymentMethodId: c.req.valid('param').id,
    })
    return c.json({ removed: true })
  })

export default app
