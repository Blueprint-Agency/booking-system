/**
 * Which Tenant is a hostname for?
 *
 * One rule in every environment: `NEXT_PUBLIC_ROOT_DOMAIN` is everything after
 * the Tenant slug, and the slug is the hostname minus that suffix. Local,
 * staging and production differ only in the *value* of that variable, so a
 * Host-parsing bug cannot appear in production alone — which is the failure
 * mode this shape exists to rule out.
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN        resolves
 *   portal.localhost:3001          acme.portal.localhost:3001
 *   portal.dev.reservetoday.app    acme.portal.dev.reservetoday.app
 *   portal.reservetoday.app        acme.portal.reservetoday.app
 *
 * The `portal.` label stays in the local root domain even though ports 3000 and
 * 3001 already separate the two apps: it makes fe-portal exercise the same
 * two-label strip locally that it runs in production.
 *
 * Pure on purpose. `proxy.ts` is a thin wrapper over this function and has no
 * test seam of its own; this is the seam `auth-redirect.test.ts` established.
 */

/** Everything after the Tenant slug. Local default; set per environment. */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "portal.localhost:3001";

/**
 * Tenant context the proxy puts on the request. Every inbound header with this
 * prefix is deleted first — a caller must never be able to name its own Tenant.
 */
export const TENANT_HEADER_PREFIX = "x-tenant-";
export const TENANT_SLUG_HEADER = "x-tenant-slug";
export const TENANT_ID_HEADER = "x-tenant-id";

/**
 * Labels that sit on the root domain but are not Tenants — something else
 * already answers there. A deliberate mirror of the backend's reserved-slug
 * list (`be/src/services/tenants/slug.ts`), which refuses these at Tenant
 * creation and remains the enforcement; because no Tenant can ever hold one,
 * treating them as "no Tenant" here cannot shadow a real studio.
 *
 * `admin` is the one that matters here: `admin.portal.…` is the super portal,
 * which is cross-tenant by definition and must not resolve to a studio.
 */
const NON_TENANT_LABELS = new Set([
  "admin",
  "api",
  "portal",
  "www",
  "dev",
  "staging",
  "app",
  "mail",
  "clerk",
  "assets",
]);

/** One DNS label, lowercase: what a Tenant slug is allowed to be. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Lowercase, drop the port, drop the root dot. The port goes from *both* sides
 * of the comparison, so `portal.localhost:3001` and `portal.localhost:3005` are
 * the same root domain — a dev server on another port must not stop resolving
 * Tenants.
 */
function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  // An IPv6 literal is bracketed; the colons inside it are not port separators.
  const closingBracket = h.startsWith("[") ? h.indexOf("]") : -1;
  const colon = h.lastIndexOf(":");
  if (colon > closingBracket && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon);
  return h.replace(/\.$/, "");
}

/**
 * The Tenant slug in `host`, or null when the hostname names no Tenant — the
 * bare root domain, `www`, the super portal at `admin`, a host outside the root
 * domain (a Vercel preview URL), or a label that isn't a well-formed slug.
 *
 * Null is not an error: it means "no Tenant context", and the backend already
 * treats a request with no `X-Tenant-Slug` as Tenant #1. Whether a well-formed
 * slug corresponds to a Tenant that *exists* is not decidable here — that is
 * the resolver's job, over HTTP.
 */
export function tenantSlugFromHost(
  host: string | null | undefined,
  rootDomain: string = ROOT_DOMAIN,
): string | null {
  if (!host || !rootDomain) return null;

  const normalizedHost = normalizeHost(host);
  const root = normalizeHost(rootDomain);
  if (!root || normalizedHost === root) return null;
  if (!normalizedHost.endsWith(`.${root}`)) return null;

  const label = normalizedHost.slice(0, -(root.length + 1));
  if (NON_TENANT_LABELS.has(label)) return null;
  return SLUG.test(label) ? label : null;
}

/**
 * `X-Tenant-Slug` for a browser-side API call.
 *
 * The API hostname never contains the Tenant — one backend serves everyone at
 * `api.reservetoday.app` — so every call has to say which Tenant it is for. The
 * page's own host is the answer, read through the same rule the proxy uses.
 */
export function tenantRequestHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const slug = tenantSlugFromHost(window.location.host);
  return slug ? { "X-Tenant-Slug": slug } : {};
}
