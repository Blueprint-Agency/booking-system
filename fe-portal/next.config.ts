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
  // `{slug}.portal.localhost:3001` rather than `localhost:3001`. Next's dev
  // server treats those as cross-origin and refuses to serve its internal
  // assets to them unless they're allowed here. Dev-only; production unaffected.
  allowedDevOrigins: ["*.localhost", "*.portal.localhost"],
  // The admin Customers page moved from /admin/clients to /admin/customers.
  // Bookmarks and links in old emails still land. Permanent: the old path is
  // not coming back. Only the page moved — the API is still /portal/admin/clients.
  async redirects() {
    return [
      { source: "/admin/clients", destination: "/admin/customers", permanent: true },
      { source: "/admin/clients/:path*", destination: "/admin/customers/:path*", permanent: true },
    ];
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
