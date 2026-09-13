import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { signedInRedirectPath } from "@/lib/auth-redirect";
import { portalClerkKeys } from "@/lib/clerk-keys";
import { portalRouting } from "@/lib/super-portal";
import { tenantNotFoundResponse } from "@/lib/tenant";
import { withoutTenantHeaders } from "@/lib/tenant-host";

/**
 * The proxy for the super portal's hostname, which still signs in through
 * Clerk until #116. A studio's portal never reaches this: `proxy.ts` sends it
 * down a path with no Clerk at all, because its session is a bearer token the
 * edge cannot see.
 *
 * Here the Clerk session is a cookie the edge *can* see, so the edge still
 * gates: anything but `/login` needs a session.
 */
const isPublicRoute = createRouteMatcher(["/login(.*)", "/signup(.*)"]);

export const platformProxy = clerkMiddleware(
  async (auth, req) => {
    // The super portal names no Tenant, so nothing is set — but a caller's own
    // `x-tenant-*` headers are still removed on the way through.
    const headers = withoutTenantHeaders(req.headers);
    const pass = () => NextResponse.next({ request: { headers } });

    // Everything on this hostname belongs to `/platform`; a studio route has no
    // Tenant to render here. See `lib/super-portal.ts`.
    const routing = portalRouting(req.nextUrl.pathname, true);
    if (routing.kind === "not-found") return tenantNotFoundResponse();
    if (routing.kind === "redirect") {
      return NextResponse.redirect(new URL(routing.to, req.url));
    }

    if (isPublicRoute(req)) {
      // A signed-in operator has no business on /login — send them on. Rendering
      // the form leads to Clerk's `session_exists` error on submit.
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
  // Which Clerk application verifies this request — the super portal's own when
  // one is configured, the server-side half of `<PlatformAuthProvider>`. A
  // session minted by one Clerk instance is signed by a key the other does not
  // know, so both halves must agree. See `lib/clerk-keys.ts`.
  req => portalClerkKeys(req.headers.get("host")),
);
