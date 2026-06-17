import * as Sentry from "@sentry/nextjs";

// Edge runtime (middleware / edge routes). Same gating as the server config.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && process.env.NODE_ENV === "production",
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  enableLogs: true,
});
