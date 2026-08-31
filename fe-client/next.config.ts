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
  // Sentry's Node SDK (loaded by the instrumentation hook) relies on these
  // module-loader shims. Turbopack otherwise externalizes them under a hashed
  // virtual name that fails at runtime ("Failed to load external module
  // require-in-the-middle-<hash>"). Listing them keeps them as real Node
  // externals required by their actual name.
  serverExternalPackages: ["require-in-the-middle", "import-in-the-middle"],
  // Every tenant is a different hostname, so local development is spent on
  // `{slug}.localhost:3000` rather than `localhost:3000`. Next's dev server
  // treats those as cross-origin and refuses to serve its internal assets to
  // them unless they're allowed here. Dev-only setting; production is unaffected.
  allowedDevOrigins: ["*.localhost"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "placeholder.co",
      },
      // A studio's own logo and photography, wherever it already hosts them:
      // `cdn.reservetoday.app` for anything uploaded through the portal, and
      // the WordPress CDN for a studio still serving its assets from its
      // marketing site. These are hosts, not brands — no studio is named here.
      {
        protocol: "https",
        hostname: "cdn.reservetoday.app",
      },
      {
        protocol: "https",
        hostname: "i0.wp.com",
      },
    ],
  },
  async redirects() {
    return [{ source: "/classes", destination: "/", permanent: true }];
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
