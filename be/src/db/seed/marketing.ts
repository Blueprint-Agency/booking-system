import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { TENANT_ONE_ID } from '../schema/tenancy'
import type { SeededTenant } from './tenants'

/**
 * Tenant #1's row predates tenancy and carries this fixed id — see the note in
 * `./waiver.ts`.
 */
const MARKETING_SINGLETON_ID = '00000000-0000-0000-0000-000000000004'

/**
 * One marketing row per tenant, held to one each by the unique index on
 * `tenant_id` (migration 0031). Tenant #1 keeps the copy it has always had; a
 * newly provisioned tenant gets neutral placeholder text naming itself, because
 * the alternative — inheriting the first studio's hero — is the leak this
 * batch exists to close.
 */
export async function seedMarketing(db: PostgresJsDatabase<typeof schema>, tenant: SeededTenant) {
  const isTenantOne = tenant.id === TENANT_ONE_ID

  await db
    .insert(schema.marketingContent)
    .values({
      ...(isTenantOne ? { id: MARKETING_SINGLETON_ID } : {}),
      tenantId: tenant.id,
      heroHeading: 'Find your practice.',
      heroSubheading: isTenantOne
        ? 'Two studios. One community. Yoga, Pilates, and private sessions in Singapore.'
        : `Classes and private sessions at ${tenant.name}.`,
      pricingBlurb: null,
      testimonials: null,
      footerText: null,
    })
    .onConflictDoNothing()
}
