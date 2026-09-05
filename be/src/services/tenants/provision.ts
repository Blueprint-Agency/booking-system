/**
 * Creating a studio, end to end.
 *
 * A Tenant is not one row. It is a row in `tenants`, a row in `tenant_settings`,
 * a Clerk Organization in the **portal** application, and — when one is named —
 * a pending `staff_users` row for the studio's first admin with an organization
 * invitation sent to them. Up to five writes across three systems, two of which
 * have no transactions.
 *
 * The first admin is the only optional part. A studio created to receive an
 * archive must have an empty `staff_users`, because the archive carries its own
 * and `importTenant` refuses to merge into rows that are already there.
 *
 * The **client** application gets no organization, deliberately —
 * `clerk_client_org_id` stays null for the life of the studio. A studio has
 * hundreds of members and Clerk prices organization membership per seat, so
 * members are scoped by hostname + `Origin` and fenced by Row-Level Security
 * instead. See `docs/adr/0003-no-client-side-clerk-organizations.md`.
 *
 * The failure mode this file exists to rule out is the half-created Tenant: a
 * row with no organization (staff can never sign in, and `orgClaimVerdict`
 * silently treats the missing id as "enforcement not switched on yet" — the
 * worst possible reading), or an organization with no row (an orphan in Clerk
 * that quietly holds the slug). So:
 *
 *  - **The database half is one transaction.** Everything it writes commits
 *    together or not at all, including the first admin's row.
 *  - **The Clerk half is compensated.** The organization is created *before* the
 *    transaction opens and deleted again if anything downstream throws, by
 *    `withProvisionedOrg`. Deleting an organization also revokes the
 *    invitation sent into it, so the invite needs no separate undo.
 *  - **The order is chosen so the un-undoable step is last.** The invitation is
 *    the only outward-facing act — once the email is out, it has been seen — so
 *    it is the final statement of the transaction, after every other step has
 *    already succeeded. Inside it, not after it: a refused invitation must take
 *    the studio down with it, or the first admin is never told about a studio
 *    that now exists.
 *
 * The one window that remains is a commit that succeeds while the response is
 * lost. That leaves a complete, working Tenant and a caller who does not know
 * it; retrying the same slug returns `slug_taken`, which is the correct answer.
 */
import { eq, sql } from 'drizzle-orm'
import { currentTenantId, db } from '../../db'
import { staffUsers } from '../../db/schema/identity'
import { tenants, tenantSettings } from '../../db/schema/tenancy'
import type { TenantRow } from '../../db/schema/tenancy'
import { isUniqueViolation } from '../../db/unique-violation'
import { tenantOrigin } from '../../lib/allowed-origins'
import { clerkStaffApp } from '../../lib/clerk'
import { splitName } from '../../lib/name'
import { BadRequestError, ConflictError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'
import { assertUsableSlug } from './slug'
import { forgetCachedTenants } from './tenants'

/**
 * The Clerk side of provisioning, as three calls — all against the **portal**
 * application, the only one a Tenant has an organization in.
 *
 * A port rather than a direct dependency because the interesting behaviour here
 * is what happens when one of these throws, and that has to be testable without
 * a Clerk account. `clerkOrgPort` below is the real one.
 */
export interface ClerkOrgPort {
  createOrganization(input: { name: string; slug: string }): Promise<string>
  deleteOrganization(organizationId: string): Promise<void>
  inviteOrgAdmin(input: {
    organizationId: string
    email: string
    redirectUrl: string | null
  }): Promise<void>
}

export const clerkOrgPort: ClerkOrgPort = {
  async createOrganization(input) {
    // The Clerk organization slug is set from ours so the two identifiers agree
    // when someone is reading a Clerk dashboard next to our tenant list. It is
    // not load-bearing — `clerk_portal_org_id` is what we resolve on.
    const org = await clerkStaffApp.organizations.createOrganization({
      name: input.name,
      slug: input.slug,
    })
    return org.id
  },

  async deleteOrganization(organizationId) {
    await clerkStaffApp.organizations.deleteOrganization(organizationId)
  },

  async inviteOrgAdmin({ organizationId, email, redirectUrl }) {
    // Always the portal application: the first admin is staff. `org:admin` is
    // Clerk's own organization role, and is separate from our `staff_users.role`
    // — the first is who may administer the Clerk organization, the second is
    // what they may do in the product.
    await clerkStaffApp.organizations.createOrganizationInvitation({
      organizationId,
      emailAddress: email,
      role: 'org:admin',
      ...(redirectUrl ? { redirectUrl } : {}),
    })
  },
}

/**
 * Create the portal organization, run `body`, and delete it again if it throws.
 *
 * Compensation is best-effort and never masks the original failure: a delete
 * that also fails is logged and reported, and the error the caller sees is
 * still the one that actually broke provisioning. An orphaned organization is a
 * cleanup chore; a misreported error is a debugging dead end.
 */
export async function withProvisionedOrg<T>(
  clerk: ClerkOrgPort,
  input: { name: string; slug: string },
  body: (portalOrgId: string) => Promise<T>,
): Promise<T> {
  let created: string | null = null

  const rollback = async () => {
    if (!created) return
    try {
      await clerk.deleteOrganization(created)
    } catch (err) {
      logger.error(
        { err, organizationId: created, slug: input.slug },
        'tenant provisioning: failed to roll back the Clerk organization',
      )
      captureException(err, { scope: 'tenant-provision-rollback' })
    }
  }

  try {
    created = await clerk.createOrganization(input)
    return await body(created)
  } catch (err) {
    await rollback()
    throw err
  }
}

export interface ProvisionTenantInput {
  slug: string
  name: string
  timezone?: string
  /**
   * The studio's first admin. They are invited, not created signed-in.
   *
   * Optional, because inviting someone is not the only way a studio is
   * onboarded. A studio restored from an archive brings its own `staff_users`
   * rows, and `importTenant` refuses a studio that already holds any — so the
   * studio an archive is imported into has to be creatable with that table
   * empty. Everything else provisioning does is unchanged, the Clerk
   * organization included: it is what staff authenticate against, and a studio
   * without one can never be signed in to.
   */
  adminEmail?: string
  adminName?: string
}

export interface ProvisionedTenant {
  tenant: TenantRow
  /** Null when no first admin was asked for — see `adminEmail` above. */
  admin: { id: string; email: string; name: string } | null
  urls: { client: string | null; portal: string | null }
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

/** Same shape the invitation flow uses, so a hand-typed address cannot create a
 *  second staff row that differs from the first only by casing. */
function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  // Deliberately shallow: Clerk is the authority on deliverability and will
  // refuse the invitation. This only rejects what could not be an address at
  // all, so the transaction is not opened for it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestError('admin_email_invalid')
  }
  return email
}

/**
 * The whole of "onboard a studio", as one call.
 *
 * Runs outside any Tenant context — the super portal is cross-tenant by
 * definition — so the transaction sets `app.tenant_id` itself, immediately after
 * the `tenants` row exists. Without it the `staff_users` insert would be refused
 * by the Row-Level Security policy, which is exactly the behaviour we want from
 * every *other* caller.
 */
export async function provisionTenant(
  input: ProvisionTenantInput,
  clerk: ClerkOrgPort = clerkOrgPort,
): Promise<ProvisionedTenant> {
  // Refused rather than accommodated, because the alternative fails silently and
  // across tenants. Inside an open `withTenant`, `db` *is* that transaction, so
  // `db.transaction` below opens a SAVEPOINT rather than a new transaction — and
  // `set_config(…, true)` is transaction-local, not savepoint-local. The new
  // tenant's id would outlive this call and every remaining query in the
  // caller's request would run as the studio that was just created.
  //
  // Nothing legitimately calls it that way: the super portal's routes are exempt
  // from `resolveTenant` precisely so this holds.
  const openTenant = currentTenantId()
  if (openTenant) {
    throw new Error(
      `provisionTenant must not run inside a Tenant context (open: ${openTenant}) — ` +
        'it opens its own transaction and sets app.tenant_id for the new studio',
    )
  }

  // Before anything external: a reserved or malformed slug must not create a
  // Clerk organization it will then have to delete.
  const slug = assertUsableSlug(input.slug)
  const name = input.name.trim()
  if (!name) throw new BadRequestError('name_required')
  // A blank string is the create form's "left empty" rather than an attempt at
  // an address, so it is read as an absent field instead of being refused.
  const rawAdminEmail = input.adminEmail?.trim()
  const adminEmail = rawAdminEmail ? normaliseEmail(rawAdminEmail) : null
  const adminName = adminEmail ? input.adminName?.trim() || emailLocalPart(adminEmail) : null

  const portalUrl = tenantOrigin('portal', slug)

  try {
    const result = await withProvisionedOrg(clerk, { name, slug }, async portalOrgId => {
      const created = await db.transaction(async tx => {
        const [tenant] = await tx
          .insert(tenants)
          .values({
            slug,
            name,
            ...(input.timezone ? { timezone: input.timezone } : {}),
            // `clerk_client_org_id` is left null on purpose, and stays null:
            // members are not organization members. See the ADR named above.
            clerkPortalOrgId: portalOrgId,
          })
          .returning()
        if (!tenant) throw new Error('tenant insert returned no row')

        // From here on this transaction is inside the new Tenant, so the RLS
        // policies see what every other write in the system sees. `true` scopes
        // the setting to the transaction — a session-scoped one would ride the
        // pooled connection into the next request.
        await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`)

        await tx
          .insert(tenantSettings)
          .values({ tenantId: tenant.id, displayName: name })

        // Skipped entirely when no first admin was named. An empty
        // `staff_users` is a legitimate end state — it is the only one an
        // archive can be imported into — and inventing a placeholder row to
        // avoid the branch would be inventing exactly the row the import then
        // refuses.
        let adminId: string | null = null
        if (adminEmail && adminName) {
          const { firstName, lastName } = splitName(adminName)
          const [admin] = await tx
            .insert(staffUsers)
            .values({
              tenantId: tenant.id,
              email: adminEmail,
              name: adminName,
              firstName,
              lastName,
              // `admin`, not `superadmin`: the studio's first staff member runs the
              // studio. Platform administration is not a role in this table at all
              // — see services/tenants/platform-admin.ts.
              role: 'admin',
              status: 'pending',
              invitedAt: new Date(),
            })
            .returning({ id: staffUsers.id })
          if (!admin) throw new Error('first admin insert returned no row')
          adminId = admin.id

          // Last, and deliberately *inside* the transaction rather than after
          // it. Outside, a refused invitation would leave a committed studio
          // with a first admin who was never told — the half-created Tenant this
          // whole file exists to rule out. Inside, the throw rolls the three
          // inserts back and `withProvisionedOrg` deletes the organization on
          // the way out, which also revokes the invitation if it had already
          // been sent.
          //
          // The cost is one network call with the transaction open. It is the
          // final statement, so nothing waits behind it but the commit.
          await clerk.inviteOrgAdmin({
            organizationId: portalOrgId,
            email: adminEmail,
            redirectUrl: portalUrl ? `${portalUrl}/signup` : null,
          })
        }

        return { tenant, adminId }
      })

      return created
    })

    forgetCachedTenants()
    return {
      tenant: result.tenant,
      admin:
        result.adminId && adminEmail && adminName
          ? { id: result.adminId, email: adminEmail, name: adminName }
          : null,
      urls: { client: tenantOrigin('client', slug), portal: portalUrl },
    }
  } catch (err) {
    if (isUniqueViolation(err, 'tenants_slug_unique')) throw new ConflictError('slug_taken', { slug })
    if (isUniqueViolation(err, 'tenants_clerk_portal_org_id_unique')) {
      throw new ConflictError('clerk_portal_org_taken')
    }
    throw err
  }
}

/**
 * Is a slug free? Answers the super portal's create form before it submits.
 *
 * Deliberately a *platform admin* route only. The same question asked publicly
 * would enumerate every studio on the platform, which is precisely what the
 * public resolver's uniform 404 exists to prevent.
 */
export async function slugAvailable(slug: string): Promise<boolean> {
  const normalised = assertUsableSlug(slug)
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, normalised))
    .limit(1)
  return !row
}
