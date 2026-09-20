import { pushTelemetryError } from "@/lib/telemetry";

/**
 * Single entry point for reporting client-side errors in the portal.
 *
 * Logs to the console (visible in dev / Vercel function logs) and sends the
 * error to Grafana Faro (`lib/telemetry.ts`), which does nothing when no
 * collector is configured. fe-client has its own copy — the apps share no code.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.error("[portal-error]", error, context ?? {});
  pushTelemetryError(error, context);
}
