import { TENANT_ONE_ID, SECOND_TENANT_ID } from '../schema/tenancy'

/**
 * **Test fixtures, not product code and not any real studio.**
 *
 * Two invented studios, existing so the harness can prove that neither can see
 * the other's data. A single-tenant environment cannot demonstrate that: every
 * missing `WHERE tenant_id = ?` looks correct when there is only one tenant's
 * rows to return.
 *
 * This file used to hold a real customer's name, premises, branding URLs and
 * WhatsApp number, described as "the one file in the backend that names a
 * studio". That was already an improvement on the scattering it replaced, but it
 * still shipped one studio's identity inside every other studio's product — a
 * fresh deployment came up already knowing who it was. It does not any more.
 *
 * A studio now arrives the two ways `db/seed/run.ts` describes, both from the
 * super portal and neither from here: **created** (`services/tenants/provision.ts`)
 * or **restored** from an archive (`services/tenants/transfer.ts`). Its name,
 * premises, branding and copy are rows in `tenants` / `tenant_settings`, written
 * by whoever onboarded it. Nothing in the repo needs to know them.
 *
 * The rule that keeps it honest: **no file outside this one may name a studio,
 * and the studios named here are invented.** A seeder reads
 * `provisioningFor(tenant)` and renders whatever it finds; a tenant with no
 * record here — which is every real studio — provisions on its own name and
 * sensible blanks.
 */

/** The fixture studios' slugs. Invented names, deliberately unremarkable. */
export const TENANT_ONE_SLUG = 'northwind'
export const SECOND_TENANT_SLUG = 'acme'
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

/**
 * The richer of the two fixtures: two premises, branding and copy, so the
 * seeders that render those have something to render and the isolation tests
 * have a studio that is visibly *not* the other one.
 *
 * Every value is invented. The branding URLs point at `example.com` on purpose:
 * they must never resolve, because a fixture that fetches a real asset makes the
 * test suite depend on somebody's CDN.
 */
const FIRST_FIXTURE: TenantProvisioning = {
  name: 'Northwind Yoga',
  timezone: 'Asia/Singapore',
  emailFooter: 'Harbour Studio & Parkside Studio.',
  branding: {
    logoUrl: 'https://assets.example.com/northwind/logo.png',
    ogImageUrl: 'https://assets.example.com/northwind/og.jpg',
    tagline: 'A yoga studio that does not exist',
  },
  copy: {
    // Digits only, country code first, no `+` — WhatsApp's own deep-link format.
    // Reserved-for-documentation number (E.164 +65 8000 0000 range is not
    // allocated), so a fixture cannot message a real person.
    'contact.whatsapp': '6580000000',
  },
  locations: [
    {
      name: 'Harbour Studio',
      address: '1 Example Quay, #01-01, Singapore 000001',
      gmapsUrl: null,
      phone: null,
    },
    {
      name: 'Parkside Studio',
      address: '2 Example Road, #02-02, Singapore 000002',
      gmapsUrl: null,
      phone: null,
    },
  ],
}

/**
 * The deliberately bare fixture: no premises, another timezone. Its emptiness is
 * the point — it proves a seeder renders a studio that brought nothing without
 * reaching for the other one's values.
 */
const SECOND_FIXTURE: TenantProvisioning = {
  name: 'Acme Yoga',
  timezone: 'Australia/Sydney',
  locations: [],
}

const BY_SLUG: Record<string, TenantProvisioning> = {
  [TENANT_ONE_SLUG]: FIRST_FIXTURE,
  [SECOND_TENANT_SLUG]: SECOND_FIXTURE,
}

const BY_ID: Record<string, TenantProvisioning> = {
  [TENANT_ONE_ID]: FIRST_FIXTURE,
  [SECOND_TENANT_ID]: SECOND_FIXTURE,
}

/**
 * What this environment knows about a studio, or null for one it has never
 * heard of — which is **every** real studio, in every deployed environment.
 * Only the two fixtures above are ever found here.
 */
export function provisioningFor(tenant: { id?: string; slug?: string }): TenantProvisioning | null {
  if (tenant.slug && BY_SLUG[tenant.slug]) return BY_SLUG[tenant.slug]!
  if (tenant.id && BY_ID[tenant.id]) return BY_ID[tenant.id]!
  return null
}

/** The fixture tenants a seeded environment provisions, in creation order. */
export const PROVISIONED = [
  { id: TENANT_ONE_ID, slug: TENANT_ONE_SLUG, ...FIRST_FIXTURE },
  { id: SECOND_TENANT_ID, slug: SECOND_TENANT_SLUG, ...SECOND_FIXTURE },
] as const
