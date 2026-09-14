/**
 * Creating a studio, end to end.
 *
 * A Tenant is not one row. It is a row in `tenants`, a row in `tenant_settings`,
 * its own transactional email copy, and — when one is named — its first admin:
 * a `staff` pool account, a pending `staff_users` row linked to it, and an
 * invitation mailed to them. All of it is ours, in one database, so none of it
 * waits on anyone else's API.
 *
 * The first admin is the only optional part. A studio created to receive an
 * archive must have an empty `staff_users`, because the archive carries its own
 * and `importTenant` refuses to merge into rows that are already there.
 *
 * The failure mode this file exists to rule out is the half-created Tenant: a
 * row with no settings, no copy, or a first admin who was never told. So:
 *
 *  - **Everything written is one transaction.** It commits together or not at
 *    all, the first admin's account and invitation included.
 *  - **The mail goes after the commit.** It is the one outward-facing act, and a
 *    message about a studio that then rolled back cannot be unsent. A mail that
 *    fails is reported and the invitation can be resent; the studio stands.
 *
 * The one window that remains is a commit that succeeds while the response is
 * lost. That leaves a complete, working Tenant and a caller who does not know
 * it; retrying the same slug returns `slug_taken`, which is the correct answer.
 */
import { and, isNull, ne, eq, sql } from 'drizzle-orm'
import { currentTenantId, db, withTenant } from '../../db'
import { seedEmailTemplates } from '../../db/seed/email-templates'
import { emailTemplates } from '../../db/schema/content'
import { staffUsers } from '../../db/schema/identity'
import { tenants, tenantSettings } from '../../db/schema/tenancy'
import type { TenantRow } from '../../db/schema/tenancy'
import { isUniqueViolation } from '../../db/unique-violation'
import { tenantOrigin } from '../../lib/allowed-origins'
import { BadRequestError, ConflictError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { captureException } from '../../instrument'
import { inviterNameFor, mailInvitation, writePendingStaff, type StaffInvitationRow } from '../auth/invitations'
import { assertUsableSlug } from './slug'
import { activateAfterFirstStaff, forgetCachedTenants, loadTenantById } from './tenants'

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
   * empty.
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
  // Deliberately shallow: the invitation that bounces is the authority on
  // deliverability. This only rejects what could not be an address at all, so
  // the transaction is not opened for it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestError('admin_email_invalid')
  }
  return email
}

/**
 * The studio's portal, where its first admin's invitation link lands. Checked
 * before anything is written: an invitation nobody can be sent is the
 * half-created Tenant from the other side.
 */
function requirePortalUrl(slug: string): string {
  const url = tenantOrigin('portal', slug)
  if (!url) throw new Error('TENANT_ORIGIN_PATTERNS configures no portal wildcard — no invitation link can be built')
  return url
}

/**
 * Mail a first admin their invitation, inside the new studio's context so the
 * mail is in its copy and logged in its `email_log`. Signed by the studio: no
 * colleague invited them.
 *
 * Never throws. It runs after the commit, so the studio and the invitation
 * already stand; a mail that cannot be built — a restored studio whose own copy
 * lacks the invitation template, say — is reported, and resending the
 * invitation from the studio's staff list is the way to try again.
 */
async function mailFirstAdmin(input: {
  tenantId: string
  invitation: StaffInvitationRow
  portalUrl: string
  name: string
}) {
  try {
    await withTenant(input.tenantId, async () =>
      mailInvitation({ ...input, inviterName: await inviterNameFor(input.tenantId, input.invitation) }),
    )
  } catch (err) {
    logger.error({ err, tenantId: input.tenantId }, 'tenant provisioning: first admin invitation not mailed')
    captureException(err, { scope: 'tenant-provision-invite-mail' })
  }
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
export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
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

  const slug = assertUsableSlug(input.slug)
  const name = input.name.trim()
  if (!name) throw new BadRequestError('name_required')
  // A blank string is the create form's "left empty" rather than an attempt at
  // an address, so it is read as an absent field instead of being refused.
  const rawAdminEmail = input.adminEmail?.trim()
  const adminEmail = rawAdminEmail ? normaliseEmail(rawAdminEmail) : null
  const adminName = adminEmail ? input.adminName?.trim() || emailLocalPart(adminEmail) : null
  const portalUrl = adminEmail ? requirePortalUrl(slug) : null

  try {
    const created = await db.transaction(async tx => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug,
          name,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          // A studio nobody can sign in to must not answer on its hostnames as
          // though it were open for business. Without a first admin it opens
          // `suspended`, and `activateAfterFirstStaff` lifts that the moment it
          // has staff — invited from the super portal, or restored from an
          // archive that brought its own.
          ...(adminEmail ? {} : { status: 'suspended' as const }),
        })
        .returning()
      if (!tenant) throw new Error('tenant insert returned no row')

      // From here on this transaction is inside the new Tenant, so the RLS
      // policies see what every other write in the system sees. `true` scopes
      // the setting to the transaction — a session-scoped one would ride the
      // pooled connection into the next request.
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`)

      await tx.insert(tenantSettings).values({ tenantId: tenant.id, displayName: name })

      // The studio's own words, in its own voice, pointing at its own
      // hostnames. `sendTemplatedEmail` throws when the (tenant, slug) row is
      // missing — deliberately, because sending another studio's wording is
      // worse than sending nothing — so without this every templated email a
      // new studio ever sends fails, the first admin's invitation included.
      //
      // Skipped for a studio created to receive an archive, and that is not
      // an oversight. `importTenant` refuses any target that already holds
      // rows — email templates included — and the archive carries the
      // studio's own templates, edits and all. The other route in,
      // `inviteFirstAdmin`, seeds them at the point it establishes that no
      // archive is coming.
      if (adminEmail) await seedEmailTemplates(tx, tenant)

      // Skipped entirely when no first admin was named. An empty
      // `staff_users` is a legitimate end state — it is the only one an
      // archive can be imported into.
      if (!adminEmail || !adminName) return { tenant, admin: null }

      // `admin`, not `superadmin`: the studio's first staff member runs the
      // studio. Platform administration is not a role in this table at all —
      // see services/tenants/platform-admin.ts. Invited by nobody on the
      // studio's staff, because there is nobody yet.
      const admin = await writePendingStaff(tx, {
        tenantId: tenant.id,
        email: adminEmail,
        name: adminName,
        role: 'admin',
        invitedByStaffId: null,
      })
      return { tenant, admin }
    })

    forgetCachedTenants()

    if (created.admin && portalUrl && adminName) {
      await mailFirstAdmin({
        tenantId: created.tenant.id,
        invitation: created.admin.invitation,
        portalUrl,
        name: adminName,
      })
    }

    return {
      tenant: created.tenant,
      admin: created.admin
        ? { id: created.admin.staff.id, email: created.admin.staff.email, name: adminName! }
        : null,
      urls: { client: tenantOrigin('client', slug), portal: tenantOrigin('portal', slug) },
    }
  } catch (err) {
    if (isUniqueViolation(err, 'tenants_slug_unique')) throw new ConflictError('slug_taken', { slug })
    throw err
  }
}

/**
 * Give a studio that has nobody its first admin.
 *
 * The other half of provisioning without one. A studio created to receive an
 * archive opens empty and `suspended`; if the archive never arrives — or the
 * operator simply changes their mind — this is how it gets a way in without
 * being torn down and made again.
 *
 * **First admin only.** It refuses a studio that already has staff, because
 * inviting staff into a working studio is that studio's own job, done from
 * inside it with its roles and location grants. This is the bootstrap, and a
 * bootstrap that keeps working after the boot is a standing back door into every
 * studio on the platform.
 *
 * Runs in the new Tenant's context for the same reason provisioning does: the
 * `staff_users` insert is refused by the Row-Level Security policy otherwise,
 * which is exactly what every other caller should get.
 */
export async function inviteFirstAdmin(
  tenantId: string,
  input: { email: string; name?: string },
): Promise<{ id: string; email: string; name: string }> {
  const openTenant = currentTenantId()
  if (openTenant) {
    throw new Error(
      `inviteFirstAdmin must not run inside a Tenant context (open: ${openTenant})`,
    )
  }

  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new BadRequestError('tenant_not_found')

  const email = normaliseEmail(input.email)
  const name = input.name?.trim() || emailLocalPart(email)
  const portalUrl = requirePortalUrl(tenant.slug)

  const written = await withTenant(tenantId, async () => {
    // The same predicate migration 0041's `tenant_staff_counts()` uses, and it
    // has to stay the same one. The super portal offers this action to studios
    // that function reports as having nobody; if this counted a row that one
    // ignores — an archived admin, a soft-deleted one — the button would appear
    // on a studio the UI calls unreachable and then refuse to fix it.
    const [existing] = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(isNull(staffUsers.deletedAt), ne(staffUsers.status, 'archived')))
      .limit(1)
    if (existing) throw new ConflictError('tenant_already_has_staff')

    // The templates provisioning held back. A studio opened empty is a studio
    // waiting for an archive, and an archive brings its own copy; giving it the
    // first admin is the moment that stops being true, so this is where the
    // default copy is written instead.
    //
    // Only when it has none, and the check is the point rather than caution: an
    // archive whose staff were all archived leaves `staff_users` looking empty
    // to the guard above while `email_templates` is full of the studio's own
    // edited wording, and seeding over that would replace copy a studio wrote
    // with copy the platform ships.
    const [templates] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailTemplates)
    if ((templates?.n ?? 0) === 0) {
      await seedEmailTemplates(db, {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        timezone: tenant.timezone,
      })
    }

    try {
      return await writePendingStaff(db, { tenantId, email, name, role: 'admin', invitedByStaffId: null })
    } catch (err) {
      // The guard above ignores archived and soft-deleted rows, but the unique
      // index does not: this studio's only previous admin may be an archived row
      // holding this exact address. Restoring them is the studio's own decision
      // and not one to make silently from outside it.
      if (isUniqueViolation(err, 'staff_users_tenant_email_unique')) {
        throw new ConflictError('admin_email_archived_here', { email })
      }
      throw err
    }
  })

  // After the commit, for the reason the header gives.
  await mailFirstAdmin({ tenantId, invitation: written.invitation, portalUrl, name })

  // The studio now has a way in, so the reason it was closed is gone.
  await activateAfterFirstStaff(tenantId)
  return { id: written.staff.id, email, name }
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
