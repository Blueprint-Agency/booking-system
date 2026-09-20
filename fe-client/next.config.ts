import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

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
  // Hardening headers and the Content-Security-Policy on every response (#142).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          apiUrl: process.env.NEXT_PUBLIC_API_URL,
          faroUrl: process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL,
          dev: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
