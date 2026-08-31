import cron from 'node-cron'
import { logger } from '../shared/logger'
import { captureException } from '../instrument'
import { withTenant } from '../db'
import { listJobTenantIds } from '../services/tenants/tenants'
import { expireStaleSessions, completeEndedPtSessions } from '../services/pt-sessions/cancel'
import { expirePackages, sendLapsingAlerts, sendExpiredNotifications } from '../services/packages/expire'
import { flagExpiredWaivers } from '../services/waiver'
import { loadFeatureFlags } from '../services/feature-flags'

/**
 * Wrap a cron handler so a thrown error (or rejected promise) is caught,
 * logged, and reported — instead of bubbling up as an unhandledRejection that
 * could take the process down. A failed run is logged; the schedule keeps
 * ticking, so the next run proceeds normally.
 */
function safeJob(name: string, fn: () => Promise<unknown> | unknown) {
  return async () => {
    const start = performance.now()
    try {
      await fn()
      logger.debug({ job: name, ms: Math.round(performance.now() - start) }, 'cron job ok')
    } catch (err) {
      logger.error({ job: name, err }, 'cron job failed')
      captureException(err, { job: name })
    }
  }
}

/**
 * Run a job once per tenant, each pass inside that tenant's database context.
 *
 * Jobs have no request, so nothing has set `app.tenant_id` for them — and with
 * Row-Level Security live, a job that runs without it reads zero rows and
 * quietly does nothing. The jobs themselves are unchanged cross-tenant sweeps;
 * this is what narrows each sweep to one studio, so per-tenant behaviour comes
 * out of the policy rather than out of every job remembering to filter.
 *
 * One tenant's failure is logged and does not stop the rest — otherwise a single
 * broken studio would freeze every other studio's credit refunds.
 */
function perTenant(name: string, fn: () => Promise<unknown> | unknown) {
  return async () => {
    for (const tenantId of await listJobTenantIds()) {
      try {
        await withTenant(tenantId, async () => {
          await fn()
        })
      } catch (err) {
        logger.error({ job: name, tenantId, err }, 'cron job failed for tenant')
        captureException(err, { job: name, tenantId })
      }
    }
  }
}

/** Both wrappers, in the order they have to nest: per-tenant inside the
 *  catch-all, so a thrown error can never reach the cron scheduler. */
function tenantJob(name: string, fn: () => Promise<unknown> | unknown) {
  return safeJob(name, perTenant(name, fn))
}

export async function registerJobs() {
  // Boot: prime feature-flag cache — per tenant, since a flag is a tenant's own
  // answer and the cache is keyed on it.
  await perTenant('loadFeatureFlags', loadFeatureFlags)()

  // Every 5 min — auto-expire pending PT requests past their window (refunds credits).
  // Note: no SLA escalation in the simplified flow — admin negotiates via WhatsApp,
  // not in-app, so there's nothing to escalate inside the system.
  cron.schedule('*/5 * * * *', tenantJob('expireStaleSessions', expireStaleSessions))

  // No no-show job by design — admin-restructure.md §11: forfeits only fire when
  // admin/instructor manually marks the row `no-show`.

  // Every 5 min — advance scheduled PT requests whose session has ended to `attended`
  cron.schedule('*/5 * * * *', tenantJob('completeEndedPtSessions', completeEndedPtSessions))

  // Daily 01:00 SGT (17:00 UTC) — package expiry
  cron.schedule('0 17 * * *', tenantJob('expirePackages', expirePackages))

  // Daily 08:00 SGT (00:00 UTC) — lapsing + expired notifications
  cron.schedule('0 0 * * *', tenantJob('sendLapsingAlerts', sendLapsingAlerts))
  cron.schedule('0 0 * * *', tenantJob('sendExpiredNotifications', sendExpiredNotifications))

  // Daily 02:00 SGT (18:00 UTC) — flag clients with stale waiver signature
  cron.schedule('0 18 * * *', tenantJob('flagExpiredWaivers', flagExpiredWaivers))
}
