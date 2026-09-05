import { TENANT_ONE_ID, TENANT_ONE_SLUG, SECOND_TENANT_ID, SECOND_TENANT_SLUG } from '../schema/tenancy'

/**
 * **Provisioning data, not product code.**
 *
 * This is the one file in the backend that names a specific studio, and that is
 * the point of it. Everything a studio brings with it — its name, its premises,
 * the line at the foot of its emails, the words of its waiver — used to be
 * scattered through seeders as though it were the platform's, which is what made
 * the product unsellable to a second studio. Here it is what it actually is: a
 * record per tenant, the same shape the super portal will write when a studio is
 * onboarded without an engineer.
 *
 * The rule that keeps it honest: **nothing outside this file may name a
 * studio.** A seeder reads `provisioningFor(tenant)` and renders whatever it
 * finds; a tenant with no record here still provisions, on its own name and
 * sensible blanks. So adding a studio is adding an entry — or, in production,
 * inserting a row — and never editing a seeder.
 *
 * Tenant #1 is Yoga Sadhana, the studio the platform was originally built for,
 * whose rows migration 0027 backfilled. Tenant #2 is the throwaway second tenant
 * that exists outside production so a cross-tenant leak has somewhere to show.
 */
export type TenantProvisioning = {
  /** As its members know it. */
  name: string
  /** IANA zone — drives every "daily at 01:00" job. */
  timezone: string
  /**
   * The line at the foot of every transactional email, usually its premises.
   * Plain text — the email shell escapes it, so an `&` here is an `&`.
   */
  emailFooter?: string
  /**
   * What the frontends render before anyone signs in. Lands on
   * `tenant_settings` and reaches both apps through the public slug-resolution
   * route — so a studio's own wordmark and photography are its data, not the
   * product's assets.
   */
  branding?: {
    logoUrl?: string
    ogImageUrl?: string
    tagline?: string
  }
  /**
   * Strings a studio can override, keyed by surface, landing on
   * `tenant_settings.copy`. A key absent here is not a blank — the frontend
   * falls back to its own wording, or, where there is no honest default (a
   * phone number), omits the surface entirely.
   */
  copy?: Record<string, string>
  /** Real premises, in the order a member should see them. */
  locations: Array<{
    name: string
    address: string | null
    gmapsUrl: string | null
    phone: string | null
  }>
}

const YOGA_SADHANA: TenantProvisioning = {
  name: 'Yoga Sadhana',
  timezone: 'Asia/Singapore',
  emailFooter: 'Breadtalk IHQ (Tai Seng) & Outram Park.',
  branding: {
    // Served from the studio's own WordPress CDN — its assets, hosted where it
    // already hosts them. `fe-client/next.config.ts` allows the host.
    logoUrl:
      'https://i0.wp.com/yogasadhana.sg/wp-content/uploads/2025/02/Yoga_Sadhana_header_logo_circle.png?w=294&ssl=1',
    ogImageUrl:
      'https://i0.wp.com/yogasadhana.sg/wp-content/uploads/2025/03/2024YogaSadhana182.jpg?resize=2048%2C1365&ssl=1',
    tagline: 'Singapore Yoga Studio',
  },
  copy: {
    // Digits only, country code first, no `+` — WhatsApp's own deep-link
    // format. Migration 0042 backfills the same value onto the deployed row,
    // which this seed cannot reach: it inserts settings ON CONFLICT DO NOTHING.
    'contact.whatsapp': '6582067247',
  },
  locations: [
    {
      name: 'Breadtalk IHQ (Tai Seng)',
      address: '30 Tai Seng Street, #09-01 Breadtalk IHQ, Singapore 534013',
      gmapsUrl: 'https://maps.google.com/?q=Breadtalk+IHQ+Tai+Seng',
      phone: null,
    },
    {
      name: 'Outram Park',
      address: '1 Cantonment Road, #09-01, Singapore 085101',
      gmapsUrl: 'https://maps.google.com/?q=Outram+Park+Singapore',
      phone: null,
    },
  ],
}

const SECOND_TENANT: TenantProvisioning = {
  name: 'Acme Yoga',
  timezone: 'Australia/Sydney',
  locations: [],
}

const BY_SLUG: Record<string, TenantProvisioning> = {
  [TENANT_ONE_SLUG]: YOGA_SADHANA,
  [SECOND_TENANT_SLUG]: SECOND_TENANT,
}

const BY_ID: Record<string, TenantProvisioning> = {
  [TENANT_ONE_ID]: YOGA_SADHANA,
  [SECOND_TENANT_ID]: SECOND_TENANT,
}

/**
 * What this environment knows about a studio, or null for one it has never
 * heard of — which is the normal case in production the moment a second studio
 * is onboarded through the super portal rather than through a seed.
 */
export function provisioningFor(tenant: { id?: string; slug?: string }): TenantProvisioning | null {
  if (tenant.slug && BY_SLUG[tenant.slug]) return BY_SLUG[tenant.slug]!
  if (tenant.id && BY_ID[tenant.id]) return BY_ID[tenant.id]!
  return null
}

/** The tenants a seeded environment provisions, in the order they were created. */
export const PROVISIONED = [
  { id: TENANT_ONE_ID, slug: TENANT_ONE_SLUG, ...YOGA_SADHANA },
  { id: SECOND_TENANT_ID, slug: SECOND_TENANT_SLUG, ...SECOND_TENANT },
] as const
