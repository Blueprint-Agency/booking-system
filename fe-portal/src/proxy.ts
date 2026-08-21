import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { signedInRedirectPath } from "@/lib/auth-redirect";

/**
 * Public routes — anything not matched here requires a Clerk session.
 *
 * `/login` and `/signup` are custom Clerk hook-based forms. The
 * WorkspaceProvider handles the authed-but-no-staff-row case (signs the user
 * out and redirects back).
 */
const isPublicRoute = createRouteMatcher(["/login(.*)", "/signup(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    // A signed-in user has no business on /login — send them on. Rendering
    // the form leads to Clerk's `session_exists` ("You're already signed in")
    // error on submit.
    const authedTarget = signedInRedirectPath(req.nextUrl);
    if (authedTarget) {
      const { userId } = await auth();
      if (userId) return NextResponse.redirect(new URL(authedTarget, req.url));
    }
    return;
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  await auth.protect({ unauthenticatedUrl: loginUrl.toString() });
});

export const config = {
  matcher: [
    // Skip Next internals and all static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
