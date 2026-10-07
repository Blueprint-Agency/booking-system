import type { MiddlewareHandler } from 'hono'
import { currentMaintenance } from '../services/platform/maintenance'
import { ERROR_CODES } from '../shared/error-codes'

/** What the 503 tells a client to wait, in seconds — the frontends re-check about this often. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 30

/**
 * Maintenance mode, enforced: `503 { error: 'maintenance', message }` with
 * `Retry-After` while the switch is on. Which paths it guards is app.ts's call.
 */
export const maintenanceGate: MiddlewareHandler = async (c, next) => {
  const maintenance = await currentMaintenance()
  if (!maintenance.enabled) return next()
  c.header('Retry-After', String(MAINTENANCE_RETRY_AFTER_SECONDS))
  return c.json({ error: ERROR_CODES.maintenance, message: maintenance.message }, 503)
}
