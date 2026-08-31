import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Workspace-root pinning is a LOCAL-ONLY workaround: a stray lockfile in the
  // home dir makes Next mis-infer the root (dev watcher scans the whole home
  // tree; webpack resolves deps like tailwindcss from the wrong place).
  // `turbopack.root` covers Turbopack, `outputFileTracingRoot` the webpack path.
  // On Vercel the clone is clean so neither is needed — and outputFileTracingRoot
  // there breaks the monorepo build (mislocates
  // .next/routes-manifest-deterministic.json → ENOENT). Apply off-Vercel only.
  ...(process.env.VERCEL
    ? {}
    : { turbopack: { root: __dirname }, outputFileTracingRoot: __dirname }),
  // Keep Sentry's module-loader shims as real Node externals (parity with
  // fe-client) so a Turbopack build doesn't fail loading require-in-the-middle.
  serverExternalPackages: ["require-in-the-middle", "import-in-the-middle"],
  // Every tenant is a different hostname, so local development is spent on
  // `{slug}.portal.localhost:3001` rather than `localhost:3001`. Next's dev
  // server treats those as cross-origin and refuses to serve its internal
  // assets to them unless they're allowed here. Dev-only; production unaffected.
  allowedDevOrigins: ["*.localhost", "*.portal.localhost"],
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
