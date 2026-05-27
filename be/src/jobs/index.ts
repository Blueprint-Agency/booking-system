import cron from 'node-cron'
import { expireStaleSessions } from '../services/pt-sessions/cancel'
import { flipNoShows } from '../services/bookings/check-in'
import { expirePackages, sendLapsingAlerts, sendExpiredNotifications } from '../services/packages/expire'
import { flagExpiredWaivers } from '../services/waiver'
import { loadFeatureFlags } from '../services/feature-flags'

export async function registerJobs() {
  // Boot: prime feature-flag cache
  await loadFeatureFlags()

  // Every 5 min — auto-expire pending PT requests past their window (refunds credits).
  // Note: no SLA escalation in the simplified flow — admin negotiates via WhatsApp,
  // not in-app, so there's nothing to escalate inside the system.
  cron.schedule('*/5 * * * *', expireStaleSessions)

  // Every 1 min — no-show flip on bookings whose session has ended
  cron.schedule('* * * * *', flipNoShows)

  // Daily 01:00 SGT (17:00 UTC) — package expiry
  cron.schedule('0 17 * * *', expirePackages)

  // Daily 08:00 SGT (00:00 UTC) — lapsing + expired notifications
  cron.schedule('0 0 * * *', sendLapsingAlerts)
  cron.schedule('0 0 * * *', sendExpiredNotifications)

  // Daily 02:00 SGT (18:00 UTC) — flag clients with stale waiver signature
  cron.schedule('0 18 * * *', flagExpiredWaivers)
}
