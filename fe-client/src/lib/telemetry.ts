/**
 * Browser telemetry: Grafana Faro, started once from `instrumentation-client.ts`.
 *
 * **Off unless `NEXT_PUBLIC_FARO_COLLECTOR_URL` is set.** Local, CI and preview
 * builds leave it unset, and then every function here does nothing and nothing
 * leaves the browser. The URL is also admitted by the CSP
 * (`lib/security-headers.ts`).
 *
 * Faro captures uncaught errors and Web Vitals on its own; `reportError` pushes
 * the errors the app catches itself. The console is not captured — the sink
 * already logs there, and capturing it would send every error twice.
 *
 * **Who, but not who by name.** The user is the auth user id and nothing else —
 * never an email or a name — plus the Tenant id as an attribute, so an event can
 * be traced to a studio and an account without the telemetry holding personal
 * data. `components/telemetry-user.tsx` keeps it in step with the session.
 *
 * **And not which studio by name.** This app's hostname *is* the Tenant, so
 * every URL Faro derives from `location` would carry a studio's slug to a third
 * party. The `beforeSend` hook below rewrites the Tenant label out of every URL
 * on an event before it leaves the browser — see `telemetry-redaction.ts`.
 */
import { faro, getWebInstrumentations, initializeFaro } from "@grafana/faro-web-sdk";
import { tenantUrlRedactor } from "./telemetry-redaction.ts";

const COLLECTOR_URL = process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL;

let started = false;

export function startTelemetry(): void {
  if (started || !COLLECTOR_URL || typeof window === "undefined") return;
  try {
    initializeFaro({
      url: COLLECTOR_URL,
      app: { name: "fe-client", environment: process.env.NEXT_PUBLIC_APP_ENV },
      instrumentations: getWebInstrumentations({ captureConsole: false }),
      // The tenancy rule, on the way out: no studio's slug reaches Grafana.
      beforeSend: tenantUrlRedactor(),
    });
    started = true;
  } catch (err) {
    // Telemetry that cannot start must not take the app down with it.
    console.error("[telemetry] Faro failed to start", err);
  }
}

/** Send a caught error. Context values are stringified; undefined ones are dropped. */
export function pushTelemetryError(error: unknown, context?: Record<string, unknown>): void {
  if (!started) return;
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value !== undefined) strings[key] = String(value);
  }
  faro.api?.pushError(error instanceof Error ? error : new Error(String(error)), { context: strings });
}

/** Tag what follows with the signed-in auth user, and their studio when the session names one. */
export function setTelemetryUser(userId: string, tenantId: string | null): void {
  if (!started) return;
  faro.api?.setUser({ id: userId, ...(tenantId ? { attributes: { tenantId } } : {}) });
}

export function clearTelemetryUser(): void {
  if (!started) return;
  faro.api?.resetUser();
}
