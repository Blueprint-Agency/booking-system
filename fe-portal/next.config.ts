import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app. Without this, Next/Turbopack walks up
  // and mis-infers the root from a stray lockfile in the home directory.
  turbopack: {
    root: __dirname,
  },
};

// Wrapped for Sentry. Without SENTRY_AUTH_TOKEN/org/project the build simply
// skips source-map upload — it never fails the build. Error capture itself is
// gated on NEXT_PUBLIC_SENTRY_DSN in the sentry.*.config files.
export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
