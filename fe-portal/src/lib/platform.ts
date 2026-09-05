/**
 * The super portal's data layer: `/api/v1/platform/*`.
 *
 * Kept apart from `workspace-context.tsx`, which is the studio portal's, because
 * the two have nothing in common. That context loads the signed-in staff member,
 * their role and their location grants — none of which a platform admin has.
 * They belong to no studio; that is the whole point of them.
 */
import { ApiError, type Api } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/api-url";
import { tenantRequestHeaders } from "@/lib/tenant-host";

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
  /** Omitted when the studio is being created to receive an archive: the
   *  import refuses a studio that already holds any staff rows. */
  admin_email?: string;
  admin_name?: string;
}

export interface CreatedTenant {
  tenant: PlatformTenant;
  /** Null when no first admin was named — nobody was invited. */
  admin: { id: string; email: string; name: string } | null;
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

export interface ImportSummary {
  imported: number;
  tables: Record<string, number>;
  from: { slug: string; name: string };
  /** True when the source studio was still here, so this is a copy of it and
   *  its rows were given fresh ids. False when it was a restore. */
  remapped: boolean;
}

/**
 * Download a studio's whole archive.
 *
 * Not through `api.get`, which parses JSON — this answers with a zip, and the
 * filename the operator should see is on the `Content-Disposition` header rather
 * than in a body. So the fetch is done here and the browser is handed a blob.
 *
 * A link with `download` cannot carry the `Authorization` header the platform
 * gate needs, which is why this is a fetch and a synthesised click rather than
 * an anchor pointing at the route.
 */
export async function exportTenant(
  getToken: () => Promise<string | null>,
  tenant: PlatformTenant,
): Promise<void> {
  const token = await getToken();
  const res = await fetch(`${getApiBaseUrl()}/platform/tenants/${tenant.id}/export`, {
    headers: {
      ...tenantRequestHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, undefined, "The studio could not be exported.");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameFrom(res) ?? `${tenant.slug}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: released immediately, the click may not have read
  // it yet in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The name the server chose, if it offered one. */
function filenameFrom(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  return header?.match(/filename="([^"]+)"/)?.[1] ?? null;
}

/** Put an archive back into an empty studio. */
export function importTenant(api: Api, id: string, archive: File) {
  const body = new FormData();
  body.append("archive", archive);
  return api.post<ImportSummary>(`/platform/tenants/${id}/import`, body);
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
