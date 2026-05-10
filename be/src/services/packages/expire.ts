/**
 * Daily cron: hard-expire client_packages past expires_at.
 */
export async function expirePackages(): Promise<void> {
  // TODO: UPDATE client_packages SET credits_or_sessions_remaining = 0 WHERE expires_at < now()
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
