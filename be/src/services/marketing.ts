import { eq } from 'drizzle-orm'
import { db } from '../db'
import { marketingContent } from '../db/schema/content'
import { NotFoundError } from '../shared/errors'

/**
 * The studio's public-site copy — hero, pricing blurb, testimonials, footer.
 *
 * One row per Tenant (the unique index on `tenant_id`), made when the studio is
 * seeded or provisioned. The hero is required on every save; the other fields
 * are kept when left out and cleared when sent as null.
 */
export type MarketingRow = typeof marketingContent.$inferSelect

export interface Testimonial {
  quote: string
  author?: string | null
}

export interface MarketingInput {
  heroHeading: string
  heroSubheading: string
  pricingBlurb?: string | null
  testimonials?: Testimonial[] | null
  footerText?: string | null
}

export async function getMarketing(tenantId: string): Promise<MarketingRow> {
  const [row] = await db
    .select()
    .from(marketingContent)
    .where(eq(marketingContent.tenantId, tenantId))
    .limit(1)
  if (!row) throw new NotFoundError('not_found')
  return row
}

/**
 * Upserted rather than updated, so a studio whose row was never written still
 * gets one from its first save instead of a 404 it cannot do anything about.
 */
export async function updateMarketing(
  tenantId: string,
  input: MarketingInput,
  staffId: string,
): Promise<MarketingRow> {
  const { heroHeading, heroSubheading, ...optional } = input
  const kept = Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined))
  const values = { heroHeading, heroSubheading, ...kept, updatedAt: new Date(), updatedByStaffId: staffId }
  const [row] = await db
    .insert(marketingContent)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: marketingContent.tenantId, set: values })
    .returning()
  return row!
}

export function serializeMarketing(row: MarketingRow) {
  return {
    hero_heading: row.heroHeading,
    hero_subheading: row.heroSubheading,
    pricing_blurb: row.pricingBlurb,
    testimonials: row.testimonials,
    footer_text: row.footerText,
    updated_at: row.updatedAt,
  }
}
