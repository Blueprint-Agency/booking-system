/**
 * Single entry point for reporting client-side errors in the portal.
 *
 * Logs to the console (visible in dev / Vercel function logs). There is no
 * error-monitoring service wired up — this is the only sink for now, kept as
 * its own module so call sites don't change if one is added later. fe-client
 * has its own copy — the apps share no code.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.error("[portal-error]", error, context ?? {});
}
