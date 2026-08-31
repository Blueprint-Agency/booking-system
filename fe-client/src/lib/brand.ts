/**
 * The studio this request is being rendered for, as the UI needs it.
 *
 * Server-side only — it reads the request's own `Host` through `headers()`, the
 * same rule the proxy uses, and resolves it through the same memoised lookup.
 * That is deliberate: the proxy has already resolved this hostname on this
 * request, `resolveTenant` caches for a minute, so asking again in the layout
 * costs nothing and avoids serialising branding through request headers where a
 * studio name with a non-ASCII character would have to be encoded.
 *
 * Every value has a neutral fallback, and none of the fallbacks name a studio.
 * That is the whole point of #66: a Tenant with no settings row renders as
 * *itself*, on its own name, and never as somebody else.
 */
import { headers } from "next/headers";
import { ROOT_DOMAIN, tenantSlugFromHost } from "@/lib/tenant-host";
import { resolveTenant } from "@/lib/tenant";
import { PLATFORM_BRAND, type Brand } from "@/lib/brand-shape";

// The type and the fallback live in `brand-shape.ts`, which knows nothing about
// requests — a client component needs both, and importing them from here would
// drag `next/headers` into the browser bundle. Re-exported so the server-side
// call sites that already import from this module keep working.
export { PLATFORM_BRAND, type Brand };

/** Blank-safe: a settings column that exists but is an empty string is unset. */
const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function getBrand(): Promise<Brand> {
  const host = (await headers()).get("host");
  const slug = tenantSlugFromHost(host, ROOT_DOMAIN);
  if (!slug) return PLATFORM_BRAND;

  const outcome = await resolveTenant(slug);
  // An outage or an unknown slug is the proxy's problem, not the layout's — it
  // has already turned both into a response. Reaching here with neither means
  // rendering the neutral shell, never a stale studio's.
  if (outcome.kind !== "found") return PLATFORM_BRAND;

  const { tenant, settings } = outcome;
  return {
    // `display_name` is what the studio chose to be called; its row `name` is
    // what it was created as. Either beats the platform's name.
    name: text(settings?.display_name) ?? tenant.name,
    tagline: text(settings?.tagline),
    logoUrl: text(settings?.logo_url),
    faviconUrl: text(settings?.favicon_url),
    ogImageUrl: text(settings?.og_image_url),
    theme: settings?.theme ?? {},
    copy: settings?.copy ?? {},
  };
}
