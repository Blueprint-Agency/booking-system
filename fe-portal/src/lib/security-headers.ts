/**
 * The response headers every page of the portal carries (#142), applied from
 * `next.config.ts`. Kept here, as a pure function of the build's environment,
 * so the policy can be tested without a build. fe-client has its own copy — the
 * apps share no code.
 *
 * What the page loads, and so what the policy admits:
 *
 *  - scripts, styles, fonts: this origin only. `next/font` self-hosts the font.
 *  - fetches: the API (`NEXT_PUBLIC_API_URL`) only. Uploads go through the API,
 *    not straight to R2. There is no analytics or error-monitoring script to
 *    admit.
 *  - images: any https host. A studio's logo, a merch photo or an avatar is a
 *    URL the studio owns — the CDN, an R2 public bucket, its own marketing site —
 *    so no fixed list is exact.
 *  - Stripe: nothing. The portal never loads Stripe.js and frames nothing.
 *
 * `script-src` keeps `'unsafe-inline'`: the App Router streams its payload in
 * inline scripts, and the only way to drop it is a per-request nonce, which
 * turns every static page dynamic. `docs/md/deployment.md` § Security headers.
 *
 * The camera is off: check-in is by code today. A camera QR scanner will need
 * `camera=(self)` here.
 */

export type SecurityHeaderInput = {
  apiUrl: string | undefined;
  dev: boolean;
};

const LOCAL_API = "http://localhost:4000";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({ apiUrl, dev }: SecurityHeaderInput): string {
  const connect = ["'self'", originOf(apiUrl) ?? LOCAL_API];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  // No `upgrade-insecure-requests`: `make start` serves this production build
  // over plain http on `*.localhost`, and HSTS already holds deployed hosts to https.
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function securityHeaders(input: SecurityHeaderInput): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(input) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
}
