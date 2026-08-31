/**
 * The super portal's data layer: `/api/v1/platform/*`.
 *
 * Kept apart from `workspace-context.tsx`, which is the studio portal's, because
 * the two have nothing in common. That context loads the signed-in staff member,
 * their role and their location grants — none of which a platform admin has.
 * They belong to no studio; that is the whole point of them.
 */
import type { Api } from "@/lib/api";

export type TenantStatus = "active" | "suspended" | "archived";

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: TenantStatus;
  created_at: string;
  /** Whether the studio's portal Clerk Organization is wired. False is a
   *  half-tenant. There is no client-side Organization by design. */
  clerk: { portal: boolean };
  /** Live URLs, derived from the same wildcards CORS accepts. Null locally when
   *  the environment configures no wildcard for that app. */
  urls: { client: string | null; portal: string | null };
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  timezone?: string;
  admin_email: string;
  admin_name?: string;
}

export interface CreatedTenant {
  tenant: PlatformTenant;
  admin: { id: string; email: string; name: string };
  urls: { client: string | null; portal: string | null };
}

export type SlugVerdict = {
  available: boolean;
  slug?: string;
  reason?: "slug_too_short" | "slug_too_long" | "slug_malformed" | "slug_reserved" | "slug_taken";
};

/** Why a slug was refused, in words a human can act on. */
export const SLUG_REASONS: Record<string, string> = {
  slug_too_short: "Too short — at least 3 characters.",
  slug_too_long: "Too long — at most 63 characters.",
  slug_malformed: "Letters, numbers and hyphens only, starting and ending with one.",
  slug_reserved: "Reserved — something else already answers on that address.",
  slug_taken: "Already taken by another studio.",
};

export function listTenants(api: Api) {
  return api.get<{ tenants: PlatformTenant[] }>("/platform/tenants");
}

export function checkSlug(api: Api, slug: string) {
  return api.get<SlugVerdict>(`/platform/tenants/slug-check/${encodeURIComponent(slug)}`);
}

export function createTenant(api: Api, input: CreateTenantInput) {
  return api.post<CreatedTenant>("/platform/tenants", input);
}

export function setTenantStatus(api: Api, id: string, status: TenantStatus) {
  return api.patch<{ tenant: PlatformTenant }>(`/platform/tenants/${id}/status`, { status });
}

/**
 * A studio's name, turned into a candidate slug.
 *
 * Only a suggestion — the field stays editable and the backend's `checkSlug` is
 * the authority, including on the reserved list. Mirroring that list here would
 * be a second copy to keep in step for no gain.
 */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
