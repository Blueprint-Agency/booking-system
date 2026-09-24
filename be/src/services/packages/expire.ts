import { and, eq, gt, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm'
import { currentTenantId, db } from '../../db'
import { clientPackages, classPackages } from '../../db/schema/packages'
import { clients } from '../../db/schema/identity'
import { tenants } from '../../db/schema/tenancy'
import { now } from '../../lib/clock'
import { reportError } from '../../shared/logger'
import { contentsLine } from '../notifications/purchase-email'
import { sendTemplatedEmail } from '../notifications/send'

const DAY_MS = 86_400_000

/**
 * Daily cron: deactivate client_packages whose expiry has passed. This is the
 * time-trigger that flips `active=false` on expiry (debit/refund handle the
 * balance-driven flips inline). Registered in jobs/index.ts (01:00 tenant-local).
 */
export async function expirePackages(): Promise<void> {
  const tenantId = currentTenantId()
  // Invariant: jobs/index.ts only ever runs this per tenant.
  if (!tenantId) throw new Error('expirePackages runs inside a tenant context')
  await db
    .update(clientPackages)
    .set({ active: false })
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.active, true),
        isNotNull(clientPackages.expiresAt),
        lte(clientPackages.expiresAt, now()),
      ),
    )
}

/**
 * Daily cron (08:00 tenant-local): send `credit_expiry_reminder` for every
 * Credit Bundle and trial pass that ends 6.5–7.5 days from now and still has
 * something left on it.
 *
 * The window is one day wide and the job runs once a day, so each package falls
 * inside it on exactly one run — that is what makes the reminder go out once,
 * with no marker to keep. An Unlimited Plan has no balance to run out of, and a
 * PT package's sessions are booked through a request, not "use them before they
 * go", so neither is reminded.
 *
 * Runs inside one tenant's context (`perTenant`): the rows are that studio's,
 * and so are the template, the sender and the zone the date is written in.
 */
export async function sendLapsingAlerts(): Promise<void> {
  const tenantId = currentTenantId()
  // Invariant: jobs/index.ts only ever runs this per tenant.
  if (!tenantId) throw new Error('sendLapsingAlerts runs inside a tenant context')

  const at = now()
  const lapsing = await db
    .select({
      id: clientPackages.id,
      kind: clientPackages.kind,
      remaining: clientPackages.creditsOrSessionsRemaining,
      expiresAt: clientPackages.expiresAt,
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      packageName: classPackages.name,
    })
    .from(clientPackages)
    .innerJoin(clients, eq(clients.id, clientPackages.clientId))
    .leftJoin(classPackages, eq(classPackages.id, clientPackages.sourceClassPackageId))
    .where(
      and(
        eq(clientPackages.tenantId, tenantId),
        eq(clientPackages.active, true),
        inArray(clientPackages.kind, ['credit_bundle', 'trial']),
        gt(clientPackages.creditsOrSessionsRemaining, 0),
        gte(clientPackages.expiresAt, new Date(at.getTime() + 6.5 * DAY_MS)),
        lt(clientPackages.expiresAt, new Date(at.getTime() + 7.5 * DAY_MS)),
      ),
    )
  if (!lapsing.length) return

  const [tenant] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId))
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: tenant!.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  for (const row of lapsing) {
    // One member's missing template or bad address must not cost the rest of
    // the studio their reminder.
    try {
      await sendTemplatedEmail({
        tenantId,
        slug: 'credit_expiry_reminder',
        recipient: { email: row.clientEmail, userId: row.clientId, userKind: 'client' },
        variables: {
          client_name: row.clientName,
          package_name: row.packageName ?? 'Your package',
          expires_at: date.format(row.expiresAt!),
          remaining_line: contentsLine(row.kind, row.remaining),
        },
      })
    } catch (err) {
      reportError(err, 'credit expiry reminder failed', { scope: 'lapsing-alerts', tenantId, clientPackageId: row.id })
    }
  }
}

/**
 * Daily cron: notify clients whose packages have just expired.
 */
export async function sendExpiredNotifications(): Promise<void> {
  // TODO: notify clients with packages expired in last 24h
}
