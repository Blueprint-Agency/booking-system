import cron from 'node-cron'
import { logger } from '../shared/logger'
import { captureException } from '../instrument'
import { expireStaleSessions, completeEndedPtSessions } from '../services/pt-sessions/cancel'
import { flipNoShows } from '../services/bookings/check-in'
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

export async function registerJobs() {
  // Boot: prime feature-flag cache
  await loadFeatureFlags()

  // Every 5 min — auto-expire pending PT requests past their window (refunds credits).
  // Note: no SLA escalation in the simplified flow — admin negotiates via WhatsApp,
  // not in-app, so there's nothing to escalate inside the system.
  cron.schedule('*/5 * * * *', safeJob('expireStaleSessions', expireStaleSessions))

  // Every 1 min — no-show flip on bookings whose session has ended
  cron.schedule('* * * * *', safeJob('flipNoShows', flipNoShows))

  // Every 5 min — advance scheduled PT requests whose session has ended to `attended`
  cron.schedule('*/5 * * * *', safeJob('completeEndedPtSessions', completeEndedPtSessions))

  // Daily 01:00 SGT (17:00 UTC) — package expiry
  cron.schedule('0 17 * * *', safeJob('expirePackages', expirePackages))

  // Daily 08:00 SGT (00:00 UTC) — lapsing + expired notifications
  cron.schedule('0 0 * * *', safeJob('sendLapsingAlerts', sendLapsingAlerts))
  cron.schedule('0 0 * * *', safeJob('sendExpiredNotifications', sendExpiredNotifications))

  // Daily 02:00 SGT (18:00 UTC) — flag clients with stale waiver signature
  cron.schedule('0 18 * * *', safeJob('flagExpiredWaivers', flagExpiredWaivers))
}
