import { NextResponse, type NextRequest } from "next/server";
import {
  ROOT_DOMAIN,
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  isSuperPortalHost,
  renamedTenantUrl,
  tenantSlugFromHost,
  withoutTenantHeaders,
} from "@/lib/tenant-host";
import { portalRouting } from "@/lib/super-portal";
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
 *  1. Inbound `x-tenant-*` headers are deleted (`withoutTenantHeaders`). They
 *     are the app's own trusted channel, so a caller must never be able to
 *     supply one and name itself a Tenant.
 *  2. Nothing is set unless resolution succeeded. A hostname that names no
 *     Tenant — the bare root domain, `www` — simply carries no Tenant context.
 *     A tenant-scoped API call from such a page is refused `tenant_required`
 *     (400) rather than answered about tenant #1.
 */
async function tenantContext(
  req: NextRequest,
): Promise<{ headers: Headers; blocked: NextResponse | null }> {
  const headers = withoutTenantHeaders(req.headers);

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
 * is re-posted rather than silently turned into a GET. Staff sign in once at
 * the new address — their session token lives in the old host's storage.
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
 * Which of the two products is this hostname? `admin.portal.…` is the super
 * portal; everything else is a studio's staff portal. The super portal's
 * hostname names no Tenant, so `tenantContext` sets nothing for it — but a
 * caller's own `x-tenant-*` headers are still removed on the way through.
 *
 * **Neither product is gated at the edge.** Both sessions are Better Auth bearer
 * tokens held in the page's own storage (`lib/portal-auth.ts`), which a request
 * to Next never carries, so there is nothing here to check. The gates are the
 * client shells — `WorkspaceProvider` (`lib/workspace-context.tsx`) on a studio,
 * `PlatformShell` on the super portal — which send a visitor with no session to
 * `/login`, and, the real one, the backend, which refuses every call without a
 * session from the right pool.
 */
export default async function proxy(req: NextRequest) {
  const superPortal = isSuperPortalHost(req.headers.get("host"), ROOT_DOMAIN);

  const { headers, blocked } = await tenantContext(req);
  if (blocked) return blocked;

  // The decision is made before anything renders so a studio's staff cannot even
  // learn that `/platform` exists — it is a 404 on their hostname, the same
  // opaque page an unknown Tenant gets. On the super portal it is the reverse:
  // everything belongs to `/platform`. See `lib/super-portal.ts`.
  const routing = portalRouting(req.nextUrl.pathname, superPortal);
  if (routing.kind === "not-found") return tenantNotFoundResponse();
  if (routing.kind === "redirect") {
    return NextResponse.redirect(new URL(routing.to, req.url));
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    // Skip Next internals and all static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
