/**
 * The super portal's data layer: `/api/v1/platform/*`.
 *
 * Kept apart from `workspace-context.tsx`, which is the studio portal's, because
 * the two have nothing in common. That context loads the signed-in staff member,
 * their role and their location grants — none of which a platform admin has.
 * They belong to no studio; that is the whole point of them.
 */
import type { Api } from "@/lib/api";
import { downloadFile } from "@/lib/download";

export type TenantStatus = "active" | "suspended" | "archived";

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: TenantStatus;
  created_at: string;
  /** Staff who could sign in — active or invited. Zero is a studio nobody can
   *  get into: legitimate while it waits for an archive, never as a resting
   *  place, which is why such a studio is created suspended. */
  staff_count: number;
  /** Live URLs, derived from the same wildcards CORS accepts. Null locally when
   *  the environment configures no wildcard for that app. */
  urls: { client: string | null; portal: string | null };
  /**
   * Whether the studio takes its own money, and on which account.
   *
   * `configured: false` means it charges on the platform's account, which is
   * where every studio started and where every studio not yet moved still
   * charges. `account_id` names the studio's own account when there is one —
   * and it is the *only* thing this app can ever learn about those credentials.
   * The secret key and the signing secret are never returned by any route, so
   * there is nothing to mask, truncate or accidentally render.
   */
  payments: { configured: boolean; account_id: string | null };
  /**
   * The stretch of time the studio has paid for, as calendar dates (YYYY-MM-DD)
   * on its own clock. `end_date` is the first day it is no longer paid for;
   * null is an open-ended Term. `ended` is true from that day on — the studio
   * is then treated as suspended everywhere, even before `status` says so, and
   * cannot be reactivated until the Term is extended.
   */
  term: { start_date: string; end_date: string | null; ended: boolean };
}

/** The Term lengths the backend accepts, in months. */
export const TERM_MONTHS = [3, 6, 12] as const;
export type TermMonths = (typeof TERM_MONTHS)[number];

export interface CreateTenantInput {
  slug: string;
  name: string;
  timezone?: string;
  /** How long the first Term runs from today. Omitted leaves it open-ended. */
  term_months?: TermMonths;
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
  reason?:
    | "slug_too_short"
    | "slug_too_long"
    | "slug_malformed"
    | "slug_reserved"
    | "slug_taken"
    | "slug_held";
  /** The addresses a studio on this slug would have. Absent when the slug is
   *  malformed or reserved; null per app when no wildcard is configured. */
  urls?: { client: string | null; portal: string | null };
};

/** Why a slug was refused, in words a human can act on. */
export const SLUG_REASONS: Record<string, string> = {
  slug_too_short: "Too short — at least 3 characters.",
  slug_too_long: "Too long — at most 63 characters.",
  slug_malformed: "Letters, numbers and hyphens only, starting and ending with one.",
  slug_reserved: "Reserved — something else already answers on that address.",
  slug_taken: "Already taken by another studio.",
  slug_held:
    "Another studio’s old address — it still redirects there, and frees up 90 days after that studio’s rename.",
  slug_unchanged: "That is already this studio’s address.",
  tenant_archived: "An archived studio has no address to change.",
};

/** Why a status change, Term change or delete was refused. */
export const TENANT_REFUSALS: Record<string, string> = {
  tenant_term_ended: "Its term has ended. Extend the term first, then reactivate it.",
  tenant_not_suspended: "Suspend the studio before deleting it.",
  confirmation_mismatch: "The address typed doesn’t match this studio’s.",
};

export function listTenants(api: Api) {
  return api.get<{ tenants: PlatformTenant[] }>("/platform/tenants");
}

/**
 * Is a slug usable? `forTenantId` asks on behalf of that studio's rename: its
 * own old addresses are free to it, so it can be renamed straight back.
 */
export function checkSlug(api: Api, slug: string, forTenantId?: string) {
  return api.get<SlugVerdict>(
    `/platform/tenants/slug-check/${encodeURIComponent(slug)}`,
    forTenantId ? { tenant: forTenantId } : undefined,
  );
}

export function createTenant(api: Api, input: CreateTenantInput) {
  return api.post<CreatedTenant>("/platform/tenants", input);
}

export function setTenantStatus(api: Api, id: string, status: TenantStatus) {
  return api.patch<{ tenant: PlatformTenant }>(`/platform/tenants/${id}/status`, { status });
}

/**
 * Set a studio's Term from a start date and a duration; the backend computes
 * and stores the end. It does not reactivate a studio whose Term had ended —
 * that is a separate `setTenantStatus`.
 */
export function setTenantTerm(api: Api, id: string, input: { start_date: string; months: TermMonths }) {
  return api.put<{ tenant: PlatformTenant }>(`/platform/tenants/${id}/term`, input);
}

export interface DeletedTenant {
  id: string;
  slug: string;
  rows: number;
  tables: Record<string, number>;
  /** Sign-in accounts removed because this studio was the person's only one. */
  accounts: { client: number; staff: number };
  /** Uploads removed from storage; null when storage is unconfigured or the removal failed. */
  objects: number | null;
}

/**
 * Delete a studio and everything it owns. Irreversible. The backend refuses an
 * active studio, and refuses unless `confirmSlug` is the studio's current slug.
 */
export function deleteTenant(api: Api, id: string, confirmSlug: string) {
  return api.del<{ deleted: DeletedTenant }>(
    `/platform/tenants/${id}?confirm=${encodeURIComponent(confirmSlug)}`,
  );
}

/** "1 Mar 2027" from "2027-03-01", read as a calendar date rather than an instant. */
export function formatTermDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `start` plus `months`, clamped to the month's last day — mirrors the backend, for preview only. */
export function addMonths(start: string, months: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const index = m! - 1 + months;
  const year = y! + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d!, last);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Change a studio's slug — its web address. The old addresses redirect to the
 * new ones for 90 days, and the old slug is held from every other studio
 * meanwhile. The studio itself may be renamed straight back to it.
 */
export function renameTenant(api: Api, id: string, slug: string) {
  return api.post<{
    tenant: PlatformTenant;
    former: { slug: string; redirect_until: string };
  }>(`/platform/tenants/${id}/slug`, { slug });
}

/**
 * Give a studio that has nobody its first admin.
 *
 * Only ever the first: the backend refuses a studio that already has staff,
 * because inviting into a working studio is that studio's own job. Inviting also
 * lifts the suspension such a studio was created under, so the response carries
 * the studio back rather than just the admin.
 */
export function inviteFirstAdmin(
  api: Api,
  id: string,
  input: { admin_email: string; admin_name?: string },
) {
  return api.post<{
    admin: { id: string; email: string; name: string };
    tenant: PlatformTenant;
  }>(`/platform/tenants/${id}/admin`, input);
}

/**
 * Move a studio onto its own payment-provider account.
 *
 * One way only: these go up and never come back. The backend validates the
 * secret key against the provider before storing it — so a typo is a message on
 * the form rather than a member's checkout failing weeks later — and answers
 * with the account the provider says the key belongs to, plus the webhook URL
 * that has to be registered on that account.
 *
 * There is deliberately no "show" or "edit". Credentials that need checking are
 * replaced; credentials that were wrong are cleared.
 */
export function setPaymentCredentials(
  api: Api,
  id: string,
  input: { secret_key: string; webhook_secret: string },
) {
  return api.put<{ tenant: PlatformTenant; webhook_url: string }>(
    `/platform/tenants/${id}/payment-credentials`,
    input,
  );
}

/** Put a studio back on the platform's account. */
export function clearPaymentCredentials(api: Api, id: string) {
  return api.del<{ tenant: PlatformTenant }>(`/platform/tenants/${id}/payment-credentials`);
}

export interface ImportSummary {
  imported: number;
  tables: Record<string, number>;
  from: { slug: string; name: string };
  /** True when the source studio was still here, so this is a copy of it and
   *  its rows were given fresh ids. False when it was a restore. */
  remapped: boolean;
  /** True when the archive is what let this studio open: it was created with no
   *  admin and therefore suspended, and the archive brought its own staff. */
  opened: boolean;
}

/** Download a studio's whole archive. */
export function exportTenant(
  getToken: () => Promise<string | null>,
  tenant: PlatformTenant,
): Promise<void> {
  return downloadFile(getToken, `/platform/tenants/${tenant.id}/export`, {
    fallbackName: `${tenant.slug}.zip`,
    failure: "The studio could not be exported.",
  });
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
