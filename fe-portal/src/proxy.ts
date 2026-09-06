import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { signedInRedirectPath } from "@/lib/auth-redirect";
import {
  ROOT_DOMAIN,
  TENANT_HEADER_PREFIX,
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  isSuperPortalHost,
  tenantSlugFromHost,
} from "@/lib/tenant-host";
import { portalRouting } from "@/lib/super-portal";
import { portalClerkKeys } from "@/lib/clerk-keys";
import {
  resolveTenant,
  tenantNotFoundResponse,
  tenantUnavailableResponse,
} from "@/lib/tenant";

/**
 * Public routes — anything not matched here requires a Clerk session.
 *
 * `/login` and `/signup` are custom Clerk hook-based forms. The
 * WorkspaceProvider handles the authed-but-no-staff-row case (signs the user
 * out and redirects back).
 */
const isPublicRoute = createRouteMatcher(["/login(.*)", "/signup(.*)"]);

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
 *     Tenant — the bare root domain, `www`, the `admin` super portal — simply
 *     carries no Tenant context, and the backend already reads a call with no
 *     `X-Tenant-Slug` as Tenant #1.
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
  if (outcome.kind === "unknown") return { headers, blocked: tenantNotFoundResponse() };
  if (outcome.kind === "unavailable") return { headers, blocked: tenantUnavailableResponse() };

  headers.set(TENANT_SLUG_HEADER, outcome.tenant.slug);
  headers.set(TENANT_ID_HEADER, outcome.tenant.id);
  return { headers, blocked: null };
}

export default clerkMiddleware(async (auth, req) => {
  const { headers, blocked } = await tenantContext(req);
  if (blocked) return blocked;
  const pass = () => NextResponse.next({ request: { headers } });

  // Which of the two products is this hostname? `admin.portal.…` is the super
  // portal; everything else is a studio's staff portal. The decision is made
  // before auth so a studio's staff cannot even learn that `/platform` exists —
  // it is a 404 on their hostname, not a redirect to a login they would then be
  // refused at. The real gate is the backend's, which answers 404 to anyone not
  // on the platform allowlist.
  const routing = portalRouting(req.nextUrl.pathname, isSuperPortalHost(req.headers.get("host"), ROOT_DOMAIN));
  // The same opaque page an unknown Tenant gets, for the same reason: nothing in
  // the response may distinguish "no such section" from "no such address".
  if (routing.kind === "not-found") return tenantNotFoundResponse();
  if (routing.kind === "redirect") {
    return NextResponse.redirect(new URL(routing.to, req.url));
  }

  if (isPublicRoute(req)) {
    // A signed-in user has no business on /login — send them on. Rendering
    // the form leads to Clerk's `session_exists` ("You're already signed in")
    // error on submit.
    const authedTarget = signedInRedirectPath(req.nextUrl);
    if (authedTarget) {
      const { userId } = await auth();
      if (userId) return NextResponse.redirect(new URL(authedTarget, req.url));
    }
    return pass();
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  await auth.protect({ unauthenticatedUrl: loginUrl.toString() });
  return pass();
},
// Which Clerk application verifies this request, chosen by hostname — the
// server-side half of the split `<ClerkProvider publishableKey>` makes in the
// browser. Both halves are required and for the same reason: the super portal
// has its own Clerk instance, so a session minted there is signed by a key the
// staff instance does not know. Verify a super portal request against the staff
// app and every page bounces back to `/login` with a valid session in hand.
//
// `{}` for a studio portal, and for a super portal with no application of its
// own, leaves Clerk on the ambient env vars — the behaviour that shipped before
// this. See `lib/clerk-keys.ts`.
req => portalClerkKeys(req.headers.get("host")));

export const config = {
  matcher: [
    // Skip Next internals and all static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
