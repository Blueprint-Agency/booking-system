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
      {
        protocol: "https",
        hostname: "i0.wp.com",
      },
      {
        protocol: "https",
        hostname: "yogasadhana.sg",
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
