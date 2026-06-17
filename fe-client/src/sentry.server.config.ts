import * as Sentry from "@sentry/nextjs";

// Gated on NEXT_PUBLIC_SENTRY_DSN — a no-op (enabled: false) when unset, so the
// app behaves identically with or without Sentry configured.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && process.env.NODE_ENV === "production",
  // Separates dev vs prod events inside the SAME Sentry project (no separate DSN).
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV,
  // Errors only for now (matches the backend). Raise to enable tracing later.
  tracesSampleRate: 0,
  enableLogs: true,
});
