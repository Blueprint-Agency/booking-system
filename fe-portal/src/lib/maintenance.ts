/**
 * Maintenance mode, as a studio's portal hears about it: any call the backend
 * answers `503 { error: "maintenance", message }` while the platform is closed
 * (be-portal.md § Maintenance). The portal then shows nothing but the
 * maintenance screen (`components/layout/maintenance-gate.tsx`) until it is
 * over. The super portal never hears it: its routes and sign-in stay open, and
 * the gate is not mounted on its hostname.
 *
 * A relay: the fetch helpers only notify, and the gate registers what to do.
 * fe-client keeps its own copy (the apps share no code).
 */

export const DEFAULT_MAINTENANCE_MESSAGE = "Maintenance in progress. We'll be back shortly.";

/** How often the maintenance screen asks whether maintenance is over. */
export const MAINTENANCE_RECHECK_MS = 30_000;

/** The message to show if this answer is maintenance, or null if it is not. */
export function maintenanceMessage(status: number, body: unknown): string | null {
  if (status !== 503 || !body || typeof body !== "object") return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (error !== "maintenance") return null;
  return typeof message === "string" && message.trim() ? message : DEFAULT_MAINTENANCE_MESSAGE;
}

type Listener = (message: string) => void;

let listener: Listener | null = null;

/** Called once by the maintenance gate with what maintenance should do. */
export function onMaintenance(fn: Listener | null): void {
  listener = fn;
}

/** Tell the app if the backend answered with maintenance. Returns whether it did. */
export function noteMaintenance(status: number, body: unknown): boolean {
  const message = maintenanceMessage(status, body);
  if (message === null) return false;
  listener?.(message);
  return true;
}
