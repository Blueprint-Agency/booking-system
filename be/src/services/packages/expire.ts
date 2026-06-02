import { and, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'

/**
 * Daily cron: deactivate client_packages whose expiry has passed. This is the
 * time-trigger that flips `active=false` on expiry (debit/refund handle the
 * balance-driven flips inline). Already registered in jobs/index.ts (01:00 SGT).
 */
export async function expirePackages(): Promise<void> {
  await db
    .update(clientPackages)
    .set({ active: false })
    .where(
      and(
        eq(clientPackages.active, true),
        isNotNull(clientPackages.expiresAt),
        lte(clientPackages.expiresAt, sql`now()`),
      ),
    )
}

/**
 * Daily cron: send credit_expiry_reminder for client_packages expiring in ~7 days.
 */
export async function sendLapsingAlerts(): Promise<void> {
  // TODO: notify clients with packages expiring in 6.5–7.5 days
}

/**
 * Daily cron: notify clients whose packages have just expired.
 */
export async function sendExpiredNotifications(): Promise<void> {
  // TODO: notify clients with packages expired in last 24h
}
