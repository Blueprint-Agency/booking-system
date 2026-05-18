import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireVerified } from '../../middleware/clerk-client'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { classPackages, ptPackages } from '../../db/schema/packages'
import { BadRequestError, NotFoundError } from '../../shared/errors'
import { purchaseFreeTrial } from '../../services/packages/purchase'
import {
  bestPrice,
  listActivePromotionsFor,
} from '../../services/packages/promotions'

const checkoutPackageSchema = z.object({
  package_kind: z.enum(['class', 'pt']),
  package_id: z.string().uuid(),
})

const app = new Hono()
  .post('/checkout/package', requireVerified, zValidator('json', checkoutPackageSchema), async c => {
    const clientId = c.get('clientId')
    const { package_kind, package_id } = c.req.valid('json')

    if (package_kind === 'class') {
      const [pkg] = await db
        .select()
        .from(classPackages)
        .where(eq(classPackages.id, package_id))
        .limit(1)
      if (!pkg) throw new NotFoundError('class_package_not_found')
      if (pkg.status !== 'active') throw new BadRequestError('class_package_not_active')

      // Trial pass → free, no Stripe. Grant immediately.
      if (pkg.kind === 'trial') {
        const result = await purchaseFreeTrial(clientId, pkg.id)
        return c.json(
          {
            outcome: 'granted',
            client_package_id: result.clientPackageId,
            free: true,
          },
          201,
        )
      }

      const promos = await listActivePromotionsFor('class_package', [pkg.id])
      const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
      // Stripe SDK wiring lives in a follow-up — return the resolved price so
      // the fe-client can render the summary while the integration lands.
      return c.json(
        {
          outcome: 'payment_intent_pending',
          package: {
            id: pkg.id,
            kind: pkg.kind,
            name: pkg.name,
            price_sgd: pkg.priceSgd,
            effective_price_sgd: eff.effectivePriceSgd,
            applied_promotion_id: eff.appliedPromotionId,
          },
          stripe: { todo: 'create_payment_intent' },
        },
        501,
      )
    }

    // PT package
    const [pkg] = await db
      .select()
      .from(ptPackages)
      .where(eq(ptPackages.id, package_id))
      .limit(1)
    if (!pkg) throw new NotFoundError('pt_package_not_found')
    if (pkg.status !== 'active') throw new BadRequestError('pt_package_not_active')

    const promos = await listActivePromotionsFor('pt_package', [pkg.id])
    const eff = bestPrice(pkg.priceSgd, promos[pkg.id] ?? [])
    return c.json(
      {
        outcome: 'payment_intent_pending',
        package: {
          id: pkg.id,
          kind: 'pt',
          name: pkg.name,
          session_type: pkg.sessionType,
          price_sgd: pkg.priceSgd,
          effective_price_sgd: eff.effectivePriceSgd,
          applied_promotion_id: eff.appliedPromotionId,
        },
        stripe: { todo: 'create_payment_intent' },
      },
      501,
    )
  })
  .post('/checkout/workshop', requireVerified, c =>
    c.json({ todo: 'create Stripe Payment Intent for workshop (free workshops bypass)' }, 501),
  )

export default app
