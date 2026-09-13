import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import {
  ROOT_DOMAIN,
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  isSuperPortalHost,
  tenantSlugFromHost,
  withoutTenantHeaders,
} from "@/lib/tenant-host";
import { platformProxy } from "@/lib/platform-proxy";
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
  if (outcome.kind === "unknown") return { headers, blocked: tenantNotFoundResponse() };
  if (outcome.kind === "unavailable") return { headers, blocked: tenantUnavailableResponse() };

  headers.set(TENANT_SLUG_HEADER, outcome.tenant.slug);
  headers.set(TENANT_ID_HEADER, outcome.tenant.id);
  return { headers, blocked: null };
}

/**
 * Which of the two products is this hostname? `admin.portal.…` is the super
 * portal, still on Clerk (`lib/platform-proxy.ts`); everything else is a
 * studio's staff portal, handled here.
 *
 * **A studio's portal is not gated at the edge.** Its session is a Better Auth
 * bearer token held in the page's own storage, which a request to Next never
 * carries, so there is nothing here to check. The gate is `WorkspaceProvider`
 * (`lib/workspace-context.tsx`), which sends a visitor with no session to
 * `/login`, and — the real one — the backend, which refuses every portal call
 * without a staff session signed in at this studio.
 */
export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  if (isSuperPortalHost(req.headers.get("host"), ROOT_DOMAIN)) {
    return platformProxy(req, event);
  }

  const { headers, blocked } = await tenantContext(req);
  if (blocked) return blocked;

  // The decision is made before anything renders so a studio's staff cannot even
  // learn that `/platform` exists — it is a 404 on their hostname, the same
  // opaque page an unknown Tenant gets.
  const routing = portalRouting(req.nextUrl.pathname, false);
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
