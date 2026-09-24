import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as svc from '../../../services/marketing'
import { tenantId } from '../../../middleware/tenant'

// be-portal.md §marketing.ts: the hero is required on every save; the rest is
// kept when left out and cleared when sent as null.
const patchSchema = z.object({
  hero_heading: z.string().trim().min(1).max(200),
  hero_subheading: z.string().trim().min(1).max(500),
  pricing_blurb: z.string().max(2000).nullish(),
  testimonials: z
    .array(z.object({ quote: z.string().min(1).max(1000), author: z.string().max(200).nullish() }))
    .max(20)
    .nullish(),
  footer_text: z.string().max(2000).nullish(),
})

const app = new Hono()
  .get('/', async c => c.json(svc.serializeMarketing(await svc.getMarketing(tenantId(c)))))
  .patch('/', zValidator('json', patchSchema), async c => {
    const body = c.req.valid('json')
    const row = await svc.updateMarketing(
      tenantId(c),
      {
        heroHeading: body.hero_heading,
        heroSubheading: body.hero_subheading,
        pricingBlurb: body.pricing_blurb,
        testimonials: body.testimonials,
        footerText: body.footer_text,
      },
      c.get('staffUserId'),
    )
    c.set('auditTarget' as any, { table: 'marketing_content', id: row.id })
    return c.json(svc.serializeMarketing(row))
  })

export default app
