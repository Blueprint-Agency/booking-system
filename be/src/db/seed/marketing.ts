import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'

const MARKETING_SINGLETON_ID = '00000000-0000-0000-0000-000000000004'

export async function seedMarketing(db: PostgresJsDatabase<typeof schema>) {
  await db
    .insert(schema.marketingContent)
    .values({
      id: MARKETING_SINGLETON_ID,
      heroHeading: 'Find your practice.',
      heroSubheading: 'Two studios. One community. Yoga, Pilates, and private sessions in Singapore.',
      pricingBlurb: null,
      testimonials: null,
      footerText: null,
    })
    .onConflictDoNothing()
}
