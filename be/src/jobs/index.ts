import cron from 'node-cron'
import { expireStaleSessions, escalateSLA } from '../services/private-session.service'
import { flipNoShows, completeClasses } from '../services/attendance.service'
import { expirePackages, sendLapsingAlerts, sendExpiredNotifications } from '../services/package-expiry.service'
import { flagExpiredWaivers } from '../services/waiver.service'

export function registerJobs() {
  // Every 5 min — private session SLA
  cron.schedule('*/5 * * * *', expireStaleSessions)
  cron.schedule('*/5 * * * *', escalateSLA)

  // Every 1 min — no-show flip
  cron.schedule('* * * * *', flipNoShows)

  // Every 5 min — class completion
  cron.schedule('*/5 * * * *', completeClasses)

  // Daily 01:00 SGT (UTC+8 → 17:00 UTC)
  cron.schedule('0 17 * * *', expirePackages)

  // Daily 08:00 SGT (00:00 UTC)
  cron.schedule('0 0 * * *', sendLapsingAlerts)
  cron.schedule('0 0 * * *', sendExpiredNotifications)

  // Daily 02:00 SGT (18:00 UTC)
  cron.schedule('0 18 * * *', flagExpiredWaivers)
}
