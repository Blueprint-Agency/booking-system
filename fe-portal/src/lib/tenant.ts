/**
 * Slug → Tenant, over HTTP.
 *
 * Vercel's reference multi-tenant proxy resolves the Tenant with a direct
 * database query. That is not available here: `fe-client`, `fe-portal` and `be`
 * stay fully decoupled with no shared dependencies, and the frontends reach the
 * backend over HTTP only. So the backend exposes an unauthenticated, cacheable
 * public route (`GET /api/v1/public/tenants/by-slug/:slug`) and this is its
 * caller.
 *
 * It sits on *every* request, which makes three things load-bearing:
 *
 *  - **Cache.** A short TTL, matching the route's own `Cache-Control: max-age=60`,
 *    so a Tenant created a minute ago is reachable. Per server instance and
 *    in-memory — there is no shared cache and there needn't be, because the TTL
 *    bounds how stale any instance can be. `bustTenantCache` exists for the
 *    write path (creating or suspending a Tenant in the super portal).
 *  - **Single flight.** Concurrent requests for the same slug share one lookup,
 *    so a cold instance under load doesn't fan out onto the backend.
 *  - **A deadline.** Every call is bounded by `AbortSignal.timeout`. A backend
 *    outage has to degrade predictably rather than hang every request in the app.
 *    On failure a stale entry is served if there is one, and only otherwise does
 *    the request become a 503 — an outage must never look like "no such Tenant".
 *
 * Server-side only: imported by `proxy.ts`, which runs on the Node.js runtime.
 */
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-url";
import { reportError } from "@/lib/report-error";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: string;
}

/**
 * What a studio publishes about itself — the half of the resolution payload
 * that decides what the app LOOKS like rather than which data it reads.
 *
 * Every field is nullable because a studio is created by inserting a row and is
 * expected to be reachable before anyone has configured anything. The app falls
 * back to the Tenant's own `name` and to platform-neutral defaults, never to
 * another studio's branding.
 */
export interface TenantSettings {
  display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  tagline: string | null;
  theme: Record<string, string>;
  copy: Record<string, string>;
}

export type TenantOutcome =
  /** The slug names a Tenant. `status` may be `suspended`. */
  | { kind: "found"; tenant: Tenant; settings: TenantSettings | null }
  /** No such Tenant — indistinguishable from archived, by design. */
  | { kind: "unknown" }
  /** The backend could not answer. Not the same thing as "unknown". */
  | { kind: "unavailable" };

/** Matches the resolution route's `max-age`. */
const FRESH_MS = 60_000;
/** How long past expiry an entry may still be served if the backend is down. */
const STALE_MS = 300_000;
/** Negative entries expire sooner: a new Tenant must appear quickly. */
const UNKNOWN_MS = 30_000;
/** A request must not wait on the backend longer than this. */
const TIMEOUT_MS = 2_000;

type CachedOutcome = Extract<TenantOutcome, { kind: "found" | "unknown" }>;

const cache = new Map<string, { outcome: CachedOutcome; freshUntil: number; staleUntil: number }>();
const inFlight = new Map<string, Promise<TenantOutcome>>();

/** Drop memoised lookups after a Tenant row is written, so no ghost is served. */
export function bustTenantCache(slug?: string) {
  if (slug) cache.delete(slug);
  else cache.clear();
}

export async function resolveTenant(slug: string): Promise<TenantOutcome> {
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && now < cached.freshUntil) return cached.outcome;

  const outcome = await shared(slug);

  if (outcome.kind === "unavailable") {
    // Prefer a stale answer to no answer: a backend blip must not take a live
    // studio off the air, and must never be reported as an unknown Tenant.
    if (cached && now < cached.staleUntil) return cached.outcome;
    return outcome;
  }

  const ttl = outcome.kind === "found" ? FRESH_MS : UNKNOWN_MS;
  cache.set(slug, { outcome, freshUntil: now + ttl, staleUntil: now + ttl + STALE_MS });
  return outcome;
}

/** One lookup per slug at a time, however many requests are waiting on it. */
function shared(slug: string): Promise<TenantOutcome> {
  const existing = inFlight.get(slug);
  if (existing) return existing;
  const pending = lookup(slug).finally(() => inFlight.delete(slug));
  inFlight.set(slug, pending);
  return pending;
}

async function lookup(slug: string): Promise<TenantOutcome> {
  const url = `${getApiBaseUrl()}/public/tenants/by-slug/${encodeURIComponent(slug)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // This module does its own caching, with a stale window the fetch cache
      // has no concept of.
      cache: "no-store",
    });
  } catch (err) {
    reportError(new Error("Tenant resolution request failed"), {
      scope: "tenant-resolve-network",
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return { kind: "unavailable" };
  }

  if (res.status === 404) return { kind: "unknown" };
  if (!res.ok) {
    reportError(new Error(`Tenant resolution returned ${res.status}`), {
      scope: "tenant-resolve-status",
      status: res.status,
    });
    return { kind: "unavailable" };
  }

  try {
    const body = (await res.json()) as { tenant?: Tenant; settings?: TenantSettings };
    if (!body?.tenant?.id || !body.tenant.slug) throw new Error("malformed tenant payload");
    // Settings are optional on purpose: a Tenant with no settings row still
    // resolves and still renders, on its own name and the neutral defaults.
    return { kind: "found", tenant: body.tenant, settings: body.settings ?? null };
  } catch (err) {
    reportError(new Error("Tenant resolution payload unreadable"), {
      scope: "tenant-resolve-parse",
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return { kind: "unavailable" };
  }
}

const OPAQUE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px/1.5 system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 1.5rem"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`;
}

/**
 * The response for a hostname that names no Tenant.
 *
 * Byte-identical whether the slug never existed or the Tenant is archived, and
 * it names neither the slug nor the platform: probing for Tenants must reveal
 * nothing about which ones exist.
 */
export function tenantNotFoundResponse() {
  return new NextResponse(page("Not found", "This address isn’t available."), {
    status: 404,
    headers: OPAQUE_HEADERS,
  });
}

/**
 * The response when the Tenant could not be resolved at all. Deliberately a
 * 503 and not the 404 above — an outage must be retryable and must not tell a
 * crawler that a live studio has gone.
 */
export function tenantUnavailableResponse() {
  return new NextResponse(page("Temporarily unavailable", "Please try again in a moment."), {
    status: 503,
    headers: { ...OPAQUE_HEADERS, "retry-after": "30" },
  });
}
