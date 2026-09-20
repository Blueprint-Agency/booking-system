import { NextResponse, type NextRequest } from "next/server";
import {
  ROOT_DOMAIN,
  TENANT_HEADER_PREFIX,
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  renamedTenantUrl,
  tenantSlugFromHost,
} from "@/lib/tenant-host";
import {
  resolveTenant,
  tenantNotFoundResponse,
  tenantUnavailableResponse,
} from "@/lib/tenant";

/**
 * Works out which Tenant the request is for and rewrites the request headers so
 * the app sees it.
 *
 * The rewrite is of headers, not of the path: every Tenant is served by the
 * same routes and differs only in its data, so Vercel's `/s/{slug}/…` path
 * rewrite would buy nothing but a restructured `app/` tree. What the app needs
 * is trustworthy Tenant context on the request, which is what this sets.
 *
 * Two things happen on **every** path through here, including the ones that
 * never resolve a Tenant:
 *
 *  1. Inbound `x-tenant-*` headers are deleted. They are the app's own trusted
 *     channel, so a caller must never be able to supply one and name itself a
 *     Tenant. This is Vercel's explicit warning about proxy-set headers.
 *  2. Nothing is set unless resolution succeeded. A hostname that names no
 *     Tenant — the bare root domain, `www` — simply carries no Tenant context.
 *     A tenant-scoped API call from such a page is refused `tenant_required`
 *     (400) by the backend rather than answered about tenant #1, so these
 *     hostnames may serve only pages that ask the API for nothing.
 */
async function tenantContext(
  req: NextRequest,
): Promise<{ headers: Headers; blocked: NextResponse | null }> {
  const headers = new Headers(req.headers);
  for (const key of [...headers.keys()]) {
    if (key.startsWith(TENANT_HEADER_PREFIX)) headers.delete(key);
  }

  const slug = tenantSlugFromHost(req.headers.get("host"), ROOT_DOMAIN);
  if (!slug) return { headers, blocked: null };

  const outcome = await resolveTenant(slug);
  if (outcome.kind === "moved") return { headers, blocked: movedResponse(req, outcome.slug) };
  if (outcome.kind === "unknown") return { headers, blocked: tenantNotFoundResponse() };
  if (outcome.kind === "unavailable") return { headers, blocked: tenantUnavailableResponse() };

  headers.set(TENANT_SLUG_HEADER, outcome.tenant.slug);
  headers.set(TENANT_ID_HEADER, outcome.tenant.id);
  return { headers, blocked: null };
}

/**
 * A renamed studio's old address: a permanent redirect to the same path and
 * query on its new one. 308 rather than 301, so a form posted to the old host
 * is re-posted rather than silently turned into a GET.
 */
function movedResponse(req: NextRequest, slug: string) {
  const { pathname, search } = req.nextUrl;
  const host = req.headers.get("host") ?? req.nextUrl.host;
  // Behind a TLS-terminating proxy the request Next sees is plain http; the
  // scheme the visitor used is the forwarded one.
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwarded ? `${forwarded}:` : req.nextUrl.protocol;
  return NextResponse.redirect(renamedTenantUrl({ protocol, host, pathname, search }, slug), 308);
}

/**
 * Tenant context only. The proxy does not gate on a session: the member's
 * session is a bearer token in the page's own storage (`lib/member-auth.ts`),
 * which never reaches the edge. The account shell and checkout send a
 * signed-out visitor to `/login`, and the login and register pages send a
 * signed-in one on (`lib/auth-redirect.ts`).
 */
export default async function proxy(req: NextRequest) {
  const { headers, blocked } = await tenantContext(req);
  if (blocked) return blocked;
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
