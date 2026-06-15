import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Sentry is only enabled in deployed envs (gated on DSN + NODE_ENV in the
  // sentry.*.config files). Locally the DSN is unset, so initialising the Node
  // SDK is pure overhead — its OpenTelemetry auto-instrumentation
  // (require-in-the-middle / import-in-the-middle) patches the module loader and
  // adds file-handle + memory pressure to the dev server. Skip it with no DSN.
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
