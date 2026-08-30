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
import { tenantId } from '../../middleware/tenant'

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
    // What this plan paid for the Cross-Location Add-On (§5). Null means it
    // Covers its Home Location only — the member surface reads the null, never
    // re-derives coverage.
    cross_location_paid_sgd: r.crossLocationPaidSgd,
    session_type: r.sessionType,
  }
}

// Editable BE-owned profile fields. Email lives on Clerk (read-only here);
// password/2FA are managed via Clerk's hosted UserProfile UI, not this API.
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
    // clientRow is attached by clerkClientAuth — middleware already loaded it.
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
      listClientPackages(clientId, onlyActive),
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
        has_active_bundle_credits: ent.hasActiveBundleCredits,
        pt_1on1_remaining: ent.pt1on1Remaining,
        pt_2on1_remaining: ent.pt2on1Remaining,
      },
    })
  })

export default app
